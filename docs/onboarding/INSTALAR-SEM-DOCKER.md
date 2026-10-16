# Instalar o DisseroHub sem Docker

Instale o **DisseroHub**, ambiente visual de trabalho do Dissero, na minha máquina, fora do projeto em que estou trabalhando. Use Node.js nativo e conecte os agentes que eu já utilizo: Claude Code, Codex ou ambos.

Execute este prompt somente quando eu solicitar a instalação. Se o pedido for revisar, preparar ou documentar o fluxo, não execute os comandos abaixo.

- **Repositório exclusivo:** https://github.com/brunoflma/disserohub
- **Versão:** release estável publicada nesse repositório; registre a tag e o commit selecionados.
- **Pasta nova sugerida:** `~/disserohub` no macOS/Linux ou `%USERPROFILE%\disserohub` no Windows.
- **Endereço pretendido:** `https://dissero.localhost`, restrito a esta máquina.
- **Dados compatíveis:** `~/.habblaud`, preservando qualquer conteúdo existente.
- **Escopo:** ambiente visual e integrações locais; não instale nem configure o plugin jurídico hospedado, contas do Dissero ou recursos Cloudflare.

## 1 Conferir a máquina antes de alterar

Detecte sistema, arquitetura, shell, Git, Node.js, gerenciador de pacotes e agentes instalados. Verifique os executáveis e os diretórios reais; a existência de uma pasta sozinha não prova que um agente está utilizável.

Este é o método padrão, nativo via Node.js/npm. Antes de instalar dependências, clonar ou compilar, aplique somente o perfil `native` da [política de capacidade](REQUISITOS.md). O perfil básico provisório é 8 GB de RAM total, 2 GiB disponíveis, 2 CPUs lógicas e 10 GiB livres nos destinos; o recomendado é 16 GB totais, 4 GiB disponíveis, 4 CPUs lógicas e 10 GiB livres. Não bloqueie apenas porque a máquina tem 8 GB e não exija Docker, WSL ou 32 GB. Apresente os avisos do perfil `basic` e valide compilação e responsividade antes de declarar pronto.

Se Node e o diagnóstico do pacote já estiverem disponíveis, use `check-capacity.mjs --method native` com os destinos reais; caso contrário, obtenha as mesmas medições por consultas nativas somente de leitura, sem instalar Node para diagnosticar. Não execute código obtido de uma origem não verificada. `defer` ou `needs_review` exige resolver a pendência antes de continuar. Não feche programas, limpe disco, altere swap ou preferências de desempenho automaticamente. Repita a medição imediatamente antes de instalar/compilar se o diagnóstico já estiver defasado. Se a compilação falhar por recursos, preserve o progresso e informe a pendência; não troque para Docker automaticamente. Capacidade favorável não substitui compatibilidade de sistema e dependências.

- **Windows:** use PowerShell e caminhos nativos, inclusive para os agentes que rodam no Windows. Não instale WSL ou Docker para este caminho. Se o Codex do aplicativo não estiver no PATH, localize o executável da instalação existente e valide-o, sem instalar outra cópia automaticamente. Use `npm.cmd` quando necessário, sem relaxar a política global do PowerShell.
- **macOS:** identifique Intel ou Apple Silicon e o Node que o serviço conseguirá executar no login.
- **Linux:** identifique a distribuição e confirme o gerenciador de serviços. Se não houver systemd de usuário, apresente a adaptação necessária antes de criar persistência; não declare suporte testado a um supervisor desconhecido.

Procure um DisseroHub existente pelas portas locais, pelos serviços e pelos caminhos encontrados. Confirme `/api/health`, `/api/updates` com `repo` igual a `brunoflma/disserohub` e, quando acessível, a origem do checkout. Uma resposta HTTP 200 genérica não identifica o produto. Reutilize uma instalação compatível e saudável; não crie outra.

Uma avaliação de capacidade desfavorável não autoriza desligar, remover ou reconfigurar uma instalação existente. Informe a condição e preserve o ambiente.

Se a pasta pretendida contiver arquivos, o repositório tiver alterações, houver dados antigos sem instalação identificada ou existir um Habblaud diferente, pare antes de substituir qualquer coisa e apresente a migração necessária. Não execute reset, stash automático, limpeza, remoção de dados ou troca silenciosa de método.

Escolha uma porta HTTP local livre, preferindo 4747. Se estiver ocupada por outro serviço, preserve-o e escolha outra porta livre. Registre a porta escolhida e use-a consistentemente no servidor, nos instaladores, nos hooks e no proxy.

## 2 Instalar somente as dependências necessárias

Confirme `engines.node` no `package.json` da release selecionada antes de instalar dependências. A referência v0.11.2 exige Node.js 22.12+. Uma instalação nova com `portless@0.15.8` para HTTPS exige Node.js 24+; escolha uma versão que atenda aos dois, sem reduzir o mínimo de uma release futura. Não substitua runtimes usados por outros projetos sem explicar o impacto. Instale dependências ausentes a partir das fontes oficiais e registre o que mudou.

Se eu usar Claude Code, confira o mínimo exigido pela release selecionada; a referência v0.11.2 exige 2.1.287+. Se a versão existente for incompatível, apresente a atualização necessária. Não instale um agente que eu não utilizo. Se nenhum agente utilizável for encontrado, interrompa e informe essa dependência.

Respeite permissões do sistema e pausas que dependam de mim, como senha administrativa, aceitação de termos, reinício e confiança em certificados. Preserve o progresso para retomar depois. Não desative proteções para continuar.

## 3 Selecionar a release e compilar

Consulte `https://api.github.com/repos/brunoflma/disserohub/releases/latest` ou o GitHub CLI já disponível. Exija uma release sem `draft` e sem `prerelease`, com tag estável `vX.Y.Z` e página pertencente ao DisseroHub. Não exija login no GitHub para baixar código público. Se a consulta falhar, peça uma tag estável publicada que eu possa confirmar; não use a `main` como alternativa.

Na pasta nova, clone `https://github.com/brunoflma/disserohub.git`, busque a tag escolhida nessa origem e selecione-a em modo detached. Confirme a origem, registre o SHA completo do commit e compare a versão de `package.json` com a tag. Leia o README dessa release. Não use o upstream do Habblaud como fonte de instalação ou atualização.

Execute na pasta selecionada, adaptando ao shell:

```text
npm ci
npm run build
```

Os scripts de desenvolvimento são necessários para compilar; não use uma instalação que os omita. Se uma dependência nativa como `node-pty` estiver bloqueada ou não carregar, diagnostique a política e a plataforma; não habilite globalmente scripts de pacotes nem apresente o terminal interativo como disponível sem teste.

## 4 Preparar o servidor e a persistência

Configure o ambiente do processo e do serviço com `HABBLAUD_HOST=127.0.0.1`, `HABBLAUD_PORT` com a porta escolhida e `HABBLAUD_LANG=pt-BR`. Mantenha o diretório de dados compatível ou um caminho já validado da instalação existente. Defina os diretórios reais de Claude Code e Codex por `HABBLAUD_CLAUDE_DIRS` e `HABBLAUD_CODEX_DIRS` quando a descoberta não bastar.

O serviço deve receber essas variáveis explicitamente. Não presuma que `npm start` carrega um arquivo `.env` por conta própria. Se eu usar Codex, inclua seu executável no PATH do serviço ou configure `HABBLAUD_CODEX_BIN` com um caminho validado.

Crie um único serviço do usuário, com diretório de trabalho explícito, caminho absoluto do Node, logs locais e recuperação após falha:

- **Windows:** tarefa de login no Agendador de Tarefas e, se necessário, um pequeno supervisor local, executado sem janela visível e sem privilégios SYSTEM. Garanta encerramento do filho e bloqueio de duplicação; não use apenas um processo solto iniciado no terminal.
- **macOS:** LaunchAgent do usuário, com reinício após falha.
- **Linux:** serviço systemd de usuário. Habilite permanência após logout somente se necessária e autorizada; registre a configuração adotada.

Use um nome próprio do DisseroHub e não substitua um serviço de outro aplicativo. Crie novos auxiliares locais a partir deste plano; não dependa de arquivos privados da máquina de desenvolvimento que não fazem parte da release. Inicie o serviço e confira os logs sem expor conteúdo das sessões.

Sem Docker, o servidor entrega as mensagens ao Codex; não crie um serviço `codex:bridge` adicional. Deixe `HABBLAUD_PTY` desligado por padrão. Se eu solicitar terminal interativo ou criação de agentes pelo escritório, explique a atuação local e valide executáveis e dependências antes de ativar `HABBLAUD_PTY=1`.

## 5 Conectar os agentes existentes

Use os mesmos diretórios e a mesma porta do serviço nas ferramentas de instalação. Antes de alterar configurações, confira o plano com os comandos `--dry-run` disponíveis e preserve os backups dos instaladores.

- **Claude Code:** execute `npm run mod:install` sem `--sem-permissoes` ou `--sem-mensagens`, usando `HABBLAUD_PORT` no ambiente. Confira `npm run mod:status`. Os identificadores `habblaud`, `habblaud-permissoes` e `habblaud-mensagens` são os nomes compatíveis das integrações locais, não o plugin jurídico hospedado.
- **Codex:** execute `npm run codex:install -- --port <PORTA_ESCOLHIDA>` e confira `npm run codex:status -- --port <PORTA_ESCOLHIDA>`, substituindo o marcador pela porta validada. Preserve os outros hooks. Não edite `config.toml`, hashes de confiança ou aprovações. A aprovação fica para mim na interface `/hooks` da versão compatível do Codex; se ela não estiver disponível, registre essa etapa como pendente.

Não troque nomes de variáveis, chaves de armazenamento, marketplaces ou diretórios persistentes apenas para remover a palavra Habblaud.

## 6 Preparar o endereço HTTPS local

Reutilize um HTTPS local existente somente se estiver saudável e encaminhar para esta instalação. Para uma instalação nova pelo proxy, confira Node.js 24+ e instale `portless@0.15.8` somente se necessário:

```text
npm install -g portless@0.15.8
portless alias dissero <PORTA_ESCOLHIDA>
portless proxy start
portless trust
```

Substitua o marcador pela porta HTTP escolhida. Confira as rotas antes de criar o alias; se `dissero` apontar para outro destino, não use `--force`. Preserve outros proxies e aliases. Não habilite LAN, túnel, encaminhamento público ou acesso pelo celular.

Valide a persistência do proxy separadamente da persistência do aplicativo. `portless service install` cria um serviço privilegiado: root no macOS/Linux e SYSTEM no Windows. Explique esse alcance e obtenha autorização específica antes de usá-lo; sem ela, deixe a persistência do proxy pendente ou apresente uma alternativa a ser validada. Não confunda o proxy com o serviço do aplicativo, que permanece no usuário.

Se a confiança do certificado exigir ação minha, apresente a etapa exata. Não contorne avisos do navegador nem desative a validação TLS. Não habilite também o listener HTTPS nativo na mesma porta usada pelo proxy.

## 7 Verificar o resultado real

1. Confira `http://127.0.0.1:<PORTA_ESCOLHIDA>/api/health`: versão selecionada, `docker=false` e recursos aplicáveis. Distinga `terminal` de `pty`; este último é opcional e depende da ativação e de um teste nativo.
2. Confira `/api/updates`: o repositório deve ser `brunoflma/disserohub`. **Verificar agora** consulta releases e não instala código.
3. Valide `mod:status` e `codex:status` apenas para os agentes que eu utilizo. Arquivos de hooks instalados não provam confiança aprovada nem uma sessão funcionando.
4. Abra `https://dissero.localhost` no navegador do usuário. Não substitua essa verificação por uma consulta HTTP ou por uma demonstração fictícia.
5. Confirme conexão ao vivo após uma interação neutra minha no agente, sem enviar documentos ou mensagens de trabalho. Se a aprovação dos hooks ainda depender de mim, registre que a prova completa está pendente.
6. Reinicie somente o novo serviço e confira recuperação, uma única instância e manutenção da porta e da configuração. Não reinicie o computador ou outros serviços para testar sem autorização.

## Resposta ao concluir

Seja curto: informe **Pronto** ou **Parcial**, endereço, sistema, método nativo, release, agentes verificados e os testes que passaram. Em **Sua vez**, liste somente as ações humanas pendentes; para o Codex, inclua reabrir a sessão e aprovar os hooks quando necessário, e para o Claude Code indique `/reload-plugins` nas sessões já abertas. Informe também os comandos e caminhos reais para status, logs, reinício e retomada.

Não declare a instalação pronta com serviço, HTTPS ou integrações solicitadas ainda pendentes. Preserve dados, fonte e configuração para manutenção; atualizações futuras devem vir de releases aprovadas do DisseroHub, em um candidato separado.
