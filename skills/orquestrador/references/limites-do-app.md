# Limites do app que decidem o desenho

Observados na prática no app Claude desktop (aba Code), em novembro de 2026. Revalide se o app mudar.

| Limite | Consequência para o orquestrador |
|---|---|
| Uma sessão só recebe os avisos de fim de turno das sessões **que ela criou**. | A principal nunca se substitui. Se uma "(cont.)" da principal existir, os avisos continuam indo para a antiga. Filhas devem responder por `SendMessage` direto ao id da principal. |
| `start_session` com `user_asked` é **recusado** quando o turno nasceu de outra sessão ou de evento automático (task-notification, side-sessions-event). | Nesses turnos, a principal só pode propor card (`own_initiative`). Inicia o card com `proposal_id` na próxima mensagem do dono. |
| Uma filha não consegue criar sessões que a principal controle. | Filha nunca cria sessão. Pede à principal. |
| `SendMessage` pode responder "não entregue em 20 s" e mesmo assim entregar depois. | Conferir com `get_session` (`isRunning`, `lastActivityAt`). Não reenviar. |
| Mensagem para sessão ocupada fica **na fila** e roda ao fim do turno atual. | Pode mandar a próxima tarefa antes de a filha terminar; ela pega em ordem. Nunca enfileirar para uma filha que está passando o bastão: mandar só para o `dono:` atual. |
| Permissão negada numa filha (ex.: SSH, `gh pr merge`) não pode ser contornada por outra sessão. | A principal **nunca** executa a pedido da filha. Saídas: o dono aprova naquela sessão; ou a allowlist é ajustada antes. Ações que já são da principal (merge, deploy) ela faz com a própria permissão quando o **dono pede a ela**, não porque a filha foi bloqueada. |
| Uma filha pode ficar parada num prompt de permissão sem gerar aviso. | A cada rodada, a principal confere filhas sem atividade (`get_session`: `isRunning`, `lastActivityAt`) e avisa o dono qual sessão espera aprovação. |
| `archive_session` em auto mode pode voltar pedindo para repetir com o campo `session` que o hook gerou. | Repetir uma vez com exatamente o input citado. Se negar de novo, avisar o dono. |
| `archive_session` recusa sessão com tarefa em segundo plano viva. | Tentar de novo depois ou deixar para o dono pela barra lateral. |
| Arquivar sessão criada com worktree do app apaga o worktree. | Sessões com `use_worktree: false` (worktree git criado pela própria filha) não perdem nada; mesmo assim, só arquivar com PR mesclado ou trabalho já entregue. |
| Cards `own_initiative` expiram em 7 dias. | Registrar o `task_id` no estado do lote. |

## Experimental (opcional, não confirmado): continuação sem mensagem do dono

Hipótese: as regras do app abrem uma exceção à recusa acima — num turno `<side-sessions-event>`
que vem logo depois de um turno do próprio dono (ou de outro turno desses), a principal pode
iniciar uma sessão para um passo que o **dono já pediu** que rodasse em sessão própria. A recusa
observada na prática pode ter sido porque o pedido não dizia isso, ou porque o turno nasceu de
`SendMessage` de filha (que continua recusado).

Como testar sem risco (o caminho atual continua sendo o reserva):
1. No início do lote, a principal pede ao dono uma frase explícita, nas palavras dele, como
   "cada frente e cada continuação por contexto rodam em sessão própria; pode iniciá-las". Grava
   no estado em "Decisões do dono".
2. Quando houver bastão pendente e o turno for um `<side-sessions-event>`, tentar `start_session`
   com `initiation: "user_asked"` para a "(cont.)", com o mesmo brief de sempre.
3. Aceito → seguir o protocolo do bastão normalmente (gravar `dono:` etc.). Recusado → propor o
   card (`own_initiative`) como hoje. Turno nascido de `SendMessage` de filha → nem tentar: card.
4. Registrar o resultado na Retrospectiva do estado e, confirmado em dois lotes, mover para a
   tabela acima e simplificar o bastão.
