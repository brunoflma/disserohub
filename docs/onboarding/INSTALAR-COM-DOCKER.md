# Instalar o DisseroHub com Docker

Instale o **DisseroHub**, ambiente visual de trabalho do Dissero, na minha máquina, fora do projeto em que estou trabalhando. Use Docker e conecte os agentes que eu já utilizo: Claude Code, Codex ou ambos.

Execute este prompt somente quando eu solicitar a instalação com Docker. Se o pedido for revisar, preparar ou documentar o fluxo, não execute os comandos abaixo.

- **Repositório exclusivo:** https://github.com/brunoflma/disserohub
- **Versão:** release estável publicada nesse repositório; registre a tag e o commit selecionados.
- **Pasta nova sugerida:** `~/disserohub`; no Windows deste fluxo, dentro da distribuição WSL2 escolhida.
- **Endereço pretendido:** `https://dissero.localhost`, acessível pelo navegador do usuário.
- **Escopo:** ambiente visual e integrações locais; não instale nem configure o plugin jurídico hospedado, contas do Dissero ou recursos Cloudflare.

O contêiner oferece o escritório, o histórico de sessões e os recursos de permissões e mensagens aplicáveis. O terminal interativo `pty` não funciona dentro do Docker. Se eu precisar dele, explique essa diferença e peça a escolha do método nativo antes de mudar de fluxo.

## 1 Conferir a máquina e escolher o ambiente

Este caminho é opcional e exige escolha explícita por Docker. Para instalação comum, use o prompt nativo via Node.js/npm. Os limites Docker abaixo só se aplicam a este caminho; não reprove o npm por falta de Docker ou pelos recursos exigidos aqui.

Antes de instalar dependências, clonar ou subir contêiner, aplique o perfil `docker` da [política de capacidade](REQUISITOS.md) no sistema anfitrião. Prefira 32 GB de RAM para Docker Desktop. O perfil básico condicionado exige 16 GB totais, 6 GiB disponíveis, 4 CPUs lógicas e 25 GiB livres nos destinos, além de orçamento Docker efetivo de 4 GiB de RAM, 2 CPUs lógicas e 10 GiB livres no armazenamento real do daemon/VM. São limites provisórios do produto. Em 8 GB, informe `not_recommended` para Docker e apresente a possibilidade de avaliar o perfil nativo via npm, sem executar uma troca de método silenciosa. Não use Docker para compensar falta de memória.

Se Node e o diagnóstico do pacote já estiverem disponíveis, use `check-capacity.mjs --method docker` com os destinos reais. Caso contrário, obtenha as medições por consultas nativas somente de leitura, sem instalar Node para diagnosticar. O coletor sozinho deixa o orçamento Docker pendente: confirme que o contexto é local antes de consultar o daemon; meça RAM/CPU efetivas e armazenamento Docker sem presumir valores padrão. Não some RAM do host e da VM. No Windows, meça o host Windows separadamente do WSL; Engine nativo Linux não herda requisitos de VM do Desktop. Confira também limites do contêiner/cgroups. Falta de acesso ou medição exige `needs_review`; recurso ocupado exige `defer`. Não inicie ou reinicie Docker, altere alocações, feche programas ou limpe arquivos para completar o diagnóstico. Repita a medição antes da execução se estiver defasada. Capacidade favorável não substitui compatibilidade de sistema e dependências.

Detecte sistema, arquitetura, Git, Node.js, Docker, Compose v2, agentes utilizáveis e os diretórios reais de suas contas. A existência de uma pasta sozinha não prova que um agente está funcionando.

- **macOS:** use o host do usuário, identifique Intel ou Apple Silicon e verifique Docker Desktop e seu daemon.
- **Linux:** identifique a distribuição, Docker Engine ou Desktop e Compose v2. Siga a fonte oficial da distribuição escolhida. Não acrescente silenciosamente o usuário ao grupo `docker`, pois esse acesso permite controlar o host; explique e obtenha autorização antes.
- **Windows:** use Docker Desktop com WSL2 e integração com uma distribuição escolhida. Rode clone, Node e Compose nesse ambiente coordenador, sem duplicar a instalação no Windows. Verifique o backend, a distribuição e os executáveis dos agentes. Se faltar WSL2, Docker Desktop ou um reinício, apresente a ação necessária e preserve o ponto de retomada. Não encerre o WSL inteiro enquanto houver outros trabalhos ativos.

No Windows, localize as contas nativas em `%USERPROFILE%\.claude*` e `%USERPROFILE%\.codex*` quando forem as utilizadas, respeitando `CLAUDE_CONFIG_DIR` e `CODEX_HOME`. Traduza os caminhos para o ambiente coordenador, mas instale hooks com comandos e executáveis válidos no ambiente em que o agente realmente roda. Se essa combinação não puder ser validada, registre o bloqueio; não copie credenciais para o WSL ou para o contêiner e não instale um segundo agente para mascarar o problema.

Procure um DisseroHub existente por serviços, diretórios e portas. Confirme `/api/health`, `/api/updates` com `repo=brunoflma/disserohub` e a origem do checkout quando acessível. Reutilize uma instalação compatível; uma resposta HTTP 200 genérica não basta.

Uma avaliação de capacidade desfavorável não autoriza desligar ou reconfigurar uma instalação existente. Informe a condição e preserve o ambiente.

Confira também o projeto Compose, o contêiner `habblaud`, o volume de dados e os aliases existentes. Essa release conserva nomes Docker do Habblaud. Se pertencerem a outra instalação, pare e apresente a migração; mudar apenas o nome da pasta não isola o contêiner nem o volume. Não execute `down -v`, remoção, limpeza ou substituição de dados para abrir espaço.

Escolha uma porta HTTP local livre, preferindo 4747. Preserve qualquer serviço que a ocupe e use a mesma porta escolhida no Compose, nos hooks, no auxiliar e no proxy. Não inicie uma instância nativa concorrente usando os mesmos dados.

## 2 Instalar somente as dependências necessárias

Confirme `engines.node` no `package.json` da release selecionada antes de instalar dependências. A referência v0.11.2 exige Node.js 22.12+ no host para seus scripts. Uma instalação nova com `portless@0.15.8` para HTTPS exige Node.js 24+; selecione um Node que atenda aos dois, sem reduzir o mínimo de uma release futura. Não substitua runtimes de outros projetos sem explicar o impacto. Confira `docker info` e `docker compose version`.

Instale somente dependências ausentes e a partir de fontes oficiais. No Windows, configure a integração do Docker Desktop com a distribuição selecionada; no macOS, verifique a inicialização do Docker Desktop no login; no Linux, confirme o serviço e o acesso ao daemon. Respeite senhas, termos e permissões que dependam de mim, em vez de aceitá-los ou contornar proteções.

Se eu usar Claude Code, confira o mínimo da release selecionada; a referência v0.11.2 exige 2.1.287+. Não instale um agente que eu não utilizo. Se nenhum agente utilizável existir, interrompa e informe essa dependência.

## 3 Selecionar a release e baixar

Consulte `https://api.github.com/repos/brunoflma/disserohub/releases/latest` ou o GitHub CLI já disponível. Exija uma release sem `draft` e sem `prerelease`, tag estável `vX.Y.Z` e página pertencente ao DisseroHub. Código público não exige criar uma conta ou token GitHub. Se a consulta falhar, peça uma tag estável publicada que eu possa confirmar; não use a `main` como alternativa.

Clone `https://github.com/brunoflma/disserohub.git` em uma pasta nova, busque a tag escolhida nessa origem e selecione-a em modo detached. Confira a origem, registre o SHA completo e compare `package.json` com a tag. Leia o README da release. Se a pasta já existir ou tiver alterações, preserve-a e não execute reset, stash automático ou sobrescrita.

Execute `npm ci` na pasta selecionada. Os scripts do host precisam das dependências de desenvolvimento. Não instale um pacote npm chamado DisseroHub presumindo que ele substitui este checkout. Não use o upstream do Habblaud como fonte de instalação ou atualização.

## 4 Subir o contêiner com exposição local

Passe `HABBLAUD_PORT` com a porta escolhida, `HABBLAUD_BIND=127.0.0.1` e `HABBLAUD_LANG=pt-BR` no ambiente de execução e na configuração persistente do Compose. Se a descoberta não bastar, configure `HABBLAUD_CLAUDE_DIRS` e `HABBLAUD_CODEX_DIRS` com os caminhos reais do host coordenador.

Execute:

```text
npm run docker:up
```

Use o script da release, que gera as montagens limitadas de conversas e uso. Não monte a pasta inteira de um agente, credenciais, bancos de autenticação ou o socket do Docker no contêiner. Preserve o volume de dados e o `docker-compose.override.yml` existente quando pertencerem a esta instalação. Não exponha a porta principal em `0.0.0.0` no host e não ative acesso pelo celular, LAN ou túnel público.

Verifique o estado do contêiner e os logs com `npm run docker:logs`. A política de reinício do contêiner depende de o daemon voltar; confira também a inicialização do Docker no sistema. Não confunda essas duas condições.

## 5 Conectar os agentes no ambiente correto

Use os mesmos diretórios e a mesma porta no servidor, nos instaladores e nos hooks. Faça primeiro a conferência com os comandos `--dry-run` disponíveis e preserve os backups.

- **Claude Code:** execute `npm run mod:install` sem `--sem-permissoes` ou `--sem-mensagens`, usando `HABBLAUD_PORT` no ambiente. Confira `npm run mod:status`. Os nomes `habblaud`, `habblaud-permissoes` e `habblaud-mensagens` são as integrações locais compatíveis, não o plugin jurídico hospedado.
- **Codex:** execute `npm run codex:install -- --port <PORTA_ESCOLHIDA>` e confira `npm run codex:status -- --port <PORTA_ESCOLHIDA>`, substituindo o marcador. Preserve os hooks de outros aplicativos. Não edite `config.toml`, hashes de confiança ou aprovações; a aprovação em `/hooks` é minha. Se a interface não estiver disponível na versão usada, registre a pendência.

Se eu usar Codex, mantenha `npm run codex:bridge -- --port <PORTA_ESCOLHIDA>` rodando no host que realmente consegue executar o Codex e acessar suas contas, fora do contêiner. Configure o executável validado em `HABBLAUD_CODEX_BIN` ou no PATH do auxiliar. No Windows com agentes nativos, valide explicitamente a chamada entre WSL e Windows e os comandos dos hooks; não suponha que um caminho traduzido resolve ambos.

Dê persistência ao auxiliar com LaunchAgent no macOS, systemd de usuário no Linux ou serviço de usuário no WSL2 quando esse for o host efetivo do auxiliar. Se o host efetivo for Windows, use uma tarefa do usuário, sem janela visível. Evite instâncias duplicadas e registre o comando, ambiente, diretório e logs reais. Não aprove hooks nem envie mensagens de trabalho para testar a integração.

Deixe `HABBLAUD_PTY` desligado por padrão. Se eu solicitar criação de agentes pelo escritório, trate a ativação separadamente e valide o auxiliar do host. Mesmo nesse caso, o terminal interativo continua indisponível dentro do contêiner.

## 6 Preparar o endereço HTTPS local

Reutilize um HTTPS local existente somente se estiver saudável e apontar para esta instalação. Para uma instalação nova com o proxy, confira Node.js 24+ e instale `portless@0.15.8` somente se necessário:

```text
npm install -g portless@0.15.8
portless alias dissero <PORTA_ESCOLHIDA>
portless proxy start
portless trust
```

Substitua o marcador pela porta publicada no host. Confira a rota antes de criar o alias; não use `--force` para substituir outro destino e preserve os proxies existentes. No Windows, comprove o acesso pelo navegador do Windows e a confiança no certificado nesse sistema, além de qualquer verificação dentro do WSL.

A persistência do proxy é separada da do Docker e da do auxiliar. `portless service install` cria um serviço privilegiado: root no macOS/Linux e SYSTEM no Windows. Explique esse alcance e obtenha autorização específica antes de usá-lo. Sem ela, deixe essa persistência pendente ou apresente uma alternativa a validar. No WSL, confirme também como a distribuição volta no login, sem modificar serviços de outras distribuições.

Deixe para mim qualquer senha, aprovação administrativa ou confiança no certificado que exija interação. Não contorne avisos do navegador nem desative TLS. Se a porta HTTPS já estiver ocupada, não encerre o ocupante; apresente o reaproveitamento possível ou o endereço alternativo como pendência.

## 7 Verificar o resultado real

1. Confira `http://127.0.0.1:<PORTA_ESCOLHIDA>/api/health`: versão selecionada, `docker=true`, histórico de sessões e recursos aplicáveis. `pty=false` é a limitação esperada deste modo.
2. Confira `/api/updates`: a origem deve ser `brunoflma/disserohub`. **Verificar agora** consulta releases e não instala código.
3. Confira `mod:status` e `codex:status` apenas para os agentes utilizados. Para Codex, confira também a conexão real do auxiliar; descobrir contas ou criar hooks não prova entrega de mensagens.
4. Abra `https://dissero.localhost` no navegador do usuário. Não use apenas `?mock=1` ou a saúde do contêiner como prova de funcionamento.
5. Após uma interação neutra minha no agente e as aprovações necessárias, confira o aparecimento da atividade real. Não use documentos ou mensagens de trabalho como teste.
6. Reinicie somente o novo contêiner e, se aplicável, o novo auxiliar. Confira uma única instância e manutenção das configurações e do volume. Não reinicie o Docker Desktop, o computador ou o WSL inteiro enquanto isso puder interromper outros trabalhos sem autorização.

## Resposta ao concluir

Seja curto: informe **Pronto** ou **Parcial**, endereço, sistema e ambiente coordenador, método Docker, release, agentes e auxiliar verificados e os testes que passaram. Em **Sua vez**, liste somente ações humanas pendentes; inclua confiança em hooks do Codex quando aplicável e `/reload-plugins` para sessões do Claude Code já abertas. Informe comandos e caminhos reais para status, logs, reinício e retomada.

Não declare pronto se HTTPS, persistência ou integrações solicitadas ainda dependerem de mim. Preserve volume, fonte e configuração. Atualizações futuras devem usar releases aprovadas do DisseroHub e um candidato separado.
