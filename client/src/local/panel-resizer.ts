import { h, setAttr } from '../ui/dom';
import type { PanelDimensions } from './workspace-layout';

export function panelResizer(panel: HTMLElement, key: keyof PanelDimensions, read: () => number, change: (value: number | null, save: boolean) => void) {
  const vertical = key !== 'feedHeight';
  const direction = key === 'sidebarWidth' ? 1 : -1;
  const limits = key === 'sidebarWidth' ? [240, 420] : key === 'drawerWidth' ? [300, 520] : [120, 360];
  const label = key === 'sidebarWidth' ? 'Largura da lista de agentes' : key === 'drawerWidth' ? 'Largura dos detalhes' : 'Altura do feed';
  const handle = h('div', { class: `ui-resizer ui-resizer--${key}`, role: 'separator', tabIndex: 0, attrs: { 'aria-label': label, 'aria-orientation': vertical ? 'vertical' : 'horizontal', 'aria-valuemin': String(limits[0]), 'aria-valuemax': String(limits[1]) } });
  const clamp = (v: number) => Math.round(Math.max(limits[0], Math.min(limits[1], v)));
  handle.addEventListener('click', () => handle.focus({ preventScroll: true }));
  let drag: { id: number; start: number; value: number; current: number } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    handle.focus({ preventScroll: true });
    e.preventDefault();
    e.stopPropagation();
    const value = read();
    drag = { id: e.pointerId, start: vertical ? e.clientX : e.clientY, value, current: value };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.current = clamp(drag.value + ((vertical ? e.clientX : e.clientY) - drag.start) * direction);
    change(drag.current, false);
    setAttr(handle, 'aria-valuenow', String(drag.current));
  });
  const finish = (e: PointerEvent, save: boolean) => {
    if (!drag || e.pointerId !== drag.id) return;
    const value = drag.current;
    drag = null;
    handle.classList.remove('is-dragging');
    change(save ? value : null, save);
  };
  handle.addEventListener('pointerup', (e) => finish(e, true));
  handle.addEventListener('pointercancel', (e) => finish(e, false));
  handle.addEventListener('keydown', (e) => {
    const positive = vertical ? e.key === 'ArrowRight' : e.key === 'ArrowDown';
    const negative = vertical ? e.key === 'ArrowLeft' : e.key === 'ArrowUp';
    if (!positive && !negative && e.key !== 'Home') return;
    e.preventDefault();
    e.stopPropagation();
    const value = e.key === 'Home' ? (key === 'sidebarWidth' ? 304 : key === 'drawerWidth' ? 380 : 200) : clamp(read() + (positive ? 1 : -1) * direction * (e.shiftKey ? 40 : 16));
    change(value, true);
    setAttr(handle, 'aria-valuenow', String(value));
  });
  panel.append(handle);
  return () => setAttr(handle, 'aria-valuenow', String(read()));
}
