import { describe, expect, it } from 'vitest';
import { FURNITURE, TILE, type FurnitureKind, type Rect, type RoomTheme } from '../../art/api';
import { renderFurniture } from '../../art/furniture';
import { BUILDING_H, COL_W, CORRIDOR_Y, SOUTH_Y } from '../constants';
import { assembleBuilding, coreAreas } from './building';
import { columnsFor, slotAt, slotColumn, slotRect, slotSide } from './geometry';
import { layoutProjectRoom, roomVariant } from './room';
import { layoutExterior, slotShell } from './exterior';
import { interiorSlotShell } from './interior';
import { layoutLounge, RECEPTION_ID } from './core';
import type { AreaLayout } from './types';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

function roomsFor(slots: number[]): AreaLayout[] {
  return slots.map((slot) => layoutProjectRoom({ id: `/proj/${slot}`, slot, seed: 1000 + slot * 77 }, theme));
}

describe('mapeamento de slots', () => {
  it('coluna = núcleo + floor(slot/2); par = norte, ímpar = sul', () => {
    expect(slotColumn(0)).toBe(2);
    expect(slotColumn(1)).toBe(2);
    expect(slotColumn(2)).toBe(3);
    expect(slotColumn(7)).toBe(5);
    expect(slotSide(0)).toBe('north');
    expect(slotSide(1)).toBe('south');
    expect(slotSide(6)).toBe('north');
    expect(slotAt(3, 'south')).toBe(3);
    expect(slotAt(slotColumn(9), slotSide(9))).toBe(9);
  });

  it('retângulos das salas não se sobrepõem e respeitam o corredor', () => {
    const a = slotRect(0);
    const b = slotRect(1);
    expect(a).toEqual({ x: 2 * COL_W, y: 0, w: COL_W, h: 12 });
    expect(b.y).toBe(SOUTH_Y);
    expect(a.y + a.h).toBe(CORRIDOR_Y);
    expect(b.y + b.h).toBe(BUILDING_H);
  });

  it('largura do prédio: só o núcleo quando não há projetos; demais colunas acompanham os slots', () => {
    expect(columnsFor([])).toBe(2);
    expect(columnsFor([0, 1])).toBe(3);
    expect(columnsFor([5])).toBe(5);
    expect(columnsFor([2, 11])).toBe(8);
  });
});

describe('layout do prédio', () => {
  const slots = [0, 1, 2, 3, 4, 7];
  const rooms = roomsFor(slots);
  const cols = columnsFor(slots);
  const b = assembleBuilding(cols, rooms);
  const reception = coreAreas().find((a) => a.id === RECEPTION_ID)!;
  const elevator = reception.spots.find((s) => s.kind === 'elevator')!;
  const reach = b.grid.reachableFrom(elevator.tx, elevator.ty);
  const reachable = (x: number, y: number) => reach[y * b.grid.w + x] === 1;

  it('há dois elevadores com tiles de aproximação caminháveis', () => {
    const elevators = reception.spots.filter((s) => s.kind === 'elevator');
    expect(elevators).toHaveLength(2);
    for (const e of elevators) expect(b.grid.walkable(e.tx, e.ty)).toBe(true);
  });

  it('todos os spots são alcançáveis a partir dos elevadores', () => {
    const unreachable = b.spots.filter((s) => !reachable(s.tx, s.ty)).map((s) => s.id);
    expect(unreachable).toEqual([]);
  });

  it('as portas conectam cada sala ao corredor', () => {
    for (const room of rooms) {
      const door = room.door!;
      expect(door).toBeDefined();
      for (let x = door.x; x < door.x + door.w; x++) {
        for (let y = door.y; y < door.y + door.h; y++) expect(b.grid.walkable(x, y)).toBe(true);
        // tile do corredor imediatamente fora da porta
        const outside = room.side === 'north' ? door.y + door.h : door.y - 1;
        expect(outside >= CORRIDOR_Y && outside < SOUTH_Y).toBe(true);
        expect(reachable(x, outside)).toBe(true);
      }
      // o interior inteiro (fora móveis) é alcançável
      const r = room.rect;
      for (let y = r.y + 2; y < r.y + 11; y++)
        for (let x = r.x + 1; x < r.x + 15; x++) if (b.grid.walkable(x, y)) expect(reachable(x, y)).toBe(true);
    }
  });

  it('cada sala tem 6 mesas, ao menos 4 lugares extras sentados, interruptor e quadro', () => {
    for (const room of rooms) {
      const desks = room.spots.filter((s) => s.kind === 'desk');
      expect(desks).toHaveLength(6);
      expect(new Set(desks.map((d) => d.rank))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
      expect(desks.filter((d) => d.side === 'N')).toHaveLength(3);
      expect(room.spots.filter((s) => s.kind === 'stool' || s.kind === 'nook').length).toBeGreaterThanOrEqual(4);
      expect(room.spots.filter((s) => s.kind === 'stand').length).toBeGreaterThanOrEqual(3);
      expect(room.spots.filter((s) => s.kind === 'switch')).toHaveLength(1);
      expect(room.wallItems.some((w) => w.kind === 'whiteboard')).toBe(true);
      expect(room.wallItems.some((w) => w.kind === 'sign')).toBe(true);
      expect(room.wallItems.some((w) => w.kind === 'light_switch')).toBe(true);
      for (const d of desks) expect(room.furniture.some((f) => f.id === d.deskId)).toBe(true);
    }
  });

  it('móveis bloqueantes não se sobrepõem e ficam dentro da área', () => {
    for (const area of [...b.core, b.corridor, ...rooms]) {
      const used = new Map<string, string>();
      for (const f of area.furniture) {
        const def = FURNITURE[f.kind];
        expect(def.mount).toBe('floor');
        for (let y = f.ty; y < f.ty + def.footprint.h; y++) {
          for (let x = f.tx; x < f.tx + def.footprint.w; x++) {
            expect(x >= area.rect.x && x < area.rect.x + area.rect.w && y >= area.rect.y && y < area.rect.y + area.rect.h).toBe(true);
            const key = `${x},${y}`;
            if (def.blocks) {
              expect(used.get(key), `${f.id} sobre ${used.get(key)}`).toBeUndefined();
              used.set(key, f.id);
            }
          }
        }
      }
      for (const w of area.wallItems) expect(FURNITURE[w.kind].mount).toBe('wall');
    }
  });

  it('spots têm ids únicos', () => {
    const ids = b.spots.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pontos de conversa e ping-pong vêm em pares', () => {
    const groups = new Map<string, number>();
    for (const s of b.spots) if (s.group && (s.kind === 'talk' || s.kind === 'pingpong')) groups.set(s.group, (groups.get(s.group) ?? 0) + 1);
    for (const [, n] of groups) expect(n).toBe(2);
  });

  it('corredor alterna bebedouro e banco nas colunas de projeto, sem excesso de plantas', () => {
    const coolers = b.corridor.furniture.filter((f) => f.kind === 'water_cooler');
    expect(coolers.length).toBeGreaterThanOrEqual(Math.ceil((cols - 2) / 2));
    const benches = b.corridor.furniture.filter((f) => f.kind === 'bench');
    expect(benches.length).toBeGreaterThanOrEqual(Math.floor((cols - 2) / 2));
    const plants = b.corridor.furniture.filter((f) => f.kind === 'plant_tall' || f.kind === 'plant_small');
    expect(plants.length).toBeLessThanOrEqual(cols * 2);
  });

  it('a área externa e os pátios cobrem o prédio', () => {
    const ext = layoutExterior(cols);
    expect(ext.bounds.x).toBeLessThan(0);
    expect(ext.bounds.x + ext.bounds.w).toBeGreaterThan(cols * COL_W);
    const shell = slotShell(5, true);
    expect(shell.walls.length).toBeGreaterThan(0);
    expect(shell.props.every((p) => p.slot === 5)).toBe(true);
  });
});

/** Móveis de chão altos que escondem o que está pendurado na parede logo atrás. */
const TALL_FLOOR = new Set<FurnitureKind>(['plant_tall', 'bookshelf', 'binder_shelf', 'fridge', 'vending_machine', 'arcade', 'water_cooler', 'floor_lamp', 'toilet_stall']);
const WALL_DECOR = new Set<FurnitureKind>(['painting', 'poster', 'window', 'tv', 'whiteboard', 'sign', 'clock', 'mirror', 'door_frame']);

/** Itens de parede decorativos com algum móvel alto encostado na frente (ids). */
function hiddenWallItems(area: AreaLayout): string[] {
  const out: string[] = [];
  for (const w of area.wallItems) {
    if (w.on !== 'face' || !WALL_DECOR.has(w.kind)) continue;
    const half = (FURNITURE[w.kind].footprint.w * TILE) / 2 - 2;
    const wy = w.baseY / TILE;
    for (const f of area.furniture) {
      if (!TALL_FLOOR.has(f.kind) || f.ty !== wy) continue;
      const fx0 = f.tx * TILE + (f.dx ?? 0);
      const fx1 = fx0 + FURNITURE[f.kind].footprint.w * TILE;
      if (fx0 < w.cx + half && fx1 > w.cx - half) out.push(`${w.id} atrás de ${f.id}`);
    }
  }
  return out;
}

function majorFurnitureSignature(area: AreaLayout): string {
  const major = new Set<FurnitureKind>(['desk', 'desk_back', 'meeting_table', 'cafe_table', 'coffee_table']);
  return area.furniture
    .filter((f) => major.has(f.kind))
    .map((f) => `${f.kind}@${f.tx - area.rect.x},${f.ty - area.rect.y}`)
    .join('|');
}

// Use the painted extents, including chair backs and tall furniture above their floor tiles.
const furniturePaint = new Map<string, Rect[]>();
function furnitureBounds(f: AreaLayout['furniture'][number]): Rect[] {
  const key = `${f.kind}:${f.variant ?? ''}`;
  let bounds = furniturePaint.get(key);
  if (!bounds) {
    const sprites = renderFurniture(f.kind, f.variant);
    bounds = [sprites.base, sprites.front].flatMap(s => {
      const painted = s?.buf.bounds();
      return s && painted ? [{ ...painted, x: painted.x - s.ax, y: painted.y - s.ay }] : [];
    });
    furniturePaint.set(key, bounds);
  }
  const { w, h } = FURNITURE[f.kind].footprint;
  return bounds.map(b => ({ ...b, x: b.x + (f.tx + w / 2) * TILE + (f.dx ?? 0), y: b.y + (f.ty + h) * TILE + (f.dy ?? 0) }));
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('variações das salas de projeto', () => {
  const seeds = Array.from({ length: 90 }, (_, i) => (i * 7919 + 13) >>> 0);

  it('mantém o vão visível e a aproximação da porta livres, inclusive nas salas espelhadas', () => {
    for (const slot of [0, 1]) for (const seed of seeds) {
      const room = layoutProjectRoom({ id: `/entry/${seed}`, slot, seed }, theme);
      const door = room.door!;
      const north = slotSide(slot) === 'north';
      const visibleDoor = { x: door.x * TILE, y: (door.y - (north ? 0.5 : 0)) * TILE, w: door.w * TILE, h: (door.h + 0.5) * TILE };
      const approach = { x: door.x, y: north ? door.y - 2 : door.y + door.h, w: door.w, h: 2 };
      for (const f of room.furniture) {
        const footprint = FURNITURE[f.kind].footprint;
        expect(overlaps({ x: f.tx, y: f.ty, ...footprint }, approach), `${f.id} na passagem`).toBe(false);
        expect(furnitureBounds(f).some(b => overlaps(b, visibleDoor)), `${f.id} cobre a porta`).toBe(false);
      }
    }
  });

  it('toda variação é válida: sem sobreposição, tudo alcançável, lugares suficientes', () => {
    for (const slot of [0, 1]) {
      for (const seed of seeds) {
        const room = layoutProjectRoom({ id: `/v/${seed}`, slot, seed }, theme);
        const b = assembleBuilding(columnsFor([slot]), [room]);
        const used = new Map<string, string>();
        for (const f of room.furniture) {
          const def = FURNITURE[f.kind];
          for (let y = f.ty; y < f.ty + def.footprint.h; y++)
            for (let x = f.tx; x < f.tx + def.footprint.w; x++) {
              expect(x >= room.rect.x + 1 && x < room.rect.x + 15 && y >= room.rect.y + 2 && y < room.rect.y + 11, `${f.id} fora do piso`).toBe(true);
              expect(used.get(`${x},${y}`), `${f.id} sobre ${used.get(`${x},${y}`)}`).toBeUndefined();
              used.set(`${x},${y}`, f.id);
            }
        }
        const door = room.door!;
        const reach = b.grid.reachableFrom(door.x, door.y);
        for (const sp of room.spots) expect(reach[sp.ty * b.grid.w + sp.tx], `${sp.id} inalcançável (semente ${seed})`).toBe(1);
        const r = room.rect;
        for (let y = r.y + 2; y < r.y + 11; y++)
          for (let x = r.x + 1; x < r.x + 15; x++) if (b.grid.walkable(x, y)) expect(reach[y * b.grid.w + x], `tile ${x},${y} isolado (semente ${seed})`).toBe(1);
        expect(room.spots.filter((sp) => sp.kind === 'desk')).toHaveLength(6);
        expect(room.spots.filter((sp) => sp.kind === 'stool' || sp.kind === 'nook').length).toBeGreaterThanOrEqual(4);
        // spots de uso não podem cair em cima de móvel que bloqueia
        for (const sp of room.spots) expect(b.grid.walkable(sp.tx, sp.ty), `${sp.id} sobre móvel`).toBe(true);
        expect(hiddenWallItems(room)).toEqual([]);
      }
    }
  });

  it('as salas não são todas iguais: espelhamento, canto de reunião e cantos variam', () => {
    const vs = seeds.map(roomVariant);
    expect(new Set(vs.map((v) => v.plan)).size).toBe(4);
    expect(new Set(vs.map((v) => v.mirror)).size).toBe(2);
    expect(new Set(vs.map((v) => v.meeting)).size).toBe(3);
    expect(new Set(vs.map((v) => v.left)).size).toBeGreaterThan(1);
    expect(new Set(vs.map((v) => v.right)).size).toBeGreaterThan(1);
    // o piso é porcelanato (azulejo é do banheiro) com um leve tom da sala
    const room = layoutProjectRoom({ id: '/v/x', slot: 0, seed: 42 }, theme);
    expect(room.floors.every((f) => f.kind !== 'tile_white')).toBe(true);
    expect(room.floorTint).toBe(theme.carpet);
  });

  it('os quatro planos mudam móveis grandes e atmosfera da parede', () => {
    const byPlan = new Map<string, AreaLayout>();
    for (const seed of seeds) {
      const plan = roomVariant(seed).plan;
      if (!byPlan.has(plan)) byPlan.set(plan, layoutProjectRoom({ id: `/plan/${seed}`, slot: 0, seed }, theme));
    }
    expect(byPlan.size).toBe(4);
    expect(new Set([...byPlan.values()].map(majorFurnitureSignature)).size).toBe(4);
    expect(new Set([...byPlan.values()].map((a) => a.walls.find((w) => w.kind === 'face')?.style.pattern)).size).toBeGreaterThanOrEqual(3);
  });

  it('sala vazia/overflow e sala fantasma preservam plano, capacidade e ids relativos', () => {
    const seed = seeds.find((s) => roomVariant(s).plan === 'overflow')!;
    const empty = layoutProjectRoom({ id: 'temporary:overflow', slot: 0, seed }, theme);
    const reload = layoutProjectRoom({ id: 'temporary:overflow', slot: 0, seed }, theme);
    const ghost = layoutProjectRoom({ id: 'temporary:overflow#mudança1', slot: 0, seed }, theme);
    expect(majorFurnitureSignature(empty)).toBe(majorFurnitureSignature(ghost));
    expect(empty.spots.map((s) => s.kind)).toEqual(ghost.spots.map((s) => s.kind));
    expect(reload.spots.map((s) => s.id)).toEqual(empty.spots.map((s) => s.id));
    expect(empty.spots.filter((s) => s.kind === 'desk')).toHaveLength(6);
    expect(empty.spots.filter((s) => s.kind === 'stand').length).toBeGreaterThanOrEqual(3);
    expect(empty.door).toBeDefined();
  });
});

describe('assentos da convivência', () => {
  it('alinha as poltronas frente a frente com folga visual para a mesa e para a passagem', () => {
    const lounge = layoutLounge();
    const table = lounge.furniture.find(f => f.kind === 'meeting_table')!;
    const seats = lounge.spots.filter(s => s.group === 'debate:library');
    const north = seats.filter(s => s.dir === 'down');
    const south = seats.filter(s => s.dir === 'up');
    expect(north).toHaveLength(2);
    expect(south).toHaveLength(2);
    expect(north.map(s => s.tx).sort()).toEqual(south.map(s => s.tx).sort());
    const seating = lounge.furniture.filter(f => seats.some(s => s.furnitureId === f.id));
    for (const f of seating) {
      for (const b of furnitureBounds(f)) for (const t of furnitureBounds(table)) {
        expect(overlaps(b, { x: t.x - 4, y: t.y - 4, w: t.w + 8, h: t.h + 8 }), `${f.id} colada à mesa`).toBe(false);
      }
    }
    for (const talk of lounge.spots.filter(s => s.group === 'talk:lounge')) {
      expect(seats.some(s => s.tx === talk.tx && s.ty === talk.ty)).toBe(false);
    }
  });
});

describe('escritórios reservados', () => {
  it('mantém o vão do corredor aberto nos dois lados, sem uma parede herdada fechando a entrada', () => {
    for (let slot = 0; slot < 10; slot++) {
      const sh = interiorSlotShell(slot, true);
      const kind = slotSide(slot) === 'north' ? 'south' : 'face';
      const y = sh.door.y * TILE;
      const entrance = sh.walls.filter((w) => w.kind === kind && w.y === y);
      expect(entrance).toHaveLength(1);
      expect('doorways' in entrance[0] ? entrance[0].doorways : []).toContainEqual({ x: sh.door.x * TILE, w: sh.door.w * TILE });
      expect(sh.props).toEqual([]);
    }
  });
  it('mantém a sala temporária como apoio, com decoração limitada e circulação livre', () => {
    for (let slot = 0; slot < 10; slot++) {
      const sh = interiorSlotShell(slot, false);
      expect(sh.furniture.length).toBeLessThanOrEqual(8);
      expect(sh.furniture.some((f) => ['desk', 'desk_back', 'meeting_table'].includes(f.kind))).toBe(false);
      expect(sh.rugs.length).toBeLessThanOrEqual(1);
      // O centro e a aproximação da entrada ficam livres nos dois lados do corredor.
      for (const f of sh.furniture) {
        expect(Math.abs(f.x - (sh.rect.x + 8) * TILE)).toBeGreaterThanOrEqual(2 * TILE);
      }
      for (let i = 1; i < sh.furniture.length; i++) expect(sh.furniture[i].y).toBeGreaterThanOrEqual(sh.furniture[i - 1].y);
    }
  });
});

describe('itens de parede', () => {
  it('quadros, janelas, TV, placas e espelhos não ficam atrás de móveis altos', () => {
    for (const area of [...coreAreas(), ...roomsFor([0, 1, 2, 3, 4, 7])]) expect(hiddenWallItems(area), area.id).toEqual([]);
  });

  it('passagens nas faces das paredes têm batente', () => {
    const restroom = coreAreas().find((a) => a.kind === 'restroom')!;
    expect(restroom.wallItems.some((w) => w.kind === 'door_frame')).toBe(true);
    for (const room of roomsFor([1, 3, 7])) expect(room.wallItems.some((w) => w.kind === 'door_frame'), room.id).toBe(true);
  });
});
