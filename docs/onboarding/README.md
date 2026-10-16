# Primeira instalação do DisseroHub

Estes prompts preparam a instalação do ambiente visual do Dissero em uma máquina de advogado. O pacote está **preparado para revisão, com a integração de primeiro uso desativada**. A leitura destes arquivos não autoriza executar uma instalação.

## Prompts para o agente instalador

- [Instalar sem Docker](INSTALAR-SEM-DOCKER.md): **caminho padrão**, Windows nativo, macOS ou Linux, com Node.js/npm e um serviço do usuário.
- [Instalar com Docker](INSTALAR-COM-DOCKER.md): macOS ou Linux; no Windows, Docker Desktop com WSL2 e um ambiente de instalação definido.
- [Contrato do primeiro uso](PRIMEIRO-USO.md): escolha do método, estados, verificações e futura conexão com o plugin.
- [Capacidade da máquina](REQUISITOS.md): npm com perfil básico de 8 GB condicionado à memória disponível e 16 GB recomendado; Docker opcional com avaliação própria. Política provisória e diagnóstico somente de leitura.
- [Manifesto da preparação](manifest.json): caminhos dos prompts e indicação explícita de que a integração permanece desativada.

Os prompts são textos destinados ao agente que executará uma solicitação futura de instalação. Eles não são um instalador executável nem um comando do plugin. O advogado poderá pedir a instalação e o agente adaptará os passos ao sistema detectado. O diagnóstico de capacidade é uma ferramenta separada, somente de leitura e sem ligação automática com o plugin.

## Escolha do método

| Situação | Caminho previsto |
| --- | --- |
| Primeira instalação sem preferência por contêiner | Node.js/npm nativo como padrão, para reduzir as dependências e manter os recursos nativos disponíveis |
| Docker já faz parte do ambiente e o usuário prefere contêiner | Com Docker, após conferir o daemon, o Compose e os caminhos dos agentes |
| Windows sem Docker | Node.js nativo; WSL não é requisito desse caminho |
| Windows com Docker | Escolher um único ambiente coordenador no WSL2; conferir separadamente os agentes nativos do Windows |
| Máquina com 8 GB | Avaliar o perfil básico nativo via npm, com memória disponível e carga real; não aplicar os requisitos de Docker |
| Recursos ocupados ou diagnóstico incompleto | Completar o diagnóstico antes de uma instalação nova; não trocar para Docker automaticamente |
| DisseroHub já instalado e saudável | Reutilizar e verificar; não reinstalar nem iniciar uma segunda instância |
| Instalação anterior do Habblaud ou conflito de dados, serviço, porta ou volume | Preparar uma migração separada, sem sobrescrever a instalação existente |

O histórico de sessões, as permissões e as mensagens são distintos do terminal interativo. O terminal interativo exige execução nativa e ativação explícita de `HABBLAUD_PTY`; não funciona dentro do contêiner. O modo Docker usa um auxiliar no host para entregar mensagens ao Codex.

## Origem e compatibilidade

Código e releases: [brunoflma/disserohub](https://github.com/brunoflma/disserohub). A seleção de código deve usar uma release estável publicada, com tag e commit registrados. A referência verificada em 15/10/2026 é [v0.11.2](https://github.com/brunoflma/disserohub/releases/tag/v0.11.2), commit `473779b6aa23670aea45b5a24d669f10ec57a0f7`. Essa referência não substitui a seleção de release em uma instalação futura.

A referência v0.11.2 do aplicativo exige Node.js 22.12+; uma instalação futura deve conferir também os requisitos da release selecionada. Para uma instalação nova que use o proxy HTTPS proposto, o pacote `portless@0.15.8` exige Node.js 24+. A versão do proxy fica registrada no manifesto; atualizá-la exige rever os requisitos e os comandos. Consulte o [pacote oficial](https://www.npmjs.com/package/portless/v/0.15.8) e a [documentação correspondente ao seu commit de publicação](https://github.com/vercel-labs/portless/blob/27598545f08f8055cb3b9fb410f8d250f054f46d/README.md).

Os nomes internos `habblaud`, `HABBLAUD_*`, os três plugins locais do Claude Code e o diretório `~/.habblaud` permanecem por compatibilidade. Os recursos Docker também conservam seus nomes atuais; não crie uma segunda instalação que dispute o mesmo contêiner ou volume.

O plugin jurídico hospedado e o ambiente visual têm ciclos separados. Estes prompts não instalam, renomeiam, autenticam ou configuram o plugin jurídico, e não alteram o Cloudflare.

## Condições para habilitar o primeiro uso

| Cenário | Evidência necessária |
| --- | --- |
| Windows nativo, macOS e Linux sem Docker | Instalação limpa, serviço, HTTPS, integrações aplicáveis e reutilização sem duplicação |
| Docker em macOS, Linux e Windows com WSL2 | Instalação limpa, montagens limitadas, persistência, auxiliar do host e acesso pelo navegador do usuário |
| Falta de permissão, reinício ou confiança de hooks | Retomada a partir do ponto pendente, sem repetir alterações já aplicadas |
| Capacidade da máquina | Homologar a coleta nos três sistemas e a política provisória em máquinas reais de 8/16/32 GB; testes sintéticos não provam desempenho |
| Porta ocupada ou instalação anterior | Detecção e preservação da instalação existente |
| Integração com o plugin | Autorização posterior para implementar e ativar o contrato de primeiro uso |

A instalação local existente e a CI do aplicativo não homologam uma primeira instalação limpa em todos esses ambientes. O pacote mantém essa homologação pendente. Os prompts e o contrato precisam estar disponíveis na distribuição que vier a ser consumida pelo plugin; arquivos locais novos não fazem parte retroativamente da release v0.11.2.
