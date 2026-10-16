# Capacidade da máquina para instalar o DisseroHub

O caminho padrão é a **instalação nativa via Node.js/npm**, como a utilizada neste projeto. Nesse caminho, **8 GB podem atender ao perfil básico**, conforme a memória disponível e a carga real; **16 GB são a recomendação de conforto**. Não exigir 32 GB para esse uso. Docker é opcional, escolhido explicitamente, com diagnóstico independente.

Esses limites são uma **política provisória do DisseroHub**, destinada ao conjunto escritório visual, navegador, PDFs e agentes que usam modelos na nuvem. Não são mínimos publicados pelos fornecedores nem resultado de um benchmark. A integração continua desativada; esta preparação não instala ou reconfigura nada.

## Perfil proposto

Os valores de memória e disco da regra usam GiB (1.024³ bytes); as faixas comerciais de RAM são chamadas de 8/16/32 GB. Para a RAM total visível ao sistema, a comparação tolera até 0,5 GiB reservados pelo sistema. Essa tolerância não se aplica à memória disponível ou ao espaço livre.

| Recurso | Nativo/npm: básico condicionado | Nativo/npm: recomendado | Docker: básico condicionado | Docker: preferido para Desktop |
| --- | --- | --- | --- | --- |
| RAM total | 8 GB | 16 GB | 16 GB | 32 GB |
| RAM disponível no momento | 2 GiB | 4 GiB | 6 GiB | 10 GiB |
| CPUs lógicas disponíveis ao processo | 2 | 4 | 4 | 8 |
| Espaço livre em cada sistema de arquivos de instalação/dados | 10 GiB | 10 GiB | 25 GiB | 40 GiB |
| Armazenamento recomendado | SSD | SSD | SSD | SSD |
| Recursos medidos do daemon/VM Docker | — | — | 4 GiB de RAM, 2 CPUs lógicas e 10 GiB livres | 8 GiB de RAM, 4 CPUs lógicas e 20 GiB livres |

Esses espaços são uma reserva inicial para dependências, compilação, imagens e crescimento; não limitam o tamanho de um acervo. Instalação e dados no mesmo sistema de arquivos compartilham a mesma medição, sem somar sua capacidade duas vezes. O armazenamento das imagens/VM Docker precisa de uma medição própria. Não basta olhar o espaço da pasta do código ou o limite máximo do disco virtual.

O perfil nativo não reserva memória de VM, não consulta Docker e não exige WSL no Windows. Uma máquina de 8 GB com 2 GiB disponíveis pode ser avaliada como `basic`, com aviso para validar compilação e responsividade. Se houver menos memória disponível, adiar e medir novamente; não reprovar apenas pelo total de 8 GB. Os números de CPU, memória e disco continuam provisórios. A compilação pode ter um pico superior ao uso contínuo do servidor; capacidade favorável não garante que ela terminará.

Em uma amostra somente de leitura da instalação existente em 15/10/2026, `/api/health` confirmou v0.11.2 com `docker=false`; o processo Node do servidor tinha aproximadamente 48 MiB residentes e 86 MiB privados comprometidos. São duas medidas diferentes, que não devem ser somadas. A amostra exclui navegador, agentes, proxy e pico de compilação, em uma máquina de 64 GB. Ela confirma o caminho nativo e não homologa desempenho em uma máquina de 8 GB.

Contar CPUs lógicas não mede geração, frequência ou desempenho de um processador. SSD é uma recomendação, não uma inferência feita a partir da letra do disco. A política não exige GPU dedicada para o escritório visual e agentes na nuvem. Modelos locais, OCR local, transcrição e várias tarefas intensivas simultâneas exigem dimensionamento separado.

## O que as fontes oficiais estabelecem

Fontes consultadas em 15/10/2026:

- **Claude Code:** 4 GB ou mais de RAM e processador x64 ou ARM64. É o mínimo desse componente, não uma garantia para todo o ambiente de trabalho. [Instalação oficial](https://code.claude.com/docs/en/setup).
- **Docker Desktop no Windows:** 8 GB de RAM, processador de 64 bits com SLAT e virtualização habilitada, além dos requisitos de versão do Windows/WSL2. [Requisitos oficiais do Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Docker Desktop no macOS e Linux:** pelo menos 4 GB de RAM. No Linux, Desktop também exige virtualização/KVM; esses requisitos não devem ser transferidos ao Docker Engine nativo. [macOS](https://docs.docker.com/desktop/setup/install/mac-install/), [Linux](https://docs.docker.com/desktop/setup/install/linux/).
- **Memória do Docker:** no macOS, Linux e backend Hyper-V do Windows, a configuração documentada de memória da VM usa 50% da RAM do host por padrão. O backend WSL2 tem configuração própria; medir o orçamento efetivo. A RAM da VM vem da RAM do host: não somar as duas como capacidade independente. [Configurações oficiais](https://docs.docker.com/desktop/settings-and-maintenance/settings/).
- **Codex:** as páginas consultadas não estabelecem um mínimo numérico de RAM; não atribuir um valor oficial por suposição. Para Windows, a documentação recomenda Windows 11 e trata Windows 10 atualizado como suporte de melhor esforço. [Aplicativo](https://developers.openai.com/codex/app/), [Windows](https://developers.openai.com/codex/windows/).
- **DisseroHub:** a release de referência v0.11.2 exige Node.js 22.12+. O proxy opcional deste plano, `portless@0.15.8`, exige Node.js 24+. Os requisitos de sistema, versões e permissões continuam sendo conferidos pelo [prompt de instalação](INSTALAR-SEM-DOCKER.md), separadamente da capacidade de hardware.

O mínimo do Docker não define o mínimo do npm. A política nativa não bloqueia automaticamente uma máquina de 8 GB e não depende de Docker instalado ou funcionando. Nessa faixa, informar o perfil básico e a necessidade de conferir a experiência com navegador, PDFs e agentes reais. Não há um modo reduzido a ser ativado nem alterações automáticas de preferências. Uma máquina de 32 GB pode ajudar em maior concorrência, mas esse total não é requisito do caminho nativo preparado.

## Regra preparada e resultados

A [política em JSON](capacity-policy.json) é a fonte dos números. O [diagnóstico somente de leitura](check-capacity.mjs) coleta RAM total/disponível, CPUs lógicas e espaço dos destinos. Não consulta a rede ou o Docker, não faz teste de estresse, não fecha programas, não instala dependências, não muda swap/VM e não grava relatório. Sua saída JSON não contém nome do usuário, máquina, caminhos dos destinos ou conteúdo de sessões.

Com Node compatível já disponível, executar na pasta do repositório, substituindo os caminhos pelos destinos reais:

```text
node docs/onboarding/check-capacity.mjs --method native --install-dir CAMINHO_DO_CODIGO --data-dir CAMINHO_DOS_DADOS
node docs/onboarding/check-capacity.mjs --method docker --install-dir CAMINHO_DO_CODIGO --data-dir CAMINHO_DOS_DADOS
```

Sem argumentos de caminho, usa `~/disserohub` e `~/.habblaud`. Não passar caminhos de exemplo à instalação. Para diretório ainda inexistente, a medição usa o ancestral existente e identifica isso na saída; repetir se o destino/montagem mudar. Se houver falta de acesso, registrar medição desconhecida. Não instalar Node apenas para diagnosticar a capacidade.

| Resultado | Conduta futura |
| --- | --- |
| `eligible`, perfil `basic` ou `recommended` | Apenas a capacidade passou; apresentar os avisos do perfil básico, conferir compatibilidade, dependências e pedido de instalação |
| `not_recommended` | RAM total/CPU abaixo da política ou plataforma fora do perfil; não iniciar instalação padrão |
| `defer` | Memória disponível, disco ou orçamento Docker insuficiente agora; informar motivo e repetir após ação do usuário |
| `needs_review` | Medição ausente, contraditória ou ambiente parcial; completar diagnóstico antes de decidir |

Código de saída: `0` indica que a capacidade passou; `2` indica avaliação pendente/desfavorável; `1` indica erro de execução/argumentos. Nenhum resultado autoriza instalar. `integrationEnabled` e `installationAuthorized` permanecem falsos.

No Linux, medir `MemAvailable`, não apenas páginas livres. No macOS, `os.freemem()` é um limite inferior conservador: um valor baixo exige conferir pressão de memória no Monitor de Atividade, em vez de reprovar por esse número isolado. No Windows, a coleta nativa usa a memória física disponível ao sistema.

Dentro do WSL, contêiner ou processo com limite de memória detectado, a coleta exige diagnóstico complementar do host; não classifica a capacidade física pela RAM do convidado. No fluxo Windows/WSL, executar primeiro a medição no Windows. A detecção de ambiente não substitui o inventário do instalador; ambientes de virtualização não reconhecidos exigem revisão.

Para Docker, a ferramenta intencionalmente retorna pendência de orçamento: um futuro consumidor precisa obter, por consultas somente de leitura, a confirmação do daemon **local**, seu modo `vm` ou `engine`, RAM/CPU efetivas e espaço disponível no armazenamento real. O avaliador aceita esses dados no objeto `docker`, mas o coletor não os presume nem oferece um argumento para forçar aprovação. Não consultar um contexto remoto como se fosse a máquina do usuário e não iniciar/reiniciar o daemon para completar o diagnóstico. Engine nativo Linux não exige os pré-requisitos de VM do Desktop. Limites de contêiner/cgroups também precisam ser conferidos antes da execução.

Só executar essa avaliação Docker quando o método tiver sido escolhido. Falta de Docker ou de orçamento da VM não interfere na avaliação nativa, e uma falha nativa não autoriza instalar Docker como alternativa automática.

Sem Node, o agente futuro deve usar consultas nativas somente de leitura: Windows `Get-CimInstance Win32_OperatingSystem` para memória, `Win32_Processor` para CPUs lógicas e espaço dos volumes reais; Linux `/proc/meminfo`, `nproc` e `df`; macOS `sysctl` para RAM/CPUs, Monitor de Atividade para pressão e `df` para disco. Coletar apenas os campos de capacidade, sem despejar inventário ou identidades. Comparar os valores com a mesma política; dado indisponível exige revisão. Não executar o prompt de instalação para fazer esse diagnóstico.

## Verificação e homologação pendente

Os [casos automatizados](check-capacity-cases.mjs) verificam decisões com medições sintéticas de 8/16/32 GiB, memória ocupada, volumes distintos, dados desconhecidos, macOS, WSL/contêiner e orçamentos Docker. Executar sem dependências:

```text
node --test docs/onboarding/check-capacity-cases.mjs
```

Esses testes não medem desempenho nem homologam os sistemas simulados. Antes de ativar o primeiro uso, validar coleta e instalação limpa em Windows, macOS e Linux; testar máquinas reais de 8/16/32 GB com navegador, PDFs, um agente e ambos os agentes. Registrar memória disponível/pressão, uso de swap, duração da compilação, uso de disco e responsividade antes/depois. No Docker, medir também o orçamento e armazenamento da VM/daemon. Não impor testes de estresse ao usuário.

Um diagnóstico favorável na máquina de desenvolvimento demonstra apenas que a coleta funciona naquele ambiente. Os limites devem ser revistos com essas medições, sem transformar capacidade em autorização de instalação ou de integração com o plugin.
