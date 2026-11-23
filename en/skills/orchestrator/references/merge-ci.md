# PR, merge, CI and deploy

## PR
- Only with the owner's ok for PRs. The child runs `git fetch`, confirms 0 behind production, pushes
  and opens the PR on the production remote (never on upstream). Description: what changed, tests,
  **not verified**, migrations, "Depends on #N — merge after" at the top when stacked, the other
  repo's PR, attribution line.
- The main session checks with one line per PR, never the full `gh pr view`:
  `gh pr list -R <r> --json number,headRefName,mergeable,headRefOid --jq '.[]|"#\(.number) \(.headRefName) \(.mergeable) \(.headRefOid[0:12])"'`
  and `gh pr checks <n> -R <r> | grep -v pass` (only what didn't pass remains).

## Merge (with one owner ok per batch)
- **The ok covers a closed list:** on receiving the ok, the main session records in the state each
  PR with its head SHA at that moment. It only merges that SHA (`--match-head-commit`). If the
  child pushes after the ok (e.g.: to resolve a conflict), the new SHA joins the list only if the
  change is what the main session asked for (merge from production/CI fix) and it checks the diff;
  a scope change → ask the owner for an ok again.
- Order from the state's dependency table. Stacked PRs only after the base; before that, check
  that only their own commits remain (`gh api repos/<r>/compare/<prod>...<branch>` → `ahead_by`).
- Use the repository's method (e.g.: `gh pr merge --merge`).
- Wait and merge in the background:

```bash
# usage: mergeit <owner/repo> <pr> <approved sha>
mergeit(){ R=$1; n=$2; sha=$3; gh pr checks $n -R $R --watch --interval 30 >/dev/null 2>&1
  for i in $(seq 1 20); do st=$(gh pr view $n -R $R --json state,mergeable,headRefOid,statusCheckRollup \
    --jq '"\(.state) \(.mergeable) \(.headRefOid[0:12]) \([.statusCheckRollup[]|(.conclusion // .status)]|map(select(.!="SKIPPED" and .!="NEUTRAL"))|unique|join(","))"' 2>/dev/null)
    case "$st" in ""|*UNKNOWN*|*PENDING*|*IN_PROGRESS*|*QUEUED*) sleep 15;; *) break;; esac; done
  echo "$R#$n $st"
  [ "$st" = "OPEN MERGEABLE ${sha:0:12} SUCCESS" ] || { echo "STOP $R#$n"; return 1; }
  gh pr merge $n -R $R --merge --match-head-commit "$sha" || { sleep 10; gh pr merge $n -R $R --merge --match-head-commit "$sha"; } && echo "merged $R#$n"; }
mergeit <repo> <n> <sha> && mergeit <repo> <m> <sha>
```
- Run it in `run_in_background` only if the main session's `gh pr merge` permission won't ask for
  approval (otherwise the prompt goes unanswered); when in doubt, run the first merge in the
  foreground.
- `MERGEABLE` turns `UNKNOWN` for a few seconds after each merge: wait, don't give up.
- Network failure in `gh` → retry once.
- Stop at the first problem:
  - **CONFLICTING** → the owning child runs `git merge origin/<prod>` (no rebase/force-push),
    resolves it keeping both intents, tests, pushes. Business rule in the conflict → ask the main
    session.
  - **CI failed/cancelled** → read the end of the log (`gh run view <id> --log-failed | tail -n 40`;
    on a cancelled run it may be empty → `--log | tail -n 60`; if that's not enough, a subagent
    reads the whole log and returns the excerpt with the cause); a timeout can be a real failure
    (e.g.: a suite that doesn't load + Jest stuck). Send it back to the child with the log excerpt.
    Rerun only if it's infrastructure (`gh run rerun <id>`).
- Back/front pairs: merge a feature's front end after (or together with) its back end; note it in
  the state.

## Deploy (only on the owner's explicit request)
- Follow the project's runbook (CLAUDE.md/docs). Default: database backup and a read check →
  transport (pull or a SHA-256-verified bundle) with fast-forward in a clean clone → migrations via
  the runner (order, owner's ok for DROP) → enable each environment separately (reload one process
  at a time) → health checks, hashes on the hosts matching what was published, counts before/after.
- Record it in the state and in the project's memory. New features off by default: list them for
  the owner to turn on.
