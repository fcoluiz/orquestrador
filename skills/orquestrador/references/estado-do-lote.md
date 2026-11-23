# Arquivo de estado do lote

A principal mantém `<pasta de notas>/lote-<data>-estado.md` e atualiza a cada mudança relevante
(sessão aberta, commit, PR, merge, decisão do dono). É o que permite retomar se a conversa cair.

Pasta de notas: a principal fixa **um caminho absoluto** no início do lote, fora de qualquer repo
(ex.: `<raiz do workspace>\.claude\orquestrador\lote-<data>\`), grava no estado e passa em todo brief.

```markdown
# Lote <data> — <tema>
Principal: <id> · Skill: <caminho absoluto do SKILL.md> · Produção: back <hash> / front <hash>

## Frentes
| Frente | Itens do dono | Dono atual (id, nome) | Bastão | Branch | Commits | PR back/front | Depende de | Migrations (DROP?) | Contexto ao entregar | Estado |
|---|---|---|---|---|---|---|---|---|---|---|

"Contexto ao entregar": o `contexto: ~Nk` da última linha do resumo de cada sessão da frente
(ex.: `240k → 160k` com uma "(cont.)"). Serve para medir o lote depois sem abrir transcrições.

## Fila (frentes esperando vaga; máximo de 6 ativas)
- <frente> · itens do dono · assunto (para reaproveitar filha ociosa) · desde <data>

## Métricas (atualizar no momento de cada evento)
- sessões novas: 0 · filhas reaproveitadas: 0 · subagentes no lugar de sessão: 0 · bastões: 0
- PRs mesclados: 0 · pico da principal: ~0k
- economia estimada: (reaproveitadas + subagentes) × 85k = ~0k

"Subagente no lugar de sessão" só conta quando a tarefa teria virado sessão pela regra de tamanho
de frente (não conta o secretário nem conferências curtas). Esta seção alimenta a linha de métricas
do quadro e a Retrospectiva.

## Ordem de merge
back: #A → #B (depois de #A) → …   front: …   segurados: #X (motivo)

## Ok de merge do dono (lista fechada)
- <data hora> "palavras do dono" → back #A @<sha>, #B @<sha>; front #C @<sha>

## Decisões do dono (palavras dele)
- <data hora> "…" → aplicado em <frente>

## Cards e bastões pendentes
- task_id … (frente, criado em …)

## Pendências registradas para depois
- …

## Deploy
backup …, migrations …, ordem …, resultado …

## Retrospectiva (fim do lote)
- Frentes: N (sessões novas X, filhas reaproveitadas Y, "(cont.)" Z, subagentes no lugar de sessão W)
  e a linha de métricas final (da seção "Métricas")
- Contexto ao entregar por frente (da tabela) e o pico da principal
- Experimento da continuação sem mensagem do dono: funcionou / recusado / não testado
- O que deu errado ou custou caro → vira linha nova em `armadilhas.md` (ou em `limites-do-app.md`
  se for comportamento do app)
```

No fim do lote (tudo mesclado/entregue ou o dono encerrou), a principal preenche a Retrospectiva
antes de arquivar as últimas sessões e propõe ao dono as linhas novas de `armadilhas.md` /
`limites-do-app.md`; só grava na skill com ok dele.
