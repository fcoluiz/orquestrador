// Band above the prompt with the orchestrator batch metrics (English edition).
//
// Só aparece na sessão principal que gravou métricas (`metricas.mjs gravar`); nas outras sessões
// e nas filhas o script não imprime nada e a faixa fica vazia. Atualiza ao fim de cada turno, sem
// segurar o turno; qualquer falha só cala a faixa, nunca a sessão.
import type { EngineInterface, Register } from 'claude-code'

const SCRIPT = 'skills/orchestrator/scripts/metricas.mjs'

let faixa: { text: string; detail?: string } | null = null

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void atualizar($).catch(() => {})
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

async function atualizar($: EngineInterface) {
  const sid = await $.session.id()
  const r = await $.process.run(['node', `${$.plugin.root}/${SCRIPT}`, 'faixa', `--session=${sid}`], {
    timeoutMs: 5000,
  })
  const out = r.exitCode === 0 ? r.stdout.trim() : ''
  const novo = out ? (JSON.parse(out) as { text: string; detail?: string }) : null
  if (JSON.stringify(novo) === JSON.stringify(faixa)) return
  faixa = novo
  $.ui.invalidate('ui.render')
}
