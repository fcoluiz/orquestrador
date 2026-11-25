// Faixa acima do prompt com as métricas do lote do orquestrador, e compactação automática da
// sessão principal.
//
// Só age na sessão principal que gravou métricas (`metricas.mjs gravar`); nas outras sessões e
// nas filhas o script não imprime nada, a faixa fica vazia e nada é compactado. Ao fim de cada
// turno da principal: redesenha a faixa e, com o contexto em `compactarEm` (padrão 200k) ou mais,
// compacta com as instruções que mantêm os caminhos do estado do lote e da skill. Qualquer falha
// só cala a faixa ou adia a compactação para o próximo turno, nunca derruba a sessão.
//
// A faixa mostra só as métricas. As decisões do dono são perguntadas pela própria principal
// (AskUserQuestion, até 4 por vez, o cabeçalho de cada pergunta é o id: "D3").
//
// Travas, só na principal com lote ativo, entregues à principal junto com a próxima mensagem do
// dono: decisão perguntada ou respondida que seguiu na fila no fim do turno, lembrete de repassar a
// resposta "D3: …" digitada, e outra principal ativa no mesmo repositório (`gravar --repos`).
// `gh pr merge --auto` é recusado (sem check obrigatório, ele mescla na hora).
import type { EngineInterface, Register } from 'claude-code'

const SCRIPT = 'skills/orquestrador/scripts/metricas.mjs'

type Decisao = { id: string; frente: string; pergunta: string; opcoes: string[] }
type Dados = {
  text: string
  detail?: string
  compactarEm?: number
  instrucoes?: string
  aviso?: string
  decisoes?: Decisao[]
  naoRepassada?: string
  lembretes?: Record<string, string>
  outroLote?: string
  auto?: string
}

let faixa: Dados | null = null
let compactando = false
const respondidas = new Set<string>() // ids que o dono já viu perguntados ou respondeu
let cobrar: string[] = [] // respondidas que seguiam na fila no fim do turno: aviso à principal
let avisado = '' // último aviso de outro lote já entregue à principal

const MERGE_AUTO = /\bgh\s+pr\s+merge\b[^\n]*\s--auto\b/
const ID = /\b(D\d+)\b/

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void atualizar($).catch(() => {})
    return result
  })

  // Os avisos vão para a principal junto com a mensagem do dono, não para a faixa: lembrete de
  // repassar a resposta "D3: …" digitada, decisão perguntada que ficou na fila no turno anterior e
  // outro lote no mesmo repositório (só quando o aviso muda, para não repetir a cada mensagem).
  on('prompt.submit', ($, e, next) => {
    if (e.isMeta || e.command || !faixa) return next(e)
    const notas: string[] = []
    const ids = [...e.text.matchAll(/\b(D\d+)\s*:/g)].map(m => m[1]).filter(id => faixa?.lembretes?.[id])
    for (const id of ids) {
      respondidas.add(id)
      notas.push(faixa.lembretes?.[id] ?? '')
    }
    const atrasadas = cobrar.filter(id => !ids.includes(id))
    if (atrasadas.length && faixa.naoRepassada) notas.push(faixa.naoRepassada.replace('%IDS', atrasadas.join(', ')))
    if (faixa.outroLote && faixa.outroLote !== avisado) notas.push(faixa.outroLote)
    avisado = faixa.outroLote ?? ''
    return notas.length ? next({ ...e, context: [...(e.context ?? []), ...notas] }) : next(e)
  })

  // Decisões perguntadas pela principal: o cabeçalho de cada pergunta é o id.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && faixa?.decisoes) {
      for (const q of e.questions) {
        const id = (ID.exec(q.header) ?? ID.exec(q.question))?.[1]
        if (id && faixa.decisoes.some(x => x.id === id)) respondidas.add(id)
      }
    }
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!MERGE_AUTO.test(e.command)) return next(e)
    const d = faixa ?? (await carregar($).catch(() => null))
    return d?.auto ? { deny: d.auto } : next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || faixa === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>{faixa.text}</Text>
        {faixa.detail ? <Text dimColor>{faixa.detail}</Text> : null}
      </Box>
    )
  })
}

async function rodar($: EngineInterface, args: string[]) {
  return $.process.run(['node', `${$.plugin.root}/${SCRIPT}`, ...args], { timeoutMs: 5000 })
}

async function carregar($: EngineInterface): Promise<Dados | null> {
  const sid = await $.session.id()
  const r = await rodar($, ['faixa', `--session=${sid}`])
  const out = r.exitCode === 0 ? r.stdout.trim() : ''
  return out ? (JSON.parse(out) as Dados) : null
}

async function atualizar($: EngineInterface) {
  const sid = await $.session.id()
  const novo = await carregar($)
  // decisão que saiu da fila já foi repassada: esquece
  for (const id of [...respondidas]) if (!novo?.decisoes?.some(x => x.id === id)) respondidas.delete(id)
  // o turno acabou e a decisão perguntada ou respondida segue na fila: a principal não repassou
  cobrar = [...respondidas]
  if (JSON.stringify(novo) !== JSON.stringify(faixa)) {
    faixa = novo
    $.ui.invalidate('ui.render')
  }
  if (novo?.compactarEm) await talvezCompactar($, sid, novo)
}

async function talvezCompactar($: EngineInterface, sid: string, d: Dados) {
  if (compactando || !d.compactarEm) return
  const { context } = await $.session.usage()
  const tokens = context.tokens ?? 0
  if (tokens < d.compactarEm * 1000) return
  compactando = true
  try {
    $.ui.toast((d.aviso ?? '').replace('%K', String(Math.round(tokens / 1000))))
    // O turno acabou de fechar: espera o engine sair dele (compact recusa durante um turno).
    for (const espera of [1500, 5000, 15000]) {
      await $.clock.sleep(espera)
      try {
        // $.session.compact não existe no app desktop; o comando /compact funciona.
        await $.command.run({ command: 'compact', args: d.instrucoes ?? '' })
        await rodar($, ['compactou', `--session=${sid}`])
        return
      } catch {
        // turno ainda rodando: tenta de novo; se não der, fica para o próximo fim de turno
      }
    }
  } finally {
    compactando = false
  }
}
