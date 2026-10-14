import { tr } from '../../../shared/i18n';
import type { ProjectFolderView } from '../../../shared/projects';
import type { UiContext } from './context';
import { h, iconButton, setText } from './dom';
import { ICONS } from './icons';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || tr('Não foi possível acessar a pasta.'));
  return body as T;
}

/** Escolha de pastas do computador, sem carregar ou enviar seus arquivos. */
export class ProjectDialog {
  readonly el: HTMLDialogElement;
  private path: HTMLInputElement;
  private folders: HTMLElement;
  private message: HTMLElement;
  private recent: HTMLElement;
  private roots: HTMLElement;
  private up: HTMLButtonElement;
  private openPath: HTMLButtonElement;
  private add: HTMLButtonElement;
  private cancel: HTMLButtonElement;
  private closeButton: HTMLButtonElement;
  private opener: HTMLElement | null = null;
  private current: ProjectFolderView | null = null;
  private loading = false;
  private saving = false;
  private epoch = 0;
  private folderButtons: HTMLButtonElement[] = [];
  private recentButtons: HTMLButtonElement[] = [];
  private rootButtons: HTMLButtonElement[] = [];

  constructor(private ctx: UiContext, private onAdded: () => void) {
    this.path = h('input', { class: 'ui-project__path', type: 'text', attrs: { id: 'ui-project-path', spellcheck: 'false', autocomplete: 'off', 'aria-label': tr('Caminho da pasta do projeto') } });
    this.path.addEventListener('input', () => {
      this.epoch++;
      this.loading = false;
      this.current = null;
      this.updateControls();
    });
    this.path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.load(this.path.value);
      }
    });
    this.openPath = h('button', { class: 'ui-btn', type: 'button', text: tr('Abrir pasta'), on: { click: () => void this.load(this.path.value) } });
    this.up = h('button', { class: 'ui-btn', type: 'button', text: tr('Nível acima'), on: { click: () => this.current?.parent && void this.load(this.current.parent) } });
    this.recent = h('div', { class: 'ui-project__recent', role: 'group', attrs: { 'aria-label': tr('Atalhos de pastas') } });
    this.roots = h('div', { class: 'ui-project__recent', role: 'group', attrs: { 'aria-label': tr('Unidades disponíveis') }, hidden: true });
    this.folders = h('div', { class: 'ui-project__folders', role: 'group', attrs: { 'aria-label': tr('Pastas disponíveis') } });
    this.message = h('p', { class: 'ui-project__message', role: 'status', attrs: { 'aria-live': 'polite' } });
    this.add = h('button', { class: 'ui-btn ui-perm__btn--allow', type: 'button', text: tr('Adicionar esta pasta'), on: { click: () => void this.submit() } });
    this.cancel = h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => this.close() } });
    this.closeButton = iconButton(ICONS.close, tr('Fechar escolha de projeto'), () => this.close());
    this.el = h('dialog', { class: 'ui-dialog ui-project', attrs: { 'aria-labelledby': 'ui-project-title', 'aria-describedby': 'ui-project-description' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Adicionar projeto'), attrs: { id: 'ui-project-title' } }), this.closeButton),
      h('div', { class: 'ui-project__body' },
        h('p', { text: tr('Escolha a pasta que será exibida como uma sala do escritório.'), attrs: { id: 'ui-project-description' } }),
        this.recent, this.roots,
        h('label', { text: tr('Caminho da pasta'), attrs: { for: 'ui-project-path' } }),
        h('div', { class: 'ui-project__path-row' }, this.path, this.openPath),
        this.up, this.message, this.folders),
      h('div', { class: 'ui-project__footer' }, this.cancel, this.add));
    this.el.addEventListener('cancel', (event) => { if (this.saving) event.preventDefault(); });
    this.el.addEventListener('close', () => { this.epoch++; this.opener?.focus(); });
    this.updateControls();
  }

  get isOpen(): boolean { return this.el.open; }

  open(opener?: HTMLElement): void {
    if (this.el.open) return;
    this.opener = opener ?? null;
    this.recentButtons = [h('button', { class: 'ui-btn', type: 'button', text: tr('Pasta pessoal'), on: { click: () => void this.load() } })];
    this.recent.replaceChildren(...this.recentButtons);
    const seen = new Set<string>();
    for (const room of this.ctx.store.snapshot?.rooms ?? []) {
      if (room.id.startsWith('demo:') || seen.has(room.path)) continue;
      seen.add(room.path);
      const button = h('button', { class: 'ui-btn', type: 'button', text: room.name, title: room.path, on: { click: () => void this.load(room.path) } });
      this.recentButtons.push(button);
      this.recent.append(button);
      if (seen.size >= 8) break;
    }
    this.el.showModal();
    void this.load(this.current?.path);
    this.path.focus();
  }

  private close(): void { if (!this.saving) this.el.close(); }

  private updateControls(): void {
    this.add.disabled = this.loading || this.saving || !this.current;
    this.up.disabled = this.loading || this.saving || !this.current?.parent;
    this.openPath.disabled = this.saving;
    this.path.disabled = this.saving;
    this.closeButton.disabled = this.saving;
    this.cancel.disabled = this.saving;
    for (const button of this.folderButtons) button.disabled = this.loading || this.saving;
    for (const button of this.recentButtons) button.disabled = this.saving;
    for (const button of this.rootButtons) button.disabled = this.saving;
    this.el?.setAttribute('aria-busy', String(this.loading || this.saving));
  }

  private async load(path?: string): Promise<void> {
    if (this.saving) return;
    const epoch = ++this.epoch;
    this.loading = true;
    this.current = null;
    this.message.classList.remove('is-error');
    setText(this.message, tr('Carregando pastas…'));
    this.updateControls();
    try {
      const view = await request<ProjectFolderView>(`/api/projects/folders${path !== undefined ? `?path=${encodeURIComponent(path)}` : ''}`);
      if (epoch !== this.epoch || !this.el.open) return;
      this.current = view;
      this.path.value = view.path;
      this.rootButtons = (view.roots ?? []).map((root) => h('button', {
        class: 'ui-btn', type: 'button', text: tr('Unidade {0}', [root.name]), title: root.path,
        attrs: { 'aria-pressed': String(view.path.toLowerCase().startsWith(root.path.toLowerCase())) },
        on: { click: () => void this.load(root.path) },
      }));
      this.roots.replaceChildren(...this.rootButtons);
      this.roots.hidden = !this.rootButtons.length;
      this.folders.replaceChildren();
      this.folderButtons = [];
      for (const folder of view.folders) {
        const icon = h('span', { class: 'ui-project__folder-icon', attrs: { 'aria-hidden': 'true' } });
        icon.innerHTML = ICONS.folder;
        const button = h('button', { class: 'ui-project__folder', type: 'button', attrs: { 'aria-label': tr('Abrir pasta {0}', [folder.name]) }, on: { click: () => void this.load(folder.path) } }, icon, h('span', { text: folder.name }));
        this.folderButtons.push(button);
        this.folders.append(button);
      }
      setText(this.message, view.truncated ? tr('Há mais pastas neste local. Você também pode digitar o caminho acima.') : view.folders.length ? tr('Abra uma pasta abaixo ou adicione a pasta indicada acima.') : tr('Esta pasta não contém outras pastas. Você pode adicioná-la como projeto.'));
    } catch (error) {
      if (epoch !== this.epoch || !this.el.open) return;
      this.folders.replaceChildren();
      this.folderButtons = [];
      this.message.classList.add('is-error');
      setText(this.message, error instanceof Error ? error.message : tr('Não foi possível abrir a pasta.'));
    } finally {
      if (epoch === this.epoch) { this.loading = false; this.updateControls(); }
    }
  }

  private async submit(): Promise<void> {
    if (!this.current || this.loading || this.saving) return;
    this.saving = true;
    this.message.classList.remove('is-error');
    setText(this.message, tr('Adicionando projeto…'));
    this.updateControls();
    try {
      await request<{ roomId: string }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: this.current.path }) });
      this.onAdded();
      this.ctx.announce(tr('Projeto adicionado ao escritório.'));
      this.saving = false;
      this.el.close();
    } catch (error) {
      this.message.classList.add('is-error');
      setText(this.message, error instanceof Error ? error.message : tr('Não foi possível adicionar o projeto.'));
    } finally { this.saving = false; this.updateControls(); }
  }
}
