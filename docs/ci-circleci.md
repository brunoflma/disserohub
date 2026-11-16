# Verificação CircleCI

A configuração em `.circleci/config.yml` usa Node.js 22.12. Os triggers do projeto selecionam pull requests e pushes para `main`; o consumidor de release exige especificamente um push de `main`, nunca uma prova de PR/API no mesmo SHA.

| Ordem | Comando |
| --- | --- |
| 1 | npm ci |
| 2 | npm run typecheck |
| 3 | node docs/onboarding/check-capacity-cases.mjs |
| 4 | npm test |
| 5 | npm run build |

Após o checkout, o job remove helpers e cabeçalhos Git de credenciais visíveis, o arquivo ~/.git-credentials e identidades carregadas no agente SSH; também remove variáveis de autenticação GitHub das etapas seguintes. Essa limpeza é best-effort: não comprova nem controla credenciais mantidas fora do ambiente do job pelo provedor.

## Gate do publicador

`scripts/release.ts` consulta o CircleCI CLI oficial já autenticado. `CIRCLECI_CLI` pode indicar o caminho do executável; sem essa variável, usa `circleci` no PATH. O login fica no armazenamento próprio do CLI, fora do repositório. Somente leitura é necessária para esse gate; não crie PAT novo nem grave tokens em arquivos do produto.

```powershell
$env:CIRCLECI_CLI = 'C:\Tools\circleci.exe'
npm run release -- --check-ci
```

`--check-ci` funciona também em checkout de trabalho: consulta `refs/heads/main` com `git ls-remote`, sem fetch, criação de refs, versão ou tag. Revalida a referência após o CI e retorna a prova do SHA remoto completo. Isso verifica somente elegibilidade de CI; não autoriza nem publica uma release.

`--dry-run` conserva a conferência local de versão/notas e não consulta CI. O caminho normal de publicação conserva main limpa/sincronizada, origin e package.json dedicados ao fork, alinhamento da versão/base/changelog e recusa de tag existente; consulta CI antes de criar qualquer tag. Não combine `--dry-run` com `--check-ci`.

O gate em `scripts/release-ci.ts` usa apenas GET pelos CLIs, com estes vínculos:

- Projeto `00f1e232-fe64-455d-a441-42f4619ffb4f`, organização `f85f07d9-7ed4-4135-a871-b1bcee70304a` e definição `34c71e1f-260c-4f59-ae03-a8377d27eaeb`.
- Repositório GitHub `brunoflma/disserohub`, ID `1419434722`, tanto para configuração quanto para checkout.
- SHA de 40 caracteres em `GET /api/v3/runs/{id}` → `data.references.event.attributes.vcs.revision`, além do checkout/evento em `GET /api/v2/pipeline/{id}`.
- Run mais recente de main/definição com `phase=ended/current_outcome=succeeded`; workflow `verify_main_and_pull_requests` mais recente em `success`; job de build `verify` realmente presente, terminado e bem-sucedido. As rotas v2 de workflow/jobs e detalhe do job conferem seus IDs, projeto, organização e pipeline.

O resumo `circleci run list --json` abrevia o SHA neste ambiente e não é usado como prova. Um GitHub Check Run agregado também não substitui o job `verify`. Erros de API, paginação incompleta, PR, SHA curto/divergente, job omitido/pulado e falha/rerun/pending mais recente são recusados. Run/workflow/job são relidos antes de devolver a prova; não se procura um verde antigo quando a evidência mais recente falha.

A API implantada não informa um config-ref histórico no objeto v3 do run. Por isso o gate vincula os bytes efetivamente executados de `GET /api/v2/pipeline/{id}/config` ao blob GitHub de `.circleci/config.yml` no SHA exato de main, além do fingerprint revisado do contrato `verify`. Campos de config-ref/config-revision divergentes, quando fornecidos pela API, são recusados. Não se inventa um config-ref ausente. Uma mudança intencional no contrato de CI exige revisar `CI_POLICY.configSha256` com os testes/comandos correspondentes; configuração de setup dinâmica não é aceita por este consumidor.

Os comandos próprios de Git não usam pager e não solicitam credenciais interativamente. Não há trigger CircleCI, cancelamento, aprovação, novo segredo ou publicação no modo de conferência. A opção de cancelamento redundante continua sendo configuração do projeto; a elegibilidade exige o resultado real mais recente, inclusive quando há workflows aguardando na fila.
