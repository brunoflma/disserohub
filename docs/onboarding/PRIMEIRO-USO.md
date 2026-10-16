# Contrato do primeiro uso do DisseroHub

Este contrato prepara a integração futura do ambiente visual com o plugin atualmente chamado `amf-juridico`, previsto para ser renomeado para Dissero. **A integração está desativada.** Este pacote não deve ser carregado como uma ação automática de instalação enquanto essa ativação não for solicitada e implementada.

## Limite da integração

O plugin jurídico continua no seu canal de distribuição. O DisseroHub é um serviço local com repositório e ciclo de versões próprios. A etapa futura não deve renomear o plugin, mudar o Cloudflare, criar login, conceder permissões remotas ou copiar segredos entre produtos.

O plugin poderá futuramente fornecer o prompt adequado a um agente com acesso autorizado à máquina. O fornecimento do texto não prova capacidade de executar comandos locais. Sem essa capacidade, o fluxo deve entregar instruções e informar a limitação, sem simular uma instalação.

## Sequência prevista

1. **Diagnóstico:** identificar sistema, arquitetura, agentes, instalação existente, portas e dependências por consultas locais permitidas. Medir capacidade conforme [REQUISITOS.md](REQUISITOS.md) antes de qualquer instalação de dependências. Registrar a versão da política, as medições, suas fontes e as pendências. Não ler conteúdo de documentos e não coletar credenciais.
2. **Reutilização:** se um DisseroHub compatível responder e sua origem for confirmada, validar e abrir o endereço existente. Não instalar outra instância.
3. **Escolha:** avaliar primeiro o método nativo via Node.js/npm, padrão de primeira instalação. Com capacidade `eligible` e compatibilidade conferida, apresentá-lo com o perfil `basic` ou `recommended` e seus avisos. Avaliar Docker somente quando escolhido explicitamente, com seus próprios recursos e limite de terminal interativo. Não executar ambos nem trocar para Docker automaticamente. Nos demais resultados de capacidade, informar o motivo e não iniciar uma instalação nova; não desligar uma instalação existente por essa avaliação.
4. **Autorização da instalação:** apresentar método, diretório, dependências ausentes, serviço do usuário e acesso local. Somente um pedido de instalação autoriza iniciar as alterações. Permissões administrativas, termos, confiança de certificados e de hooks permanecem sujeitos à ação necessária do usuário.
5. **Release:** selecionar uma release estável publicada no DisseroHub, registrar a tag e resolver o commit. Não converter o checkout da `main` em uma release aprovada por presunção.
6. **Execução futura:** usar apenas um dos dois prompts, com os valores diagnosticados. Fazer backup antes de mudanças e manter um registro mínimo de retomada fora do repositório.
7. **Verificação:** conferir saúde, origem de atualização, serviço, HTTPS e integrações efetivas. Distinguir configuração escrita, aprovação humana e atividade real.
8. **Conclusão:** abrir o escritório somente após validar o endereço; informar as pendências e os comandos locais de manutenção. Uma nova chamada deve reutilizar o estado já aplicado.

## Estados previstos

| Estado | Significado | Próxima ação permitida |
| --- | --- | --- |
| `not_configured` | Ainda não houve diagnóstico | Oferecer o diagnóstico local |
| `detected` | Sistema, dependências e possível instalação identificados | Reutilizar se saudável ou apresentar a instalação |
| `capacity_pending` | Capacidade com resultado `defer` ou `needs_review` | Completar medições ou repetir após ação do usuário; não instalar |
| `capacity_not_recommended` | RAM/CPU ou plataforma fora do perfil assistido | Explicar a política provisória; não iniciar instalação padrão |
| `awaiting_install_consent` | Alterações foram apresentadas, mas a instalação não foi solicitada | Aguardar decisão; não instalar |
| `installing` | Instalação explicitamente solicitada e em execução | Continuar apenas as etapas autorizadas |
| `awaiting_user` | Falta senha, reinício, termos, certificado ou confiança em hooks | Mostrar a ação exata e preservar o progresso |
| `ready` | Endereço, persistência e integrações solicitadas foram verificados | Abrir e reutilizar |
| `blocked` | Uma incompatibilidade, conflito ou falta de acesso impede continuar | Explicar o bloqueio e preservar a instalação |

Os estados descrevem comportamento futuro. Nenhum arquivo de estado, hook, comando do plugin, job ou serviço deve ser criado por apenas incluir este pacote na documentação.

O diagnóstico de capacidade tem resultados próprios, separados desses estados de integração. Somente `eligible` permite avançar para a apresentação de uma instalação nova; ainda exige pedido de instalação e demais verificações. Uma máquina de 8 GB pode atender ao perfil `basic` nativo se tiver os demais recursos, com aviso para validar compilação e responsividade; isso não equivale a desempenho homologado ou a ativação de um modo reduzido. Não aplicar os requisitos Docker ao npm. Reavaliar a memória disponível e o disco antes da compilação se a medição estiver defasada. A ferramenta de capacidade continua independente, sem consumidor automático no plugin.

## Dados mínimos para execução e retomada

| Campo | Conteúdo previsto |
| --- | --- |
| `schemaVersion` | Versão do formato do registro |
| `status` | Um dos estados acima |
| `method` | `native` ou `docker` |
| `os` e `architecture` | Sistema e arquitetura diagnosticados |
| `coordinatorEnvironment` | Windows nativo, macOS, Linux ou distribuição WSL escolhida |
| `capacity` | ID da política, horário, medições de capacidade com fontes, resultado e pendências; sem inventário de identidades |
| `providers` | Identificadores `claude` e/ou `codex`, sem e-mails ou tokens |
| `repository` | Sempre `brunoflma/disserohub` |
| `releaseTag` e `releaseCommit` | Tag publicada e SHA completo resolvido |
| `installDir`, `dataLocation`, `httpPort` e `localUrl` | Valores efetivos locais, nunca exemplos com marcadores |
| `serviceReferences` | Identificação dos novos serviços, proxy e auxiliar aplicáveis |
| `checks` | Resultado de cada verificação, sem conteúdo de sessões |
| `pendingUserActions` | Ações que ainda dependem do usuário |
| `backupReferences` e `completedSteps` | Referências locais e etapas já aplicadas para evitar repetição |

O registro será privado e local, por exemplo em `~/.habblaud/setup/disserohub-first-use.json`. Não deve ser criado nesta preparação nem enviado para GitHub ou para o plugin hospedado por padrão. Caminhos, dados de uso, transcripts, identidades e credenciais não pertencem ao manifesto público.

## Condições para concluir

- `/api/health` confirma a versão selecionada e o modo certo; `terminal`, `permissions`, `messages`, `codexEvents` e `pty` são avaliados conforme os agentes e recursos solicitados.
- `/api/updates` aponta para o DisseroHub. A ausência de uma consulta de versão por falha temporária de rede deve ser informada; não substitui a prova da origem da instalação.
- O serviço do aplicativo ou contêiner foi testado, com uma única instância e persistência configurada. O proxy HTTPS e o auxiliar Docker são verificados separadamente.
- O navegador real abre o endereço local com certificado válido. Nenhuma confiança foi forjada e nenhum aviso de segurança foi contornado.
- As integrações solicitadas foram verificadas. Aprovação de hooks pendente impede a conclusão dessas integrações; uma demonstração simulada não equivale a atividade real.
- Nenhum dado, hook de outro aplicativo, contêiner, volume, proxy ou serviço existente foi sobrescrito ou removido para concluir a instalação.
- A capacidade foi avaliada pela política registrada, com host e Docker distinguidos; nenhum dado desconhecido foi convertido em aprovação. O resultado de hardware não foi usado como prova de compatibilidade ou de desempenho homologado.

## Trabalho posterior à preparação

Antes da ativação, homologar a primeira instalação e a retomada em Windows nativo, macOS, Linux e nos três cenários Docker. Validar especialmente a fronteira Windows/WSL dos executáveis e hooks, os serviços de inicialização, permissões do proxy e certificados. Confirmar o comportamento com apenas Claude Code, apenas Codex e ambos.

Homologar também a coleta e o perfil de capacidade em máquinas reais de 8/16/32 GB com aplicativos de trabalho abertos. Rever os limites provisórios com medições de pressão de memória/swap, compilação, disco e responsividade; testes de decisão com dados sintéticos não substituem essa evidência.

Depois dessa homologação, implementar o consumidor do manifesto no plugin mediante solicitação específica. Publicar o pacote de prompts no canal que o consumidor utilizará e revisar seu versionamento. Não basta alterar `integrationEnabled` para `true`: hoje nenhum carregador consulta esse campo.

## Base técnica conferida

- [Release v0.11.2](https://github.com/brunoflma/disserohub/releases/tag/v0.11.2), conferida em 15/10/2026.
- Contratos locais: `package.json`, `docker-compose.yml`, `scripts/docker-up.ts`, `scripts/mod-install.ts`, `scripts/codex-install.ts`, `scripts/codex-bridge.ts`, `server/config.ts`, `server/index.ts`, `server/http/tls.ts` e `server/http/app.ts`.
- [Portless no commit da versão 0.15.8](https://github.com/vercel-labs/portless/blob/27598545f08f8055cb3b9fb410f8d250f054f46d/README.md): proxy, aliases, confiança de certificados e serviços. Metadados de `portless@0.15.8`: Node.js `>=24`. Os requisitos do proxy não alteram o mínimo do aplicativo.
