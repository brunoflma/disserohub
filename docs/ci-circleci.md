# Verificação CircleCI

A configuração em .circleci/config.yml usa Node.js 22.12 e executa a verificação em eventos de pull request e em pushes para main. Outros eventos de push não iniciam o workflow.

| Ordem | Comando |
| --- | --- |
| 1 | npm ci |
| 2 | npm run typecheck |
| 3 | node docs/onboarding/check-capacity-cases.mjs |
| 4 | npm test |
| 5 | npm run build |

Após o checkout, o job remove helpers e cabeçalhos Git de credenciais visíveis, o arquivo ~/.git-credentials e identidades carregadas no agente SSH; também remove variáveis de autenticação GitHub das etapas seguintes. Essa limpeza é best-effort: não comprova nem controla credenciais mantidas fora do ambiente do job pelo provedor.

O GitHub Actions também cancela verificações anteriores da mesma referência. O CircleCI não configura esse comportamento neste arquivo; a opção de cancelamento redundante é de projeto e não cancela workflows na branch padrão, então execuções de main podem aguardar na fila.
