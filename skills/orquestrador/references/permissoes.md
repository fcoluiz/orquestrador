# Allowlist sugerida (o dono aprova antes de aplicar)

Objetivo: as filhas não travarem em comandos rotineiros e seguros. Aplicar no `settings.json` do
**projeto** (`.claude/settings.json`) ou do usuário, via skill `update-config`. Nunca aplicar sem ok.
Conferir a sintaxe atual das regras com `update-config` antes de aplicar.

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

Fica **fora** de propósito (pede aprovação, ou o classificador do modo auto decide):
- `git push` e `gh pr create` — prefixo não impede refspec perigoso (`HEAD:main`, `+branch`,
  `--force` no fim). A filha só faz quando a principal mandar citando o ok do dono.
- `gh pr merge` — só a principal, com o ok do dono por lote.
- Deploy, migrations, `docker compose`, `pm2` — só com pedido explícito do dono.
- `ssh` genérico — prefixo não restringe o comando remoto. Para leitura de produção, criar um
  script de consulta somente leitura (ex.: `q.sh` com `SET default_transaction_read_only = on` e
  `statement_timeout`) e liberar **só esse script**: `Bash(bash <caminho absoluto>/q.sh *)`.

Se a filha estiver em modo auto, a allowlist pesa menos (o classificador decide), mas o `deny`
continua valendo.
