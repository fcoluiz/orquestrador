# PR, merge, CI e deploy

## PR
- Só com ok do dono para PRs. A filha faz `git fetch`, confirma 0 atrás da produção, push e PR no
  remoto de produção (nunca no upstream). Descrição: o que mudou, testes, **não verificado**,
  migrations, "Depende de #N — mesclar depois" no topo quando empilhado, PR do outro repo, linha de
  atribuição.
- A principal confere com saída de uma linha por PR, nunca o `gh pr view` completo:
  `gh pr list -R <r> --json number,headRefName,mergeable,headRefOid --jq '.[]|"#\(.number) \(.headRefName) \(.mergeable) \(.headRefOid[0:12])"'`
  e `gh pr checks <n> -R <r> | grep -v pass` (sobra só o que não passou).

## Merge (com um ok do dono por lote)
- **O ok vale para uma lista fechada:** ao receber o ok, a principal grava no estado cada PR com o
  SHA do head naquele momento. Só mescla esse SHA (`--match-head-commit`). Se a filha fizer push
  depois do ok (ex.: resolver conflito), o SHA novo entra na lista só se a mudança for o que a
  principal pediu (merge da produção/correção de CI) e ela conferir o diff; mudança de escopo →
  pede ok de novo ao dono.
- Ordem pela tabela de dependências do estado. Empilhados só depois da base; antes, conferir que
  sobraram só os commits próprios (`gh api repos/<r>/compare/<prod>...<branch>` → `ahead_by`).
- Usar o método do repositório (ex.: `gh pr merge --merge`).
- **Nunca `gh pr merge --auto`** para "mesclar quando o CI passar": ele só espera checks
  **obrigatórios**; num repositório sem nenhum, mescla na hora. O plugin recusa o comando. O
  caminho é o `mergeit` abaixo, que espera os checks, para se não houver check verde e confere o
  SHA aprovado.
- Esperar e mesclar em segundo plano:

```bash
# uso: mergeit <owner/repo> <pr> <sha aprovado>
mergeit(){ R=$1; n=$2; sha=$3; gh pr checks $n -R $R --watch --interval 30 >/dev/null 2>&1
  for i in $(seq 1 20); do st=$(gh pr view $n -R $R --json state,mergeable,headRefOid,statusCheckRollup \
    --jq '"\(.state) \(.mergeable) \(.headRefOid[0:12]) \([.statusCheckRollup[]|(.conclusion // .status)]|map(select(.!="SKIPPED" and .!="NEUTRAL"))|unique|join(","))"' 2>/dev/null)
    case "$st" in ""|*UNKNOWN*|*PENDING*|*IN_PROGRESS*|*QUEUED*) sleep 15;; *) break;; esac; done
  echo "$R#$n $st"
  [ "$st" = "OPEN MERGEABLE ${sha:0:12} SUCCESS" ] || { echo "STOP $R#$n"; return 1; }
  gh pr merge $n -R $R --merge --match-head-commit "$sha" || { sleep 10; gh pr merge $n -R $R --merge --match-head-commit "$sha"; } && echo "merged $R#$n"; }
mergeit <repo> <n> <sha> && mergeit <repo> <m> <sha>
```
- Rodar em `run_in_background` só se a permissão de `gh pr merge` da principal não for pedir
  aprovação (senão o prompt fica sem resposta); na dúvida, rodar o primeiro merge em primeiro plano.
- `MERGEABLE` vira `UNKNOWN` por alguns segundos depois de cada merge: esperar, não desistir.
- Falha de rede no `gh` → tentar de novo uma vez.
- Para no primeiro problema:
  - **CONFLICTING** → a filha dona faz `git merge origin/<prod>` (sem rebase/force-push), resolve
    preservando as duas intenções, testa, push. Regra de negócio no conflito → pergunta à principal.
  - **CI falhou/cancelou** → ler o fim do log (`gh run view <id> --log-failed | tail -n 40`; em run
    cancelado pode vir vazio → `--log | tail -n 60`; se não bastar, subagente lê o log inteiro e devolve o trecho da causa); timeout pode ser
    falha real (ex.: suíte que não carrega + Jest preso). Devolver à filha com o trecho do log.
    Rerun só se for infra (`gh run rerun <id>`).
- Pares back/front: mesclar o front de uma feature depois (ou junto) do back dela; anotar no estado.

## Deploy (só com pedido explícito do dono)
- **Conferir antes, montar na hora.** Imediatamente antes de cada deploy: versão no servidor
  (commit/tag/hash publicado) × ponta da branch × último deploy anotado no estado. Servidor com
  algo que o estado não conhece (outro lote ou outra pessoa publicou) → parar e levar ao dono. A
  sequência de deploy se monta a partir dessa conferência, nunca de instruções escritas antes.
- Outro lote ativo no mesmo repositório (aviso na faixa, ou `--repos` em comum) → a mesma
  conferência antes de cada merge também: `git fetch` e o que entrou no main desde o último merge
  do lote.
- Seguir o runbook do projeto (CLAUDE.md/docs). Padrão: backup do banco e conferir leitura →
  transporte (pull ou bundle verificado por SHA-256) com fast-forward em clone limpo → migrations
  pelo runner (ordem, ok do dono para DROP) → ativar cada ambiente separadamente (recarregar um
  processo por vez) → health checks, hashes nos hosts iguais ao publicado, contagens antes/depois.
- Registrar no estado e na memória do projeto. Funções novas desligadas por padrão: listar para o
  dono ligar.
