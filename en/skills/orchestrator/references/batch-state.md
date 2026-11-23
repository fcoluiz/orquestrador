# Batch state file

The main session keeps `<notes folder>/batch-<date>-state.md` and updates it on every relevant
change (session opened, commit, PR, merge, owner decision). It is what allows resuming if the
conversation drops.

Notes folder: the main session fixes **one absolute path** at the start of the batch, outside any
repo (e.g.: `<workspace root>/.claude/orchestrator/batch-<date>/`), records it in the state and
passes it in every brief.

```markdown
# Batch <date> — <theme>
Main: <id> · Skill: <absolute path of SKILL.md> · Production: back <hash> / front <hash>

## Fronts
| Front | Owner's items | Current owner (id, name) | Model · effort | Baton | Branch | Commits | PR back/front | Depends on | Migrations (DROP?) | Context at delivery | State |
|---|---|---|---|---|---|---|---|---|---|---|---|

"Context at delivery": the `context: ~Nk` from the last line of each of the front's session
summaries (e.g.: `240k → 160k` with one "(cont.)"). Used to measure the batch later without opening
transcripts.

## Queue (fronts waiting for a slot; at most 6 active)
- <front> · owner's items · topic (to reuse an idle child) · since <date>

## Metrics (update at the moment of each event)
- new sessions: 0 · reused children: 0 · subagents instead of a session: 0 · batons: 0
- PRs merged: 0 · main peak: ~0k
- batons (handoff:successor's start:successor's steps, in k): —
- estimated savings (output of `metricas.mjs gravar`): ~0k

"Subagent instead of a session" only counts when the task would have become a session under the
front-size rule (the secretary and short checks don't count). This section feeds the board's
metrics line and the Retrospective.

## Merge order
back: #A → #B (after #A) → …   front: …   held: #X (reason)

## Owner's merge ok (closed list)
- <date time> "owner's words" → back #A @<sha>, #B @<sha>; front #C @<sha>

## Owner's decisions (their words)
- <date time> "…" → applied in <front>

## Pending cards and batons
- task_id … (front, created on …)

## Items recorded for later
- …

## Deploy
backup …, migrations …, order …, result …

## Retrospective (end of batch)
- Fronts: N (new sessions X, reused children Y, "(cont.)" Z, subagents instead of a session W)
  and the final metrics line (from the "Metrics" section)
- Context at delivery per front (from the table) and the main session's peak
- Continuation-without-owner-message experiment: worked / refused / not tested
- What went wrong or cost a lot → becomes a new line in `pitfalls.md` (or in `app-limits.md` if it
  is app behavior)
```

At the end of the batch (everything merged/delivered or the owner closed it), the main session
fills in the Retrospective before archiving the last sessions and proposes the new lines for
`pitfalls.md` / `app-limits.md` to the owner; it only writes them into the skill with their ok.
