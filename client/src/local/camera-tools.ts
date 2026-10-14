import type { RoomInfo } from '../../../shared/types';
import type { UiComponent, UiContext } from '../ui/context';
import { h, KeyedList, setAttr, setText } from '../ui/dom';
import { tr } from '../../../shared/i18n';

/** Browse offices without changing simulation coordinates or routes. */
export class CameraTools implements UiComponent {
  readonly el: HTMLElement;
  private picker: HTMLSelectElement;
  private options: KeyedList<RoomInfo, HTMLOptionElement>;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private follow: HTMLButtonElement;
  private position: HTMLElement;
  private rooms: RoomInfo[] = [];
  private lastRoom = '';
  private lastName = '';
  private lastFont = '';

  constructor(private ctx: UiContext) {
    const preset = (text: string, action: 'overview' | 'offices' | 'follow' | 'reset', title: string) => h('button', { class: 'ui-camera-preset', type: 'button', text: tr(text), title: tr(title), on: { click: () => ctx.camera(action) } });
    this.follow = preset('Seguir', 'follow', 'Seguir o agente selecionado (F)');
    this.picker = h('select', { class: 'ui-camera-picker', attrs: { 'aria-label': tr('Ir para sala') } });
    this.options = new KeyedList<RoomInfo, HTMLOptionElement>(this.picker, { animate: false, key: (room) => room.id, create: () => h('option'), update: (option, room) => { option.value = room.id; setText(option, room.name); } });
    this.picker.addEventListener('change', () => this.choose(this.picker.value));
    this.prev = h('button', { class: 'ui-camera-preset', type: 'button', text: '‹', attrs: { 'aria-label': tr('Sala anterior') }, on: { click: () => this.step(-1) } });
    this.next = h('button', { class: 'ui-camera-preset', type: 'button', text: '›', attrs: { 'aria-label': tr('Próxima sala') }, on: { click: () => this.step(1) } });
    this.position = h('span', { class: 'ui-camera-position' });
    this.el = h('div', { class: 'ui-camera-tools', role: 'group', attrs: { 'aria-label': tr('Enquadramento do escritório') } },
      h('div', { class: 'ui-camera-presets' }, preset('Escritório', 'overview', 'Enquadrar todo o escritório (O)'), preset('Salas', 'offices', 'Priorizar as salas com móveis legíveis'), this.follow, preset('Padrão', 'reset', 'Restaurar o enquadramento inicial')),
      h('div', { class: 'ui-camera-pages' }, this.prev, this.picker, this.position, this.next));
  }

  private choose(id: string) {
    if (!this.rooms.some((room) => room.id === id)) return;
    this.lastRoom = id;
    this.ctx.select({ type: 'room', id }, { focus: true });
  }
  private step(delta: number) {
    if (!this.rooms.length) return;
    const i = Math.max(0, this.rooms.findIndex((room) => room.id === this.picker.value));
    this.choose(this.rooms[(i + delta + this.rooms.length) % this.rooms.length].id);
  }
  render() {
    this.rooms = [...(this.ctx.store.snapshot?.rooms ?? [])].filter((room) => (this.ctx.store.snapshot?.agents ?? []).some((agent) => agent.roomId === room.id));
    this.options.sync(this.rooms);
    const sel = this.ctx.selection();
    const id = sel?.type === 'room' ? sel.id : sel?.type === 'agent' ? this.ctx.agent(sel.id)?.roomId : this.lastRoom;
    const selected = this.rooms.some((room) => room.id === id) ? id! : this.rooms[0]?.id;
    if (selected) this.picker.value = selected;
    const name = this.rooms.find((room) => room.id === selected)?.name ?? '';
    const style = getComputedStyle(this.picker);
    // `style.font` can be empty when tabular numeric variants are enabled.
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if (name !== this.lastName || font !== this.lastFont) {
      this.lastName = name;
      this.lastFont = font;
      const measure = document.createElement('canvas').getContext('2d');
      if (measure) measure.font = font;
      this.el.style.setProperty('--camera-name-width', `${Math.max(180, Math.ceil((measure?.measureText(name).width ?? name.length * 8) + 44))}px`);
      this.picker.title = name;
    }
    this.picker.disabled = !this.rooms.length;
    this.prev.disabled = this.next.disabled = this.rooms.length < 2;
    this.follow.disabled = sel?.type !== 'agent';
    setAttr(this.follow, 'aria-pressed', String(this.ctx.world.getOptions().followSelected));
    setText(this.position, this.rooms.length ? `${this.rooms.findIndex((room) => room.id === selected) + 1}/${this.rooms.length}` : '0/0');
  }
}
