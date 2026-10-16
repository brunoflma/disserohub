// Layout de uma sala de projeto (16x12 tiles com paredes próprias).
//
//   linhas 0–1  face da parede norte (salas ao sul: com a passagem da porta)
//   linhas 2–10 piso (interior 14x9: colunas 1–14)
//   linha 11    parede sul (salas ao norte: com a porta para o corredor)
//
// Cada sala tem 6 lugares de trabalho, um canto de reunião, quadro kanban, placa com o nome e
// decoração. A semente escolhe um plano estrutural (ilha central, colaboração deslocada, galeria
// alta ou plano aberto para overflow), além do espelhamento, do canto de reunião e dos apoios. As
// variações são puras: salas vazias, salas lotadas e salas fantasma usam o mesmo contrato.
import { FURNITURE, type Dir, type FurnitureKind, type RoomTheme, type WallStyle } from '../../art/api';
import { mulberry32 } from '../../../../shared/hash';
import { DOOR_W, DOOR_X, TILE } from '../constants';
import { AreaBuilder, type SpotOpts } from './builder';
import { slotRect, slotSide } from './geometry';
import type { AreaLayout, SpotDef, SpotKind } from './types';

export interface RoomInput {
  id: string;
  slot: number;
  seed: number;
}

const PLANTS_TALL = ['palm', 'ficus', 'monstera', 'bonsai'] as const;
const PLANTS_SMALL = ['fern', 'succulent', 'flower'] as const;
const POSTERS = ['law_justice', 'law_charter', 'law_columns'] as const;

/** Canto de reunião (assentos extras para subagentes). */
export type MeetingStyle = 'table' | 'round' | 'lounge';
/** Canto da parte de baixo da sala (linhas 9–10). */
export type CornerStyle = 'rest' | 'print' | 'green' | 'standdesk' | 'stands';
/** Plano dos móveis grandes; cada opção muda a silhueta da sala, não só a decoração. */
export type RoomPlan = 'island' | 'collaboration' | 'gallery' | 'overflow';

/** Variações sorteadas pela semente (exportado para testes). */
export interface RoomVariant {
  plan: RoomPlan;
  mirror: boolean;
  meeting: MeetingStyle;
  left: CornerStyle;
  right: CornerStyle;
}

/** Variação de uma cor hex (clareia/escurece) — usado para tapetes e detalhes. */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount > 0 ? (255 - v) * amount : v * amount))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Sorteio das variações da sala (determinístico pela semente). */
export function roomVariant(seed: number): RoomVariant {
  const rng = mulberry32((seed ^ 0x7a11) >>> 0);
  const plans: RoomPlan[] = ['island', 'collaboration', 'gallery', 'overflow'];
  const plan = plans[Math.floor(rng() * plans.length) % plans.length];
  const mirror = rng() < 0.5;
  const m = rng();
  const meeting: MeetingStyle = m < 0.45 ? 'table' : m < 0.78 ? 'round' : 'lounge';
  const lefts: CornerStyle[] = ['rest', 'print', 'green'];
  const rights: CornerStyle[] = ['standdesk', 'stands', 'green'];
  const left = lefts[Math.floor(rng() * lefts.length) % lefts.length];
  let right = rights[Math.floor(rng() * rights.length) % rights.length];
  if (right === left) right = 'stands';
  return { plan, mirror, meeting, left, right };
}

/** Cor/padrão da parede que acompanha cada plano, sem depender de novos sprites. */
function roomWall(theme: RoomTheme, plan: RoomPlan): WallStyle {
  switch (plan) {
    case 'collaboration':
      return { ...theme.wall, base: shade(theme.wall.base, -0.035), trim: shade(theme.accent, 0.02), pattern: 'plain' };
    case 'gallery':
      return { ...theme.wall, base: shade(theme.wall.base, 0.05), trim: shade(theme.accent, -0.08), pattern: 'stripes' };
    case 'overflow':
      return { ...theme.wall, base: shade(theme.wall.base, 0.015), trim: shade(theme.accent, -0.16), pattern: 'brick' };
    case 'island':
      return { ...theme.wall, trim: theme.wall.trim ?? shade(theme.accent, -0.12) };
  }
}

interface DeskPair {
  x: number;
  backY: number;
  frontY: number;
}

/** Coordenadas locais dos três pares; mantêm os seis lugares, mas mudam a leitura da sala. */
function deskPairs(plan: RoomPlan): readonly DeskPair[] {
  switch (plan) {
    case 'collaboration':
      return [
        { x: 5, backY: 5, frontY: 6 },
        { x: 7, backY: 5, frontY: 6 },
        { x: 10, backY: 5, frontY: 6 },
      ];
    case 'gallery':
      return [
        { x: 2, backY: 4, frontY: 5 },
        { x: 4, backY: 4, frontY: 5 },
        { x: 6, backY: 4, frontY: 5 },
      ];
    case 'overflow':
      return [
        { x: 2, backY: 3, frontY: 4 },
        { x: 4, backY: 3, frontY: 4 },
        { x: 6, backY: 6, frontY: 7 },
      ];
    case 'island':
      return [
        { x: 2, backY: 5, frontY: 6 },
        { x: 4, backY: 5, frontY: 6 },
        { x: 6, backY: 5, frontY: 6 },
      ];
  }
}

export function layoutProjectRoom(room: RoomInput, theme: RoomTheme): AreaLayout {
  const rect = slotRect(room.slot);
  const side = slotSide(room.slot);
  const rng = mulberry32(room.seed ^ 0x5eed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
  const v = roomVariant(room.seed);
  const b = new AreaBuilder(room.id, 'room', rect);
  const area = b.area;
  area.side = side;
  const wall: WallStyle = roomWall(theme, v.plan);
  const north = side === 'north';
  const door = { lx: DOOR_X, w: DOOR_W };

  // ---- espelhamento (coordenadas locais pensadas sem depender do lado do corredor)
  const mir = v.mirror;
  const fx = (lx: number, w = 1) => (mir ? 16 - lx - w : lx);
  const fdir = (d: Dir): Dir => (mir && (d === 'left' || d === 'right') ? (d === 'left' ? 'right' : 'left') : d);
  const fdx = (dx: number | undefined) => (dx === undefined ? undefined : mir ? -dx : dx);
  const furn = (kind: FurnitureKind, lx: number, ly: number, variant?: string, o: { dx?: number; dy?: number; order?: number; seat?: string } = {}) =>
    b.furn(kind, fx(lx, FURNITURE[kind].footprint.w), ly, variant ?? (kind === 'bookshelf' || kind === 'meeting_table' ? 'legal' : undefined), { ...o, dx: fdx(o.dx) });
  const spot = (kind: SpotKind, lx: number, ly: number, dir: Dir, o: SpotOpts = {}): SpotDef => b.spot(kind, fx(lx), ly, fdir(dir), { ...o, dx: fdx(o.dx) });
  /** Assento; `dirVariant` = a variante do móvel é a própria direção (poltrona, cadeira de café). */
  const seat = (kind: SpotKind, fk: FurnitureKind, lx: number, ly: number, dir: Dir, variant?: string, o: SpotOpts & { order?: number } = {}, dirVariant = false): SpotDef =>
    b.seat(kind, fk, fx(lx), ly, fdir(dir), dirVariant ? fdir(dir) : variant, { ...o, dx: fdx(o.dx) });
  const wallItem = (kind: FurnitureKind, cx: number, variant?: string, o: { ly?: number; on?: 'face' | 'south'; order?: number } = {}) => b.wall(kind, mir ? 16 - cx : cx, variant, o);
  const rug = (lx: number, ly: number, w: number, h: number, color: string, seed: number) => b.rug(fx(lx, w), ly, w, h, color, seed);

  // ---- piso: porcelanato claro (o banheiro é que usa azulejo); leve tom do tema dá identidade
  b.floor('marble', 0, 0, 16, 12, room.seed);
  area.floorTint = theme.carpet;
  // A composição dos tapetes acompanha o plano: eles reforçam a silhueta dos móveis grandes.
  switch (v.plan) {
    case 'collaboration':
      rug(4, 3.25, 9, 5.5, theme.carpet, room.seed);
      rug(1, 8.6, 3.5, 1.25, shade(theme.carpet2, 0.08), room.seed + 3);
      break;
    case 'gallery':
      rug(1.5, 3.25, 7, 4.5, theme.carpet, room.seed);
      rug(9.5, 8.55, 4, 1.35, shade(theme.carpet2, 0.12), room.seed + 3);
      break;
    case 'overflow':
      rug(1.25, 2.25, 7.5, 7.1, theme.carpet, room.seed);
      break;
    case 'island':
      rug(1.5, 3.25, 7, 5.5, theme.carpet, room.seed);
      break;
  }
  // tapetinho na entrada
  rug(DOOR_X - 0.25, north ? 9.5 : 2, DOOR_W + 0.5, 1.25, shade(theme.carpet2, -0.1), room.seed + 1);

  // ---- paredes
  if (north) {
    b.face(0.5, 15, wall);
    b.south(0.5, 15, 11, wall, [door]);
  } else {
    b.face(0.5, 15, wall, [door]);
    b.south(0.5, 15, 11, { ...wall, exterior: true });
    // batente na passagem da porta (a face da parede norte mostra o vão)
    b.wall('door_frame', DOOR_X + DOOR_W / 2, undefined, { order: 0.05 });
  }
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);

  // ---- caminhabilidade
  b.walk(1, 2, 14, 9);
  area.door = north ? { x: rect.x + DOOR_X, y: rect.y + 11, w: DOOR_W, h: 1 } : { x: rect.x + DOOR_X, y: rect.y, w: DOOR_W, h: 2 };
  b.walk(area.door.x - rect.x, area.door.y - rect.y, area.door.w, area.door.h);

  // ---- itens de parede
  const signCx = north ? 8 : 10.5;
  area.signId = wallItem('sign', signCx, undefined, { order: 0.95 });
  if (north) {
    wallItem('whiteboard', 4.5, undefined, { order: 0.6 });
    wallItem('clock', 10, undefined, { order: 0.7 });
    wallItem('poster', 11.1, pick(POSTERS), { order: 0.5 });
    wallItem('window', 12.75, undefined, { order: 0.4 });
    // interruptor ao lado da porta, na mureta (por dentro)
    wallItem('light_switch', DOOR_X - 0.5, 'on', { ly: 12, on: 'south', order: 0.8 });
    spot('switch', DOOR_X - 1, 10, 'down', { dy: -1 });
  } else {
    wallItem('whiteboard', 2.5, undefined, { order: 0.6 });
    wallItem('light_switch', DOOR_X - 0.5, 'on', { order: 0.8 });
    wallItem('clock', 12.3, undefined, { order: 0.7 });
    wallItem('poster', 13.35, pick(POSTERS), { order: 0.5 });
    spot('switch', DOOR_X - 1, 2, 'up', { dy: -3 });
  }
  spot('whiteboard', north ? 4 : 2, 2, 'up', { dx: 8, dy: 2 });

  // ---- seis lugares de trabalho: o plano muda as posições sem quebrar os links mesa-assento
  const deskV = theme.deskVariant;
  const chairV = theme.chairVariant;
  const ranks = [2, 0, 4];
  for (const [i, pair] of deskPairs(v.plan).entries()) {
    const back = furn('desk_back', pair.x, pair.backY, deskV, { order: 0.35 + i * 0.05, seat: `N${i}` });
    const front = furn('desk', pair.x, pair.frontY, deskV, { order: 0.4 + i * 0.05, seat: `S${i}` });
    seat('desk', 'office_chair_front', pair.x, pair.backY - 1, 'down', chairV, { dx: TILE / 2, deskId: back, rank: ranks[i] + 1, side: 'N', order: 0.55 + i * 0.03 });
    seat('desk', 'office_chair', pair.x, pair.frontY + 1, 'up', chairV, { dx: TILE / 2, deskId: front, rank: ranks[i], side: 'S', order: 0.6 + i * 0.03 });
  }
  furn('trash_bin', 9, 6, undefined, { order: 0.7 });

  // ---- canto de reunião (assentos extras para subagentes: banquetas ou poltronas)
  const meetingX = v.plan === 'collaboration' ? 1 : 10;
  const leftMeeting = meetingX < 5;
  if (v.meeting === 'table') {
    furn('meeting_table', meetingX, 5, undefined, { order: 0.45 });
    seat('stool', 'stool', meetingX, 4, 'down', undefined, { order: 0.65 });
    seat('stool', 'stool', meetingX + 2, 4, 'down', undefined, { order: 0.66 });
    seat('stool', 'stool', meetingX, 7, 'up', undefined, { order: 0.67 });
    seat('stool', 'stool', meetingX + 2, 7, 'up', undefined, { order: 0.68 });
  } else if (v.meeting === 'round') {
    // duas mesinhas redondas com duas banquetas cada (em diagonal, para circular entre elas)
    furn('cafe_table', meetingX + 1, 4, undefined, { order: 0.45 });
    seat('stool', 'stool', meetingX, 4, 'right', undefined, { order: 0.65 });
    seat('stool', 'stool', meetingX + 2, 4, 'left', undefined, { order: 0.66 });
    furn('cafe_table', meetingX + 1, 7, undefined, { order: 0.46 });
    seat('stool', 'stool', meetingX, 7, 'right', undefined, { order: 0.67 });
    seat('stool', 'stool', meetingX + 2, 7, 'left', undefined, { order: 0.68 });
  } else {
    // recanto com poltronas e puffs em volta de uma mesa de centro (sem mesa de reunião)
    rug(Math.max(1, meetingX - 0.4), 3.7, 4.8, 4.6, shade(theme.carpet2, 0.25), room.seed + 2);
    if (leftMeeting) {
      furn('coffee_table', meetingX + 1, 5, undefined, { order: 0.45 });
      seat('nook', 'armchair', meetingX, 5, 'right', undefined, { order: 0.65 }, true);
      seat('nook', 'armchair', meetingX + 3, 5, 'left', undefined, { order: 0.66 }, true);
      seat('nook', 'armchair', meetingX + 1, 7, 'up', undefined, { order: 0.67 }, true);
      seat('nook', 'armchair', meetingX + 2, 7, 'up', undefined, { order: 0.68 }, true);
      seat('nook', 'armchair', meetingX + 1, 3, 'down', undefined, { order: 0.69 }, true);
    } else {
      furn('coffee_table', meetingX, 5, undefined, { order: 0.45 });
      seat('nook', 'armchair', meetingX - 1, 5, 'right', undefined, { order: 0.65 }, true);
      seat('nook', 'armchair', meetingX + 2, 5, 'left', undefined, { order: 0.66 }, true);
      seat('nook', 'armchair', meetingX, 7, 'up', undefined, { order: 0.67 }, true);
      seat('nook', 'armchair', meetingX + 1, 7, 'up', undefined, { order: 0.68 }, true);
      seat('nook', 'armchair', meetingX + 1, 3, 'down', undefined, { order: 0.69 }, true);
    }
  }

  // ---- apoio: estante junto à parede norte (sem cobrir quadro, placa ou janela) e coluna junto à parede
  const tall = pick(PLANTS_TALL);
  // Nos planos altos, a estante fica recuada para não projetar o sprite sobre a entrada.
  // As posições preservam a aproximação da porta nos dois espelhos.
  const highShelf = v.plan === 'gallery' || v.plan === 'overflow';
  const shelfX = highShelf ? 8 : north ? 1 : 4;
  const shelfY = highShelf ? 4 : 2;
  furn('bookshelf', shelfX, shelfY, undefined, { order: 0.25 });
  spot('shelf', shelfX, shelfY + 1, 'up', { dx: 8, dy: -2 });
  furn('plant_tall', 14, 2, tall, { order: 0.2 });
  if (north) spot('window', 12, 2, 'up', { dx: 12, dy: 1 });
  else furn('plant_small', 1, 2, pick(PLANTS_SMALL), { order: 0.22 });
  const column = Math.floor(rng() * 3);
  if (column === 0) {
    furn('binder_shelf', 14, 4, undefined, { order: 0.3 });
    furn('printer', 14, 6, undefined, { order: 0.32 });
    furn('floor_lamp', 14, 8, undefined, { order: 0.34 });
  } else if (column === 1) {
    furn('binder_shelf', 14, 4, undefined, { order: 0.3 });
    furn('binder_shelf', 14, 5, undefined, { order: 0.31 });
    furn('floor_lamp', 14, 8, undefined, { order: 0.34 });
  } else {
    furn('floor_lamp', 14, 4, undefined, { order: 0.3 });
    furn('filing_cabinet', 14, 6, undefined, { order: 0.32 });
    furn('floor_lamp', 14, 8, undefined, { order: 0.34 });
  }

  // ---- cantos da parte de baixo (linhas 9–10; a passagem da porta, colunas 6–9, fica livre)
  corner(v.left, 'left');
  corner(v.right, 'right');

  function corner(style: CornerStyle, where: 'left' | 'right'): void {
    // a zona da esquerda ocupa as colunas 1–5; a da direita, 10–14
    const x0 = where === 'left' ? 1 : 10;
    const o = 0.2 + (where === 'left' ? 0 : 0.05);
    switch (style) {
      case 'rest': {
        // canto de descanso: tapete, dois puffs (também servem de lugar extra) e plantas
        rug(x0 + 0.5, 8.85, 4, 2, shade(theme.carpet, 0.35), room.seed + 3);
        seat('nook', 'armchair', x0 + 1, 10, 'up', undefined, { order: o + 0.4 }, true);
        seat('nook', 'armchair', x0 + 3, 10, 'up', undefined, { order: o + 0.41 }, true);
        furn('plant_small', where === 'left' ? 1 : 14, 9, pick(PLANTS_SMALL), { order: o });
        furn('plant_tall', where === 'left' ? x0 : x0 + 4, 10, pick(PLANTS_TALL), { order: o + 0.01 });
        return;
      }
      case 'print': {
        // estação de impressão com estante de pastas e arquivo
        furn('printer', x0, 10, undefined, { order: o });
        furn('binder_shelf', x0 + 1, 10, undefined, { order: o + 0.01 });
        furn('binder_shelf', x0 + 2, 10, undefined, { order: o + 0.02 });
        furn('filing_cabinet', x0 + 3, 10, undefined, { order: o + 0.03 });
        furn('trash_bin', x0 + 4, 10, undefined, { order: o + 0.04 });
        return;
      }
      case 'green': {
        // cantinho verde com luminária e uma poltrona de leitura
        const plantX = where === 'left' ? 1 : 14;
        furn('plant_tall', plantX, 10, pick(PLANTS_TALL), { order: o });
        furn('floor_lamp', x0 + 1, 10, undefined, { order: o + 0.01 });
        seat('nook', 'armchair', x0 + 2, 10, 'up', undefined, { order: o + 0.4 }, true);
        furn('plant_small', plantX, 9, pick(PLANTS_SMALL), { order: o + 0.02 });
        return;
      }
      case 'standdesk': {
        // mesa de pé com notebook (lugar de trabalho em pé, de frente para a câmera)
        furn('cafe_table', x0 + 2, 10, undefined, { order: o });
        spot('stand', x0 + 2, 9, 'down', { dy: -1 });
        furn('plant_small', where === 'left' ? 1 : 14, 9, pick(PLANTS_SMALL), { order: o + 0.01 });
        furn('trash_bin', x0, 10, undefined, { order: o + 0.02 });
        return;
      }
      case 'stands': {
        // pontos em pé junto ao quadro móvel/estante baixa
        furn('filing_cabinet', x0 + 4, 10, undefined, { order: o });
        furn('plant_small', where === 'left' ? 1 : 14, 9, pick(PLANTS_SMALL), { order: o + 0.01 });
        spot('stand', x0 + 1, 9, 'up', { dy: -2 });
        spot('stand', x0 + 2, 9, 'up', { dy: -2 });
        return;
      }
    }
  }

  // pontos em pé (subagentes sem lugar sentado trabalham aqui; também servem de conversa)
  spot('stand', v.plan === 'gallery' || v.plan === 'overflow' ? 10 : 9, 3, 'left');
  spot('stand', v.plan === 'collaboration' ? 4 : 1, 7, 'right');
  spot('stand', 13, 9, 'up', { dy: -2 });

  // ---- sombreamento quando a luz está apagada (salas ao norte: a mureta sul fica clara)
  const p = { x: rect.x * TILE, y: rect.y * TILE, w: rect.w * TILE, h: rect.h * TILE };
  area.shade = north ? { x: p.x, y: p.y, w: p.w, h: p.h - TILE } : { x: p.x, y: p.y, w: p.w, h: p.h };
  return b.build();
}
