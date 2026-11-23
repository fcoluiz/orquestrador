# App limits that shape the design

Observed in practice in the Claude desktop app (Code tab), in November 2026. Re-check if the app
changes.

| Limit | Consequence for the orchestrator |
|---|---|
| A session only receives end-of-turn notices from the sessions **it created**. | The main session never replaces itself. If a "(cont.)" of the main session existed, the notices would keep going to the old one. Children must reply by `SendMessage` straight to the main session's id. |
| `start_session` with `user_asked` is **refused** when the turn was started by another session or an automated event (task-notification, side-sessions-event). | In those turns, the main session can only propose a card (`own_initiative`). It starts the card with `proposal_id` on the owner's next message. |
| A child cannot create sessions that the main session controls. | A child never creates a session. It asks the main session. |
| `SendMessage` may answer "not delivered in 20 s" and still deliver later. | Check with `get_session` (`isRunning`, `lastActivityAt`). Don't resend. |
| A message to a busy session is **queued** and runs at the end of the current turn. | You can send the next task before the child finishes; it picks them up in order. Never queue for a child that is handing off its baton: send only to the current `owner:`. |
| A permission denied in a child (e.g.: SSH, `gh pr merge`) cannot be worked around by another session. | The main session **never** runs it on the child's behalf. Ways out: the owner approves in that session; or the allowlist is adjusted beforehand. Actions that already belong to the main session (merge, deploy) it does with its own permission when the **owner asks it**, not because the child was blocked. |
| A child may sit on a permission prompt without raising a notice. | Every round, the main session checks children with no activity (`get_session`: `isRunning`, `lastActivityAt`) and tells the owner which session awaits approval. |
| `archive_session` in auto mode may come back asking to repeat with the `session` field the hook generated. | Repeat once with exactly the quoted input. If denied again, tell the owner. |
| `archive_session` refuses a session with a live background task. | Try again later or leave it to the owner via the sidebar. |
| Archiving a session created with the app's worktree deletes the worktree. | Sessions with `use_worktree: false` (git worktree created by the child itself) lose nothing; even so, only archive with the PR merged or the work already delivered. |
| `own_initiative` cards expire in 7 days. | Record the `task_id` in the batch state. |

## Experimental (optional, unconfirmed): continuation without an owner message

Hypothesis: the app's rules open an exception to the refusal above — in a `<side-sessions-event>`
turn that comes right after the owner's own turn (or another such turn), the main session may start
a session for a step the **owner already asked** to run in its own session. The refusal seen in
practice may have been because the request didn't say so, or because the turn was started by a
child's `SendMessage` (which stays refused).

How to test without risk (the current path remains the fallback):
1. At the start of the batch, the main session asks the owner for an explicit sentence, in their
   words, such as "each front and each context continuation runs in its own session; you may start
   them". Record it in the state under "Owner's decisions".
2. When there is a pending baton and the turn is a `<side-sessions-event>`, try `start_session`
   with `initiation: "user_asked"` for the "(cont.)", with the usual brief.
3. Accepted → follow the baton protocol as usual (write `owner:` etc.). Refused → propose the card
   (`own_initiative`) as today. Turn started by a child's `SendMessage` → don't even try: card.
4. Record the result in the state's Retrospective and, once confirmed in two batches, move it to
   the table above and simplify the baton.
