// Versão do Dissero: o número na barra superior, o selo "Nova versão" quando o GitHub tem uma release mais
// nova (quem consulta é o servidor, server/updates/checker.ts), o aviso único por versão e a seção "Sobre"
// das configurações (estado da verificação, "Verificar agora", novidades e como atualizar).
import type { Notice, OfficeSnapshot, UpdateStatus } from '../../../shared/types';
import type { UiComponent, UiContext } from './context';
import { h, setAttr, setHidden, setText, setTitle, setVariant } from './dom';
import { formatDateTime, relativeTime } from './format';
import { pixelIcon } from './icons';
import { safeLocalStorage } from './prefs';
import { tr } from '../../../shared/i18n';
import { UPSTREAM_BASE_VERSION, UPSTREAM_REFERENCE_VERSION } from '../../../shared/distribution';
import type { UpdateInstallStatus } from '../../../shared/update-install';
import { UpdateInstallController, type UpdateInstallIssue } from '../net/update-install';

/** Última versão nova já avisada neste navegador (o aviso sai uma vez por versão). */
export const UPDATE_SEEN_KEY = 'habblaud:update-seen';

export const VERSION_ICONS = {
  up: pixelIcon(['...##...', '..####..', '.######.', '########', '..####..', '..####..', '..####..', '..####..']),
};

/** Versão em uso e o resultado da verificação, do snapshot ao vivo (no timelapse e no ?mock=1 não há versão real). */
export function versionInfo(snap: OfficeSnapshot | null | undefined): { version: string; updates?: UpdateStatus } | null {
  const v = snap?.meta.version;
  if (!v || !/^\d+\.\d+\.\d+/.test(v)) return null;
  return { version: v, updates: snap.meta.updates };
}

/** Só links do próprio GitHub viram link na página. */
export function safeGithubUrl(url: string | undefined): string | undefined {
  return url && /^https:\/\/github\.com\/[^\s"'<>]+$/.test(url) ? url : undefined;
}

export type UpdateTone = 'new' | 'ok' | 'pending' | 'warn' | 'off';

/** Linha de estado da seção "Sobre". */
export function updateStatusLine(version: string, s: UpdateStatus | undefined, now: number): { tone: UpdateTone; text: string } {
  if (!s) return { tone: 'off', text: tr('Este servidor não verifica versões novas.') };
  const checked = s.checkedAt ? ` · verificado ${relativeTime(s.checkedAt, now)}` : '';
  switch (s.state) {
    case 'off':
      return {
        tone: 'off',
        text: s.repo
          ? tr('Verificação de versão nova desligada (HABBLAUD_UPDATE_CHECK=0).')
          : tr('Verificação de versão nova desligada: o package.json não aponta um repositório no GitHub.'),
      };
    case 'pending':
      return { tone: 'pending', text: tr('Verificando se há versão nova…') };
    case 'error':
      if (s.available && s.latest) return { tone: 'new', text: tr('Nova versão disponível: v{0}. A última verificação falhou ({1}).', [s.latest, s.error ?? tr('erro')]) };
      return { tone: 'warn', text: tr('Não deu para verificar agora: {0}{1}.', [s.error ?? tr('erro desconhecido'), s.checkedAt ? tr(' · última verificação {0}', [relativeTime(s.checkedAt, now)]) : '']) };
    case 'ok':
      if (s.available && s.latest) return { tone: 'new', text: tr('Nova versão disponível: v{0}{1}.', [s.latest, s.publishedAt ? tr(', publicada em {0}', [formatDateTime(s.publishedAt)]) : '']) };
      if (!s.latest) return { tone: 'ok', text: tr('Nenhuma versão publicada no GitHub ainda{0}.', [checked]) };
      if (s.latest !== version) return { tone: 'ok', text: tr('Você está à frente da última versão publicada (v{0}){1}.', [s.latest, checked]) };
      return { tone: 'ok', text: tr('Você está na versão mais recente{0}.', [checked]) };
  }
}

/** Dica do número de versão na barra superior. */
export function versionChipTitle(version: string, s: UpdateStatus | undefined, now: number): string {
  if (s?.available && s.latest) return tr('Nova versão do Dissero: v{0} (você usa a v{1}). Clique para ver as novidades e como atualizar.', [s.latest, version]);
  return tr('Dissero v{0}. {1} Clique para ver detalhes.', [version, updateStatusLine(version, s, now).text]);
}

/** Número da versão na barra superior; vira o selo "Nova versão" quando há release mais nova. */
export class VersionChip implements UiComponent {
  readonly el: HTMLButtonElement;
  private text: HTMLElement;

  constructor(
    private ctx: UiContext,
    private settingsBtn: HTMLElement,
  ) {
    const icon = h('span', { class: 'ui-version__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = VERSION_ICONS.up;
    this.text = h('span', { class: 'ui-version__text' });
    this.el = h('button', { class: 'ui-version', type: 'button', hidden: true, on: { click: () => ctx.openAbout() } }, icon, this.text);
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    const fresh = !!info?.updates?.available && !!info.updates.latest;
    this.settingsBtn.classList.toggle('has-update', fresh);
    const label = fresh ? tr('Configurações (nova versão disponível)') : tr('Configurações');
    setAttr(this.settingsBtn, 'aria-label', label);
    setTitle(this.settingsBtn, label);
    if (!info) return;
    this.el.classList.toggle('is-new', fresh);
    setText(this.text, fresh ? tr('Nova versão') : `v${info.version}`);
    const title = versionChipTitle(info.version, info.updates, this.ctx.now());
    setTitle(this.el, title);
    setAttr(this.el, 'aria-label', title);
  }
}

/** Avisa (uma vez por versão, neste navegador) quando aparece uma versão nova. */
export class UpdateToaster implements UiComponent {
  constructor(
    private ctx: UiContext,
    private push: (n: Notice) => void,
  ) {}

  private shown: string | undefined;

  render(): void {
    if (this.ctx.store.connection !== 'open') return;
    const s = versionInfo(this.ctx.store.liveSnapshot)?.updates;
    if (!s?.available || !s.latest || this.shown === s.latest) return;
    this.shown = s.latest;
    const storage = safeLocalStorage();
    try {
      if (storage?.getItem(UPDATE_SEEN_KEY) === s.latest) return;
      storage?.setItem(UPDATE_SEEN_KEY, s.latest);
    } catch {
      // Sem armazenamento: avisa uma vez por página aberta.
    }
    this.push({ id: `update:${s.latest}`, level: 'success', text: tr('Nova versão do Dissero: v{0}. Veja as novidades e como atualizar em Configurações › Sobre.', [s.latest]), at: this.ctx.now() });
  }
}

/** Seção "Sobre" das configurações. */
export class AboutGroup {
  readonly el: HTMLElement;
  private name: HTMLElement;
  private status: HTMLElement;
  private checkBtn: HTMLButtonElement;
  private fresh: HTMLElement;
  private notes: HTMLAnchorElement;
  private repo: HTMLAnchorElement;
  private installBtn: HTMLButtonElement;
  private installStatus: HTMLElement;
  private installHint: HTMLElement;
  private installer: UpdateInstallController;
  private checking = false;
  private failure: string | undefined;
  private installNotice: string | undefined;

  constructor(private ctx: UiContext) {
    this.installer = new UpdateInstallController({
      currentVersion: () => versionInfo(ctx.store.liveSnapshot)?.version,
      onChange: () => ctx.invalidate(),
      reload: () => window.location.reload(),
    });
    this.name = h('strong', { class: 'ui-about__version' });
    this.checkBtn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Verificar agora'), on: { click: () => void this.check() } });
    this.status = h('p', { class: 'ui-about__status', role: 'status' });
    this.installBtn = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      hidden: true,
      on: { click: () => void this.installLatest() },
    });
    this.installStatus = h('p', {
      class: 'ui-about__status',
      role: 'status',
      attrs: { 'aria-live': 'polite' },
      hidden: true,
    });
    this.installHint = h(
      'p',
      { class: 'ui-set__hint', text: tr('Seus dados serão preservados. O Dissero pode reiniciar por alguns instantes; Claude e Codex não serão reiniciados.'), hidden: true },
    );
    this.notes = h('a', { class: 'ui-link-btn', attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    this.fresh = h(
      'div',
      { class: 'ui-about__new', hidden: true },
      this.notes,
      this.installBtn,
      this.installHint,
    );
    this.repo = h('a', { class: 'ui-link-btn', text: tr('Código no GitHub'), attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    this.el = h(
      'div',
      { class: 'ui-set-group ui-about', attrs: { id: 'ui-about' } },
      h('h3', { text: tr('Sobre'), tabIndex: -1 }),
      h('p', { class: 'ui-small', text: `Referência de numeração revisada: Habblaud v${UPSTREAM_REFERENCE_VERSION}. Base técnica: v${UPSTREAM_BASE_VERSION}, com backports e customizações. As atualizações são verificadas somente no DisseroHub.` }),
      h('div', { class: 'ui-about__head' }, h('span', { class: 'ui-about__name' }, 'Dissero ', this.name), this.checkBtn),
      this.status,
      this.fresh,
      this.installStatus,
      this.repo,
    );
    document.addEventListener('visibilitychange', () => this.installer.setActive(this.visible()));
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    this.installer.setActive(!!info && this.visible());
    if (!info) return;
    const s = info.updates;
    setText(this.name, `v${info.version}`);
    const line = this.failure ? { tone: 'warn' as const, text: this.failure } : updateStatusLine(info.version, s, this.ctx.now());
    setText(this.status, this.checking ? tr('Consultando o GitHub…') : line.text);
    setVariant(this.status, 'is-', this.checking ? 'pending' : line.tone);
    setHidden(this.checkBtn, !s || s.state === 'off');
    this.checkBtn.disabled = this.checking || this.ctx.store.connection !== 'open';

    const fresh = !!s?.available && !!s.latest;
    setHidden(this.fresh, !fresh);
    if (fresh) {
      setText(this.notes, tr('Ver o que mudou na v{0}', [s!.latest]));
      const url = safeGithubUrl(s!.url);
      setHidden(this.notes, !url);
      if (url) setAttr(this.notes, 'href', url);
    }
    this.renderInstaller(fresh, s?.latest);
    const repoUrl = s?.repo ? safeGithubUrl(`https://github.com/${s.repo}`) : undefined;
    setHidden(this.repo, !repoUrl);
    if (repoUrl) setAttr(this.repo, 'href', repoUrl);
  }

  /** Rola até a seção e a destaca por um instante (clique no número da versão). */
  highlight(): void {
    this.el.scrollIntoView({ block: 'nearest' });
    this.el.classList.remove('is-highlight');
    void this.el.offsetWidth;
    this.el.classList.add('is-highlight');
  }

  private async check(): Promise<void> {
    if (this.checking || this.installer.busy) return;
    this.checking = true;
    this.failure = undefined;
    this.render();
    try {
      if (!(await this.ctx.store.checkUpdates())) this.failure = tr('Não deu para falar com o servidor do Dissero.');
    } catch {
      this.failure = tr('Não deu para falar com o servidor do Dissero.');
    } finally {
      this.checking = false;
      this.render();
      this.ctx.invalidate();
    }
  }

  private visible(): boolean {
    if (!this.el.isConnected || this.el.hidden || document.visibilityState === 'hidden') return false;
    if (typeof this.el.checkVisibility === 'function') return this.el.checkVisibility();
    return this.el.getClientRects().length > 0;
  }

  private renderInstaller(fresh: boolean, latest: string | undefined): void {
    const status = this.installer.status;
    const issue = this.installer.issue;
    const supported = status?.supported;
    const terminalFailure = status?.phase === 'error' || status?.phase === 'rolled-back';
    const actionAvailable = fresh && (supported === true || (!status && !!issue));
    const actionLabel = this.installActionLabel(latest, status, issue, terminalFailure);
    setHidden(this.installBtn, !actionAvailable || !actionLabel);
    setText(this.installBtn, actionLabel ?? '');
    this.installBtn.disabled = this.installer.busy || this.checking || this.ctx.store.connection !== 'open';
    setHidden(this.installHint, !fresh || supported !== true);

    const line = this.installStatusLine(fresh, status, issue);
    setHidden(this.installStatus, !line.text || (!fresh && !this.installer.busy));
    setText(this.installStatus, line.text);
    setVariant(this.installStatus, 'is-', line.tone);
    this.checkBtn.disabled = this.checking || this.installer.busy || this.ctx.store.connection !== 'open';
  }

  private installActionLabel(
    latest: string | undefined,
    status: UpdateInstallStatus | undefined,
    issue: UpdateInstallIssue | undefined,
    terminalFailure: boolean,
  ): string | undefined {
    if (!latest) return undefined;
    if (this.installNotice) return tr('Verificar novamente');
    if (issue === 'status-unavailable' || issue === 'version-changed' || issue === 'health-timeout' || issue === 'health-check') {
      return tr('Verificar novamente');
    }
    if (status?.phase === 'done' && this.installer.target !== versionInfo(this.ctx.store.liveSnapshot)?.version) {
      return tr('Verificar novamente');
    }
    if (terminalFailure || issue === 'install-unavailable') return tr('Tentar novamente');
    if (status?.supported === true) return tr('Atualizar para v{0}', [latest]);
    if (!status && issue) return tr('Verificar novamente');
    return undefined;
  }

  private installStatusLine(
    fresh: boolean,
    status: UpdateInstallStatus | undefined,
    issue: UpdateInstallIssue | undefined,
  ): { tone: UpdateTone; text: string } {
    if (issue === 'status-unavailable') return { tone: 'warn', text: this.installer.busy ? tr('Conexão interrompida. Aguardando o servidor de atualização…') : tr('Não foi possível consultar a disponibilidade da instalação.') };
    if (issue === 'version-changed') {
      return { tone: 'warn', text: this.installer.issueMessage ?? (status?.target ? tr('O servidor já prepara v{0}. Confira a versão disponível antes de continuar.', [status.target]) : tr('A versão disponível mudou. Confira a verificação antes de tentar outra vez.')) };
    }
    if (status) {
      switch (status.phase) {
        case 'preparing': return { tone: 'pending', text: status.message ?? (status.target ? tr('Preparando a atualização para v{0}…', [status.target]) : tr('Preparando a atualização…')) };
        case 'downloading': return { tone: 'pending', text: status.message ?? (status.target ? tr('Baixando v{0}…', [status.target]) : tr('Baixando a versão…')) };
        case 'dependencies': return { tone: 'pending', text: status.message ?? (status.target ? tr('Instalando dependências de v{0}…', [status.target]) : tr('Instalando dependências…')) };
        case 'building': return { tone: 'pending', text: status.message ?? (status.target ? tr('Preparando o Dissero v{0}…', [status.target]) : tr('Preparando o Dissero…')) };
        case 'restarting': return { tone: 'pending', text: status.message ?? (status.target ? tr('Reiniciando o Dissero v{0}…', [status.target]) : tr('Reiniciando o Dissero…')) };
      }
    }
    if (this.installer.busy) return { tone: 'pending', text: tr('Iniciando a atualização…') };
    if (issue === 'install-unavailable') return { tone: 'warn', text: tr('Não foi possível iniciar a atualização. Tente novamente.') };
    if (issue === 'health-check') return { tone: 'pending', text: tr('Aguardando o Dissero reiniciar para confirmar a versão…') };
    if (issue === 'health-timeout') return { tone: 'warn', text: tr('Não foi possível confirmar a nova versão. A página continua aberta; tente verificar novamente.') };
    if (this.installNotice && fresh) return { tone: 'warn', text: this.installNotice };
    if (status?.phase === 'done' && this.installer.target !== versionInfo(this.ctx.store.liveSnapshot)?.version) {
      return { tone: 'pending', text: tr('Conferindo se v{0} está respondendo…', [this.installer.target ?? '']) };
    }
    if (status?.phase === 'done' && this.installer.target) return { tone: 'ok', text: status.message ?? tr('Atualização para v{0} concluída.', [this.installer.target]) };
    if (status?.phase === 'rolled-back') return { tone: 'warn', text: status.message ?? tr('A atualização falhou e a versão anterior foi retomada. Você pode tentar de novo.') };
    if (status?.phase === 'error') return { tone: 'warn', text: status.message ?? tr('A atualização falhou. Você pode tentar de novo.') };
    if (status?.supported === false && fresh) return { tone: 'off', text: status.reason ?? tr('A instalação pelo botão não está disponível neste ambiente.') };
    if (!status && fresh) return { tone: 'pending', text: tr('Verificando se esta instalação pode ser atualizada…') };
    return { tone: 'off', text: '' };
  }

  private async installLatest(): Promise<void> {
    if (this.installer.busy || this.checking) return;
    const latest = versionInfo(this.ctx.store.liveSnapshot)?.updates?.latest;
    if (!latest) return;
    if (this.installNotice) {
      this.installNotice = undefined;
      await this.refreshInstallerAndVersions();
      return;
    }
    const result = await this.installer.retry(latest);
    if (result === 'conflict') {
      this.installNotice = this.installer.issueMessage ?? tr('A versão disponível mudou. Confira a verificação antes de tentar outra vez.');
      this.ctx.invalidate();
      await this.refreshInstallerAndVersions();
    } else {
      this.installNotice = undefined;
    }
    this.render();
    this.ctx.invalidate();
  }

  private async refreshInstallerAndVersions(): Promise<void> {
    this.checking = true;
    this.render();
    this.ctx.invalidate();
    try {
      if (!(await this.ctx.store.checkUpdates())) this.installNotice = tr('Não foi possível atualizar a verificação de versões.');
    } catch {
      this.installNotice = tr('Não foi possível atualizar a verificação de versões.');
    }
    try {
      await this.installer.refresh();
    } finally {
      this.checking = false;
      this.render();
      this.ctx.invalidate();
    }
  }
}
