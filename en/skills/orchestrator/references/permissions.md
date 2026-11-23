# Suggested allowlist (the owner approves before applying)

Goal: children don't stall on routine, safe commands. Apply it in the **project's**
`settings.json` (`.claude/settings.json`) or the user's, via the `update-config` skill. Never apply
it without an ok. Check the current rule syntax with `update-config` before applying.

```json
{
  "permissions": {
    "allow": [
      "Bash(git fetch *)", "Bash(git status *)", "Bash(git log *)", "Bash(git diff *)",
      "Bash(git rev-parse *)", "Bash(git rev-list *)", "Bash(git merge-base *)",
      "Bash(git worktree add *)", "Bash(git worktree list *)",
      "Bash(git add *)", "Bash(git commit *)", "Bash(git merge origin/*)",
      "Bash(gh pr view *)", "Bash(gh pr list *)", "Bash(gh pr checks *)",
      "Bash(gh run list *)", "Bash(gh run view *)", "Bash(gh api repos/*/compare/*)",
      "Bash(npm test *)", "Bash(npm run lint *)", "Bash(npx tsc *)", "Bash(npx vitest *)"
    ],
    "deny": [
      "Bash(git push --force *)", "Bash(git push -f *)", "Bash(git reset --hard *)",
      "Bash(git clean *)", "Bash(git rebase *)", "Bash(git push --delete *)"
    ]
  }
}
```

Left **out** on purpose (asks for approval, or the auto-mode classifier decides):
- `git push` and `gh pr create` — a prefix doesn't prevent a dangerous refspec (`HEAD:main`,
  `+branch`, `--force` at the end). The child only does it when the main session says so, quoting
  the owner's ok.
- `gh pr merge` — main session only, with the owner's ok per batch.
- Deploy, migrations, `docker compose`, `pm2` — only on the owner's explicit request.
- Generic `ssh` — a prefix doesn't restrict the remote command. To read production, create a
  read-only query script (e.g.: `q.sh` with `SET default_transaction_read_only = on` and
  `statement_timeout`) and allow **only that script**: `Bash(bash <absolute path>/q.sh *)`.

If the child is in auto mode, the allowlist matters less (the classifier decides), but the `deny`
still applies.
