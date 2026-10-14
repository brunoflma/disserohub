// Ajuda ("?"): legenda de status e ícones, controles, o que o escritório mostra, contas e uso, Claude e ChatGPT.
import type { AgentStatus } from '../../../shared/types';
import type { HelpSection } from './context';
import { h, iconButton, prefersReducedMotion } from './dom';
import { ICONS } from './icons';
import { STATUS_LABEL } from './model';
import { createUsageSetup, richText } from './usage';
import { createAccountChip, updateAccountChip } from './widgets';
import { tr } from '../../../shared/i18n';

const STATUS_HELP: [AgentStatus, string][] = [
  ['working', tr('Na mesa, digitando: está processando um pedido.')],
  ['waiting', tr('Mão levantada: espera uma resposta sua no terminal (permissão, pergunta ou escolha).')],
  ['shell', tr('O turno terminou e há um comando do terminal em execução. O agente permanece na mesa lendo documentos enquanto espera o resultado.')],
  ['idle', tr('Não há tarefa imediata; o agente pode circular pelas áreas comuns até receber uma nova instrução.')],
  ['done', tr('Subagente concluído: entrega o resultado e deixa o escritório.')],
  ['offline', tr('A sessão foi encerrada e o personagem deixa o escritório.')],
];

const ICON_HELP: [string, string][] = [
  ['📨', tr('Recebeu um pedido')],
  ['💭', tr('Pensando')],
  ['📖', tr('Lendo arquivo')],
  ['🔎', tr('Buscando no código')],
  ['✏️', tr('Editando')],
  ['📝', tr('Escrevendo arquivo')],
  ['💻', tr('Comando no terminal')],
  ['⏳', tr('Esperando o comando terminar')],
  ['🧪', tr('Rodando testes')],
  ['🌐', tr('Pesquisando na web')],
  ['🗒️', tr('Organizando tarefas')],
  ['👥', tr('Chamando subagentes')],
  ['✋', tr('Precisa de você')],
  ['✅', tr('Concluiu')],
  ['❌', tr('Comando falhou')],
  ['🛑', tr('Comando interrompido')],
  ['⚠️', tr('Algo deu errado')],
];

/** Áreas comuns e interações da apresentação do escritório jurídico. */
const SOCIAL_HELP: [string, string][] = [
  ['📚', tr('Sala de Convivência: um agente pode fazer uma leitura individual; de 2 a 4 agentes podem debater uma tese e organizar os argumentos.')],
  ['☕', tr('Copa: uma mesa com seis lugares para uma pausa curta e conversa entre agentes disponíveis.')],
  ['🛎️', tr('Recepção: dois lugares de espera agrupados, usados para aguardar ou fazer uma leitura breve.')],
  ['🚻', tr('Banheiro: uma passagem breve, sem assento de descanso.')],
  ['↩️', tr('Quando recebe uma nova instrução, o agente deixa a área comum e retorna ao trabalho.')],
];

/** Eventos de integração que podem ser apresentados no feed. */
const GITHUB_HELP: [string, string][] = [
  ['📌', tr('Pull requests, releases e verificações de CI podem aparecer no feed quando a integração os fornece.')],
  ['⚠️', tr('Falhas de verificação ficam destacadas como aviso; a correção continua no serviço de origem.')],
  ['↗️', tr('Pushes e outros eventos podem aparecer apenas como informação no feed.')],
];

/** O provedor ChatGPT no escritório e os dados que a sessão pode fornecer. */
const CODEX_HELP: string[] = [
  tr('As sessões do ChatGPT podem compartilhar a sala do projeto com sessões do Claude Code. O provedor é identificado pelo logotipo correspondente.'),
  tr('O feed, os detalhes e o terminal mostram somente as informações que a sessão local disponibiliza.'),
  tr('Terminal, pedidos de permissão, perguntas e envio de mensagens aparecem apenas quando a sessão oferece esses controles; a própria interface indica quando estão disponíveis.'),
  tr('O uso mostra a última leitura fornecida pela sessão. A idade da leitura aparece no cartão, e a ausência de números não significa necessariamente uso zero.'),
  tr('Referências técnicas ao Codex podem aparecer no projeto; na interface, o provedor é apresentado como ChatGPT.'),
];

/** Resultado de um comando que estava em execução. */
const SHELL_END_HELP: [string, string][] = [
  ['✅', tr('Concluído: o resultado do comando foi recebido e a sessão pode continuar.')],
  ['⚠️', tr('Falhou ou foi interrompido: o estado fica registrado no feed e nos detalhes.')],
];

const SHELL_WAIT_HELP: [string, string][] = [
  ['📄', tr('O agente permanece na mesa lendo documentos enquanto o comando do terminal termina.')],
  ['⏱️', tr('O comando esperado e o tempo de espera aparecem no estado e nos detalhes.')],
];

const INTRO =
  tr('Cada projeto com sessões de agentes acompanhadas pelo Dissero aparece como uma sala, e cada sessão é representada por um personagem com nome próprio. ') +
  tr('Subagentes entram como membros temporários da equipe, trabalham na mesma sala e deixam o escritório quando concluem. ') +
  tr('A Ajuda explica os estados, os controles, o feed e as informações de conta sem alterar a sessão.');

const SHORTCUTS: [string[], string][] = [
  [['/'], tr('Buscar agente, projeto ou conta')],
  [['F'], tr('Seguir o agente selecionado')],
  [['T'], tr('Abrir ou fechar o terminal do agente selecionado')],
  [['Ctrl+F'], tr('Com o terminal em foco: buscar na conversa (⌘F no Mac); Enter e Shift+Enter navegam')],
  [['L'], tr('Abrir ou fechar o timelapse do dia')],
  [['P'], tr('Ir até o próximo pedido de permissão ou pergunta para responder pelo escritório')],
  [['M'], tr('Meu dia: para onde foi o tempo (trabalhando, esperando você...)')],
  [['O', '0'], tr('Visão geral do prédio')],
  [['Esc'], tr('Fechar a busca do terminal, depois o terminal; depois, a gaveta e a seleção')],
  [['['], tr('Mostrar ou ocultar o painel lateral')],
  [[']'], tr('Mostrar ou ocultar o feed de atividade')],
  [['?'], tr('Abrir esta ajuda')],
  [['←', '↑', '→', '↓'], tr('Mover a câmera (também W A S D)')],
  [['+', '−'], tr('Aproximar e afastar')],
];

function keys(list: string[]): HTMLElement {
  return h('span', { class: 'ui-keys' }, ...list.map((k) => h('kbd', { class: 'ui-kbd', text: k })));
}

export class HelpDialog {
  readonly el: HTMLDialogElement;
  private sections = new Map<HelpSection, HTMLElement>();

  constructor() {
    const close = iconButton(ICONS.close, tr('Fechar ajuda'), () => this.el.close(), 'ui-icon-btn--sm');
    const statusList = h(
      'ul',
      { class: 'ui-legend' },
      ...STATUS_HELP.map(([s, text]) =>
        h('li', {}, h('span', { class: `ui-status-dot is-${s}`, attrs: { 'aria-hidden': 'true' } }), h('strong', { text: STATUS_LABEL[s] }), h('span', { text })),
      ),
    );
    const iconList = h(
      'ul',
      { class: 'ui-icon-legend' },
      ...ICON_HELP.map(([icon, text]) => h('li', {}, h('span', { class: 'ui-icon-legend__icon', text: icon, attrs: { 'aria-hidden': 'true' } }), h('span', { text }))),
    );
    const shortcuts = h('dl', { class: 'ui-shortcuts' }, ...SHORTCUTS.flatMap(([k, text]) => [h('dt', {}, keys(k)), h('dd', { text })]));

    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-help', attrs: { 'aria-labelledby': 'ui-help-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Como ler o escritório'), attrs: { id: 'ui-help-title' } }), close),
      h(
        'div',
        { class: 'ui-dialog__body' },
        h('section', { class: 'ui-help__intro' }, h('p', { text: INTRO })),
        this.navigationSection(),
        this.feedSection(),
        h('section', {}, h('h3', { text: 'Status' }), statusList),
        h('section', {}, h('h3', { text: tr('Atividades') }), iconList),
        this.shellSection(),
        this.socialSection(),
        this.githubSection(),
        this.appearanceSection(),
        h(
          'section',
          {},
          h('h3', { text: tr('Controles') }),
          h(
            'ul',
            { class: 'ui-help__list' },
            h('li', { text: tr('Arraste o escritório para mover a câmera e use a rolagem do mouse (ou pinça) para dar zoom.') }),
            h('li', { text: tr('Clique em um personagem ou sala para ver os detalhes; duplo clique aproxima a câmera.') }),
            h('li', { text: tr('Passe o mouse sobre um personagem para ver o que ele está fazendo.') }),
            h('li', {
              text: tr('Quando disponível, “Abrir terminal” mostra a conversa da sessão. Se a fonte não oferecer essa visualização, o botão fica indisponível ou informa a limitação.'),
            }),
            h('li', {
              text: tr('Perguntas e pedidos de permissão aparecem com os controles disponíveis para aquela sessão. A resposta segue pelo controle indicado na própria interface.'),
            }),
            h('li', {
              text: tr('No terminal aberto, a busca, os filtros da conversa e o botão de copiar ficam disponíveis quando suportados pela sessão. O relógio da barra superior abre o histórico das sessões que o aplicativo recebeu.'),
            }),
          ),
          shortcuts,
        ),
        this.usageSection(),
        this.codexSection(),
      ),
    );
    // Clique no fundo (fora do conteúdo) fecha.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  open(section?: HelpSection): void {
    if (!this.el.open) this.el.showModal();
    const target = section ? this.sections.get(section) : undefined;
    if (!target) return;
    // Rola até a seção pedida e a destaca por um instante.
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      target.classList.remove('is-highlight');
      void target.offsetWidth;
      target.classList.add('is-highlight');
      const heading = target.querySelector<HTMLElement>('h3');
      heading?.focus({ preventScroll: true });
    });
  }

  private navigationSection(): HTMLElement {
    return h(
      'section',
      {},
      h('h3', { text: tr('Navegação e painéis') }),
      h(
        'ul',
        { class: 'ui-help__list' },
        h('li', { text: tr('A barra de câmera oferece Escritório, Salas, Seguir e Padrão. O seletor escolhe um projeto com agentes; ‹ e › percorrem os projetos, e o conjunto se adapta ao espaço disponível em janelas menores.') }),
        h('li', { text: tr('A barra lateral reúne projetos e agentes. Use a busca, os filtros “Em andamento” e “Recentes” e o filtro por conta para encontrar uma sessão.') }),
        h('li', { text: tr('Os subagentes ficam sempre visíveis abaixo do agente principal. O resumo mostra quantos trabalham, executam comandos ou precisam de você.') }),
        h('li', { text: tr('Ao lado da busca, “Adicionar projeto” abre a escolha de uma pasta. A pasta adicionada aparece como uma sala, inclusive quando não há agentes nela.') }),
        h('li', { text: tr('A barra lateral, o feed e a gaveta de detalhes podem ser abertos ou fechados. As alças nas bordas permitem redimensionar os painéis, e o layout se ajusta quando a janela fica estreita.') }),
      ),
    );
  }

  private feedSection(): HTMLElement {
    return h(
      'section',
      {},
      h('h3', { text: tr('Feed de atividade') }),
      h(
        'ul',
        { class: 'ui-help__list' },
        h('li', { text: tr('Use “Importantes” para acompanhar os eventos principais ou “Tudo” para ver toda a atividade recebida.') }),
        h('li', { text: tr('O escopo pode ser “Todos”, o projeto atual ou o agente atual. O filtro por conta da barra lateral também afeta o feed.') }),
        h('li', { text: tr('Eventos semelhantes que acontecem próximos uns dos outros são agrupados em uma linha; o número de repetições aparece ao lado.') }),
        h('li', { text: tr('Abra “Detalhes completos do evento” para consultar o texto original, a ferramenta e os detalhes recebidos.') }),
      ),
    );
  }

  private appearanceSection(): HTMLElement {
    return h(
      'section',
      {},
      h('h3', { text: tr('Aparência') }),
      h(
        'ul',
        { class: 'ui-help__list' },
        h('li', { text: tr('Automático: usa Halloween em outubro e Natal de novembro a 26 de dezembro.') }),
        h('li', { text: tr('Nenhum: mantém o escritório jurídico sem decoração sazonal.') }),
        h('li', { text: tr('Natal e Halloween: aplicam a decoração temática correspondente sobre a mesma ambientação jurídica.') }),
        h('li', { text: tr('As peças escolhidas no editor de personagens são preservadas em qualquer uma das quatro opções.') }),
      ),
    );
  }

  /** Explica o estado de espera por um comando do terminal. */
  private shellSection(): HTMLElement {
    const item = (emoji: string, text: string) =>
      h('li', {}, h('span', { class: 'ui-icon-legend__icon', text: emoji, attrs: { 'aria-hidden': 'true' } }), h('span', { text }));
    return h(
      'section',
      { class: 'ui-help__shell' },
      h('h3', { text: tr('Comando em execução') }),
      h('p', {
        class: 'ui-help__lead',
        text: tr('Quando o turno termina enquanto um comando continua em execução, o agente permanece na mesa lendo documentos. O estado mostra o comando esperado e o tempo de espera; quando o comando termina, a sessão recebe o resultado.'),
      }),
      h('ul', { class: 'ui-shell-legend' }, ...SHELL_WAIT_HELP.map(([e, t]) => item(e, t)), ...SHELL_END_HELP.map(([e, t]) => item(e, t))),
    );
  }

  /** Legenda das áreas comuns e das discussões da Sala de Convivência. */
  private socialSection(): HTMLElement {
    const item = (emoji: string, text: string) =>
      h('li', {}, h('span', { class: 'ui-icon-legend__icon', text: emoji, attrs: { 'aria-hidden': 'true' } }), h('span', { text }));
    return h(
      'section',
      { class: 'ui-help__shell' },
      h('h3', { text: tr('Áreas comuns e Sala de Convivência') }),
      h('p', {
        class: 'ui-help__lead',
        text: tr('Quando não há trabalho imediato, os agentes podem fazer uma pausa nas áreas comuns ou conversar na Sala de Convivência. Uma nova instrução os chama de volta ao trabalho.'),
      }),
      h('ul', { class: 'ui-shell-legend' }, ...SOCIAL_HELP.map(([e, t]) => item(e, t))),
    );
  }

  /** Legenda de eventos de integração apresentados no feed. */
  private githubSection(): HTMLElement {
    const item = (emoji: string, text: string) =>
      h('li', {}, h('span', { class: 'ui-icon-legend__icon', text: emoji, attrs: { 'aria-hidden': 'true' } }), h('span', { text }));
    return h(
      'section',
      { class: 'ui-help__shell' },
      h('h3', { text: tr('Eventos de integração') }),
      h('p', {
        class: 'ui-help__lead',
        text: tr('Quando uma integração conectada fornece eventos de repositório ou CI, eles podem aparecer como avisos no feed. A Ajuda explica a apresentação; qualquer ação continua no serviço de origem.'),
      }),
      h('ul', { class: 'ui-shell-legend' }, ...GITHUB_HELP.map(([e, t]) => item(e, t))),
    );
  }

  private usageSection(): HTMLElement {
    const el = h(
      'section',
      { class: 'ui-help__usage', attrs: { 'aria-labelledby': 'ui-help-usage' } },
      h('h3', { text: tr('Contas e uso'), tabIndex: -1, attrs: { id: 'ui-help-usage' } }),
      h(
        'ul',
        { class: 'ui-help__list' },
        h('li', { text: tr('O logotipo identifica Claude ou ChatGPT. A cor da borda e o nome distinguem as contas de cada provedor.') }),
        h('li', {}, accountSample('C', '#f08a3c'), tr(' Claude Code · '), accountSample('X', '#a77bf3', true), tr(' ChatGPT. Cada provedor aparece com seu próprio logotipo.')),
        h('li', {
          text: tr('No topo, cada conta mostra as janelas de uso que o provedor informa. Quando houver, aparecem a sessão de 5 horas e a semana; o ↻ indica quando cada limite reinicia. Verde significa menos de 50%, âmbar até 80% e vermelho a partir daí.'),
        }),
        h('li', { text: tr('Números antigos ficam acinzentados com a idade ao lado (ex.: “há 3 h”); uma janela que já reiniciou desde a leitura mostra “—” e “renovada”.') }),
      ),
      h('p', { class: 'ui-help__lead', text: tr('Para ver o uso de uma conta (“sem dados de uso”), em ordem de preferência:') }),
      createUsageSetup(),
    );
    this.sections.set('usage', el);
    return el;
  }

  /** O provedor ChatGPT no escritório (o "Como funciona" do cartão de uso abre aqui). */
  private codexSection(): HTMLElement {
    const el = h(
      'section',
      { class: 'ui-help__usage', attrs: { 'aria-labelledby': 'ui-help-codex' } },
      h('h3', { text: 'ChatGPT', tabIndex: -1, attrs: { id: 'ui-help-codex' } }),
      h('ul', { class: 'ui-help__list' }, ...CODEX_HELP.map((text) => h('li', {}, ...richText(text)))),
    );
    this.sections.set('codex', el);
    return el;
  }

  get isOpen(): boolean {
    return this.el.open;
  }
}

/** Um chip de conta de exemplo (legenda). */
function accountSample(short: string, color: string, codex = false): HTMLElement {
  const chip = createAccountChip('sm');
  updateAccountChip(chip, { id: short, short, name: codex ? 'ChatGPT' : tr('Conta {0}', [short]), color, configDir: '', sessions: 0, usageStatus: 'disabled', ...(codex ? { provider: 'codex' as const } : {}) });
  chip.setAttribute('aria-hidden', 'true');
  return chip;
}
