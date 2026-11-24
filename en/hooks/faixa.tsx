// Faixa acima do prompt com as métricas do lote do orquestrador, e compactação automática da
// sessão principal.
//
// Só age na sessão principal que gravou métricas (`metricas.mjs gravar`); nas outras sessões e
// nas filhas o script não imprime nada, a faixa fica vazia e nada é compactado. Ao fim de cada
// turno da principal: redesenha a faixa e, com o contexto em `compactarEm` (padrão 200k) ou mais,
// compacta com as instruções que mantêm os caminhos do estado do lote e da skill. Qualquer falha
// só cala a faixa ou adia a compactação para o próximo turno, nunca derruba a sessão.
//
// As decisões do dono são perguntadas pela própria principal (AskUserQuestion, até 4 por vez, o
// cabeçalho de cada pergunta é o id: "D3"); a faixa só mostra quantas estão na fila.
//
// Travas, só na principal com lote ativo: decisão perguntada ou respondida ("D3: …" digitado) que
// segue na fila no fim do turno vira alerta amarelo, e a resposta digitada leva um lembrete de
// repassar à filha no mesmo turno; `gh pr merge --auto` é recusado (sem check obrigatório, ele
// mescla na hora); e a faixa avisa quando outra principal ativa registrou o mesmo repositório
// (`gravar --repos`).
import type { EngineInterface, Register } from 'claude-code'

const SCRIPT = 'skills/orchestrator/scripts/metricas.mjs'

type Decisao = { id: string; frente: string; pergunta: string; opcoes: string[] }
type Dados = {
  text: string
  detail?: string
  compactarEm?: number
  instrucoes?: string
  aviso?: string
  decisoes?: Decisao[]
  pendentes?: string
  naoRepassada?: string
  lembretes?: Record<string, string>
  outroLote?: string
  auto?: string
}

let faixa: Dados | null = null
let compactando = false
const respondidas = new Set<string>() // ids que o dono já viu perguntados ou respondeu
let cobrar: string[] = [] // respondidas que seguiam na fila no fim do turno: alerta amarelo

const MERGE_AUTO = /\bgh\s+pr\s+merge\b[^\n]*\s--auto\b/
const ID = /\b(D\d+)\b/

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void atualizar($).catch(() => {})
    return result
  })

  // Resposta "D3: …" digitada pelo dono: lembrete à principal de repassar no mesmo turno.
  on('prompt.submit', ($, e, next) => {
    if (e.isMeta || e.command || !faixa?.lembretes) return next(e)
    const ids = [...e.text.matchAll(/\b(D\d+)\s*:/g)].map(m => m[1]).filter(id => faixa?.lembretes?.[id])
    if (!ids.length) return next(e)
    for (const id of ids) respondidas.add(id)
    const notas = ids.map(id => faixa?.lembretes?.[id] ?? '')
    return next({ ...e, context: [...(e.context ?? []), ...notas] })
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
        {cobrar.length && faixa.naoRepassada ? (
          <Text color="yellow">{faixa.naoRepassada.replace('%IDS', cobrar.join(', '))}</Text>
        ) : null}
        {faixa.outroLote ? <Text color="yellow">{faixa.outroLote}</Text> : null}
        {faixa.pendentes ? <Text>{faixa.pendentes}</Text> : null}
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
  const antes = cobrar.join()
  cobrar = [...respondidas]
  if (cobrar.join() !== antes) $.ui.invalidate('ui.render')
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
