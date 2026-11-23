// Faixa acima do prompt com as métricas do lote do orquestrador, e compactação automática da
// sessão principal.
//
// Só age na sessão principal que gravou métricas (`metricas.mjs gravar`); nas outras sessões e
// nas filhas o script não imprime nada, a faixa fica vazia e nada é compactado. Ao fim de cada
// turno da principal: redesenha a faixa e, com o contexto em `compactarEm` (padrão 200k) ou mais,
// compacta com as instruções que mantêm os caminhos do estado do lote e da skill. Qualquer falha
// só cala a faixa ou adia a compactação para o próximo turno, nunca derruba a sessão.
import type { EngineInterface, Register } from 'claude-code'

const SCRIPT = 'skills/orchestrator/scripts/metricas.mjs'

type Dados = { text: string; detail?: string; compactarEm?: number; instrucoes?: string; aviso?: string }

let faixa: Dados | null = null
let compactando = false

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void atualizar($).catch(() => {})
    return result
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

async function atualizar($: EngineInterface) {
  const sid = await $.session.id()
  const r = await rodar($, ['faixa', `--session=${sid}`])
  const out = r.exitCode === 0 ? r.stdout.trim() : ''
  const novo = out ? (JSON.parse(out) as Dados) : null
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
