// Faixa acima do prompt com as métricas do lote do orquestrador, e compactação automática da
// sessão principal.
//
// Só age na sessão principal que gravou métricas (`metricas.mjs gravar`); nas outras sessões e
// nas filhas o script não imprime nada, a faixa fica vazia e nada é compactado. Ao fim de cada
// turno da principal: redesenha a faixa e, com o contexto em `compactarEm` (padrão 200k) ou mais,
// compacta com as instruções que mantêm os caminhos do estado do lote e da skill. Qualquer falha
// só cala a faixa ou adia a compactação para o próximo turno, nunca derruba a sessão.
//
// Com decisões na fila (`metricas.mjs decisao`), a faixa vira um card por decisão, com ‹ › para
// passar entre elas e um botão por opção. O botão só preenche o prompt ("D2: sim"); o dono envia.
//
// Travas, só na principal com lote ativo: a resposta "Dn: …" do dono leva um lembrete de repassar
// à filha no mesmo turno, e a faixa acusa a decisão respondida que ainda está na fila no fim do
// turno; `gh pr merge --auto` é recusado (sem check obrigatório, ele mescla na hora); e a faixa
// avisa quando outra principal ativa registrou o mesmo repositório (`gravar --repos`).
import type { EngineInterface, Register } from 'claude-code'

const SCRIPT = 'skills/orquestrador/scripts/metricas.mjs'

type Decisao = { id: string; frente: string; pergunta: string; opcoes: string[]; contexto?: string; relatorio?: string }
type Rotulos = { decisao: string; de: string; frente: string; anterior: string; proxima: string; responder: string; relatorio: string }
type Dados = {
  text: string
  detail?: string
  compactarEm?: number
  instrucoes?: string
  aviso?: string
  decisoes?: Decisao[]
  rotulos?: Rotulos
  naoRepassada?: string
  lembretes?: Record<string, string>
  outroLote?: string
  auto?: string
}

let faixa: Dados | null = null
let compactando = false
let indice = 0 // decisão mostrada no card; os botões ‹ › a mudam
const respondidas = new Set<string>() // ids que o dono respondeu nesta sessão

const MERGE_AUTO = /\bgh\s+pr\s+merge\b[^\n]*\s--auto\b/

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void atualizar($).catch(() => {})
    return result
  })

  // Resposta "D3: …" do dono: lembrete à principal de repassar no mesmo turno.
  on('prompt.submit', ($, e, next) => {
    if (e.isMeta || e.command || !faixa?.lembretes) return next(e)
    const ids = [...e.text.matchAll(/\b(D\d+)\s*:/g)].map(m => m[1]).filter(id => faixa?.lembretes?.[id])
    if (!ids.length) return next(e)
    for (const id of ids) respondidas.add(id)
    const notas = ids.map(id => faixa?.lembretes?.[id] ?? '')
    return next({ ...e, context: [...(e.context ?? []), ...notas] })
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!MERGE_AUTO.test(e.command)) return next(e)
    const d = faixa ?? (await carregar($).catch(() => null))
    return d?.auto ? { deny: d.auto } : next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || faixa === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const fila = faixa.decisoes ?? []
    const r = faixa.rotulos
    const pendentes = fila.filter(x => respondidas.has(x.id)).map(x => x.id)
    const alertas = (
      <Box flexDirection="column">
        {pendentes.length && faixa.naoRepassada ? (
          <Text color="yellow">{faixa.naoRepassada.replace('%IDS', pendentes.join(', '))}</Text>
        ) : null}
        {faixa.outroLote ? <Text color="yellow">{faixa.outroLote}</Text> : null}
      </Box>
    )
    const metricas = (
      <Box flexDirection="column">
        {alertas}
        <Text dimColor>{faixa.text}</Text>
        {faixa.detail ? <Text dimColor>{faixa.detail}</Text> : null}
      </Box>
    )
    if (!fila.length || !r) return metricas

    indice = Math.min(Math.max(indice, 0), fila.length - 1)
    const d = fila[indice]
    const mover = (passo: number) => {
      indice = Math.min(Math.max(indice + passo, 0), fila.length - 1)
      $.ui.invalidate('ui.render')
    }
    // O clique só preenche o prompt: quem envia é o dono, com Enter, e a resposta é dele.
    const preencher = (texto: string) => $.prompt.fill({ text: texto, mode: 'replace' })
    return (
      <Box flexDirection="column">
        {alertas}
        <Box alignItems="center" columnGap="xs">
          <Text bold wrap="truncate-end">{`🎼 ${r.decisao} ${indice + 1} ${r.de} ${fila.length} · ${d.id} · ${r.frente} ${d.frente}  `}</Text>
          {indice > 0 ? <Button key="ant" label={r.anterior} onPress={() => mover(-1)} /> : null}
          {indice < fila.length - 1 ? <Button key="prox" label={r.proxima} onPress={() => mover(1)} /> : null}
        </Box>
        <Text>{`   ${d.pergunta}`}</Text>
        {d.contexto ? <Text dimColor wrap="truncate-end">{`   ${d.contexto}`}</Text> : null}
        {/* só o nome do arquivo: caminho longo quebrava a linha e os botões cobriam o texto */}
        {d.relatorio ? <Text dimColor wrap="truncate-end">{`   ${r.relatorio}: ${nomeArquivo(d.relatorio)}`}</Text> : null}
        <Box marginTop="xs" marginBottom="xs" paddingLeft={3} columnGap="xs" alignItems="center">
          {d.opcoes.map((op, i) => (
            <Button key={`op-${d.id}-${i}`} label={op} onPress={() => preencher(`${d.id}: ${op}`)} />
          ))}
          <Button key={`resp-${d.id}`} label={r.responder} onPress={() => preencher(`${d.id}: `)} />
        </Box>
        {/* com card na tela, as métricas ficam numa linha só, para a faixa não crescer */}
        <Text dimColor>{faixa.text}</Text>
      </Box>
    )
  })
}

function nomeArquivo(p: string) {
  return p.split(/[\/]/).pop() || p
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
