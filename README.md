# DisseroHub

Ambiente visual de trabalho do **Dissero**, baseado no [Habblaud](https://github.com/marmottajr/habblaud) e adaptado para o escritório jurídico. Mostra a atividade de agentes locais em um escritório virtual, com painéis, projetos e áreas comuns.

Este repositório público contém o motor local, as customizações e as melhorias da interface. O plugin do Dissero hospedado no Cloudflare tem implementação e distribuição independentes. Credenciais, documentos, sessões, nomes de pessoas, certificados e dados de uso de uma instalação não pertencem a este repositório.

## Instalação

Requer Node.js 22.12 ou superior. Selecione uma versão na página de [releases do DisseroHub](https://github.com/brunoflma/disserohub/releases).

Para uma instalação conduzida por um agente, estão preparados os prompts [sem Docker](docs/onboarding/INSTALAR-SEM-DOCKER.md) e [com Docker](docs/onboarding/INSTALAR-COM-DOCKER.md), com escolha de sistema, preservação de instalações existentes e verificações de serviço, HTTPS e integrações. O [pacote de primeiro uso](docs/onboarding/README.md) mantém a integração com o plugin desativada e a homologação de instalações limpas pendente.

```powershell
git clone https://github.com/brunoflma/disserohub.git
cd disserohub
git checkout --detach v1.0.3
npm ci
npm run build
npm start
```

O servidor local escuta em `127.0.0.1:4747` por padrão. A configuração de HTTPS e do nome `dissero.localhost` é opcional e depende da instalação. Claude Code, Codex e seus acessos são configurados separadamente; consulte [a documentação do servidor](server/README.md) e os comandos de instalação em `package.json`.

Os identificadores internos `habblaud`, as variáveis `HABBLAUD_*` e o diretório de dados `~/.habblaud` são mantidos por compatibilidade com instalações existentes.

## Ritmo de uso

O ícone de gráfico com relógio, ao lado de **Meu dia**, abre o acompanhamento por dia, semana e mês. **Seu tempo ativo** e **Agentes em atividade** são medidos separadamente; agentes simultâneos contam uma única vez no segundo indicador.

No Windows, o tempo pessoal considera Dissero, Codex, ChatGPT e Claude Desktop em foco e com interação nos últimos dois minutos. Outros sites e terminais não são incluídos automaticamente. Nos demais sistemas, a observação pessoal se limita ao Dissero em foco. Não são capturados textos, teclas, títulos de janela ou URLs. As amostras registram somente intervalos de tempo e ficam neste computador, disponíveis apenas pela conexão local.

Os lembretes usam somente o tempo pessoal. É possível configurar o intervalo de uso contínuo, a duração das pausas e o limite diário, adiar um aviso ou desativar os lembretes e o acompanhamento pessoal. Uma pausa com duração definida encerra automaticamente. Os padrões de 50 minutos, pausa de cinco minutos e limite diário de quatro horas são preferências iniciais ajustáveis.

O histórico começa quando o recurso é ativado, conserva até 93 dias e indica períodos sem observação como **sem dados**. Tempo com o servidor desligado não é reconstruído a partir das conversas. O painel distingue falta de cobertura pessoal de atividade real dos agentes e informa quando não consegue salvar os dados recentes.

## Atualizações

Em **Configurações → Sobre**, **Verificar agora** consulta versões e **Atualizar para v…** instala a versão estável mais recente. O instalador está disponível no serviço nativo Windows preparado com o launcher de atualização. A ação exige abrir a página no próprio computador e encerrar os terminais criados pelo Dissero. As consultas e instalações usam exclusivamente `brunoflma/disserohub`.

Se a cota anônima do GitHub se esgotar e o GitHub CLI já estiver instalado e autenticado localmente, o servidor usa essa sessão existente somente para consultar as releases públicas deste repositório. Nenhum token é incluído no aplicativo ou nas requisições anônimas. O CLI é opcional; sem ele, a verificação aguarda a cota normal voltar.

O instalador baixa a tag oficial em uma pasta separada, instala suas dependências, verifica os tipos e compila antes de trocar o serviço. O progresso aparece no painel; a página recarrega quando a versão, o instalador e os arquivos do cliente forem confirmados. Se a inicialização falhar, o serviço retorna à instalação anterior. Os dados e a configuração dos agentes permanecem no diretório existente. Sessões externas do Claude e Codex continuam abertas.

Execuções de desenvolvimento, Docker e instalações sem o launcher mantêm atualização administrada: preserve as alterações locais e os dados, prepare a tag aprovada em uma pasta separada com `npm ci` e `npm run build` e só então troque o serviço. Preserve a instalação anterior até validar a nova versão.

Não instale o pacote oficial do Habblaud sobre uma instalação do Dissero. O código público permite contribuições, mas a distribuição do Dissero utiliza apenas releases deste fork.

## Desenvolvimento e publicação

A base inicial é o Habblaud **v0.11.0**, sob licença MIT. As alterações estão descritas em [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md). O histórico anterior e seus créditos são preservados.

Configure a origem técnica separadamente:

```powershell
git remote add upstream https://github.com/marmottajr/habblaud.git
git fetch upstream --tags
```

Novidades do Habblaud devem ser revisadas, mantendo as customizações. A numeração do DisseroHub acompanha a release oficial revisada: Habblaud 1.0.3 → DisseroHub 1.0.3. A referência de numeração é registrada separadamente da base técnica efetivamente incorporada, que só muda após uma integração do motor. Consulte a [política de versões](docs/UPSTREAM-VERSIONING.md).

```powershell
npm run typecheck
npm test
npm run build
```

A CI executa essas verificações no Linux. Alguns testes originais dependem de permissões e caminhos Unix; execute a suíte completa no Linux ou WSL ao trabalhar no Windows.

Após revisar a release oficial, alinhe `package.json.version`, `disserohub.upstreamReferenceVersion` e `UPSTREAM_REFERENCE_VERSION` em `shared/distribution.ts`. Execute `node scripts/version-sync.mjs` para sincronizar os manifests das integrações locais herdadas do Habblaud. Escreva as notas no `CHANGELOG.md` e publique a partir da `main` limpa e sincronizada:

```powershell
npm run release -- --dry-run
npm run release
```

O publicador exige números alinhados à referência revisada, base técnica coerente, `origin` e `package.json` apontando para este fork e CI bem-sucedida no commit exato. Todas as chamadas de publicação ao GitHub selecionam explicitamente o DisseroHub, inclusive quando o GitHub CLI usa o upstream como padrão de um fork.

## Licença

[MIT](LICENSE). Os avisos de licença e os créditos do Habblaud original são preservados.
