# orquestrador / orchestrator

English · [Português](README.md)

A skill for the **Claude desktop app (Code tab)** that turns one session into the **manager of a
batch of work**. It splits your request into independent fronts, opens a child session for each,
tracks all of them and brings you only what needs your decision.

You talk to **one** session. The children work in parallel, each in its own worktree, and never
talk to you directly.

> Two editions of the same skill: **`orchestrator`** (English, `en/`) and **`orquestrador`**
> (Portuguese, `skills/`). Install only one of them.

## Why use it

- **Many requests at once, without losing track.** A list of 5–10 asks becomes parallel fronts.
  The main session keeps a state file with each front's owner, branch, PR, dependencies and your
  decisions. If the conversation drops, it resumes from that file.
- **Context that doesn't blow up.** When a child reaches ~200k tokens, it hands the "baton" to a new
  session through the skill's protocol: handoff note, WIP commit, one owner per front. No work is
  duplicated or lost. Measured: near 270k, each step costs twice as much as a step at ~120k.
- **Cost under control.** Every new session pays a floor of ~85k tokens. So the skill decides what
  becomes a session, what becomes a subagent, and when to reuse an idle child on the same topic.
  Read-only analysis runs on a cheaper model (Sonnet, or Haiku for mechanical sweeps).
- **You approve, and nobody approves for you.** PR, merge, migration and deploy happen only with
  your ok, and the main session quotes your words when it passes a decision on. A child's message
  never counts as approval. A merge ok covers a closed list of PRs **pinned to their SHA** at that
  moment: a push after the ok needs a new check.
- **Safe merges.** The main session merges only with green CI and no conflict, in dependency order.
  A conflict goes back to the owning child as a `git merge` from production, never a rebase or
  force-push.
- **"Done" is verified.** Every child's delivery is checked in git/GitHub before it reaches you.
- **A board every round.** Every reply from the main session ends with one line per front (state
  and who waits on what), so no front drops out of sight by going quiet.
- **Learns from use.** Each batch ends with a retrospective, and what went wrong becomes a new line
  in `pitfalls.md`, with your ok.

### In real use

In two back-to-back batches on a real project (back end + front end), over about three days:

- ~20 fronts, across fixes, features, analyses and tests;
- 5 context handoffs, with no work lost or duplicated;
- 9 deploys, each one only on the owner's explicit request, always back end before front end;
- analysis fronts running on a cheaper model.

## Requirements

- **Claude desktop app, Code tab**, for full orchestration. The skill relies on the app's session
  tools (`start_session`, `SendMessage`, `get_session`, `list_events`, `archive_session`). Outside
  it, see "Claude and Codex" above.
- `git`. An authenticated `gh` if you want PRs and merges on GitHub.

## Claude and Codex

| | Claude desktop (Code tab) | Claude Code in the terminal (CLI) | Codex |
|---|---|---|---|
| Reads the skill | yes | yes | yes (`~/.codex/skills/`) |
| Opens and drives child sessions by itself | **yes** | no | no |
| Automatic context handoff | **yes** | no | no |
| Batch state, briefs, SHA-pinned merge, pitfalls | yes | yes (manual) | yes (manual) |
| How to call it | `/orchestrator` | `/orchestrator` | `$orchestrator`, or ask "use the orchestrator skill" |

**Full orchestration works only in the Claude desktop app**, because the skill depends on session
tools that exist only there. In the CLI and in Codex it still works as a **manual method**: the
main session splits the fronts, writes the batch state and drafts one brief per front. You open
each session and paste its brief. The rules for PRs, SHA-pinned merges, verifying "done" and the
pitfalls still apply. In Codex, `disable-model-invocation` has no effect, so it may suggest the
skill on its own.

## Install

**As a plugin (recommended):**

```
/plugin marketplace add fcoluiz/orquestrador
/plugin install orchestrator@orquestrador
```

(For the Portuguese edition: `/plugin install orquestrador@orquestrador`.)

The same from a terminal, outside a session:

```
claude plugin marketplace add fcoluiz/orquestrador
```
```
claude plugin install orchestrator@orquestrador
```

**Manually (Claude):** copy `en/skills/orchestrator/` to `~/.claude/skills/orchestrator/`.

**Codex (manual mode):** copy the same folder to `~/.codex/skills/orchestrator/`.

From a terminal (Git Bash, macOS or Linux):

```
git clone https://github.com/fcoluiz/orquestrador.git
```
```
cp -r orquestrador/en/skills/orchestrator ~/.claude/skills/
```
```
cp -r orquestrador/en/skills/orchestrator ~/.codex/skills/
```

**Update:** `claude plugin update orchestrator@orquestrador` (or `git pull` and copy again).

## Usage

The skill **does not trigger by itself** (`disable-model-invocation`). Call it with your requests:

```
/orchestrator
1 - fix the date-range filter in reports
2 - "All" tab visible to admins only
3 - estimate the cost of transcribing videos (analysis only)
```

When installed as a plugin, the command also shows up as `/orchestrator:orchestrator`.

What happens:

1. The main session picks a notes folder outside the repos and creates the **batch state** file.
2. It suggests a permission allowlist so children don't stall on routine commands. It is applied
   only with your ok.
3. It splits the requests into fronts that don't touch the same files and opens the sessions, at
   most 6 active. The rest wait in a queue.
4. Each child works in its own worktree and delivers a local commit, a report file and a summary
   of up to 8 lines.
5. The main session verifies the work, then asks for your ok for PRs, then for the merge and, if
   you ask, for the deploy.
6. Finished sessions are archived in bulk. The batch ends with the retrospective.

**Tip:** don't click the "(cont.)" cards that show up. The main session starts them itself, at the
right point of the handoff protocol.

## Lifecycle of a front

```
brief → work (local commit + report) → verification → PR (your ok)
      → merge on green CI (your ok, per SHA) → deploy (only if asked) → archive
                 ↘ context ~200k: baton handoff to a "(cont.)" session
```

## Layout

English edition, in `en/skills/orchestrator/` (the Portuguese one in `skills/orquestrador/` has
the same files under Portuguese names):

| File | Purpose | Read by |
|---|---|---|
| `SKILL.md` | Main-session rules, lifecycle, context economy | main |
| `references/app-limits.md` | App limits that shape the design | main |
| `references/child-brief.md` | Template for each child's brief | main |
| `references/baton.md` | Context handoff (baton) protocol | main and children |
| `references/batch-state.md` | Batch state file template | main |
| `references/merge-ci.md` | PR, SHA-pinned merge, CI, deploy | main |
| `references/permissions.md` | Suggested allowlist (apply only with ok) | main |
| `references/pitfalls.md` | Pitfalls seen in practice | main |

## Limitations

- The app limits were observed in November 2026 and may change with new versions. They are
  documented in `app-limits.md`.
- The "Experimental" section of `app-limits.md` (starting the continuation without waiting for
  your message) is optional and unconfirmed. Without it, the skill works with cards.

## License

MIT
