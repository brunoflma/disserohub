// Indoor view: preserve room/corridor geometry without reserving exterior space.
import { FURNITURE, type FurnitureKind } from '../../art/api';
import { roomTheme } from '../../art/theme';
import { TILE } from '../constants';
import { buildingRect } from './geometry';
import { AreaBuilder } from './builder';
import type { ExteriorLayout, SlotShell } from './exterior';
import { layoutProjectRoom } from './room';
import type { AreaLayout } from './types';

export interface InteriorSlotShell extends SlotShell {
  furniture: { kind: FurnitureKind; variant?: string; x: number; y: number; order: number }[];
  rugs: AreaLayout['rugs'];
  wallItems: AreaLayout['wallItems'];
  door: NonNullable<AreaLayout['door']>;
}

export function layoutInterior(cols: number): ExteriorLayout {
  const rect = buildingRect(cols);
  return {
    bounds: { x: rect.x - 0.5, y: rect.y - 0.5, w: rect.w + 1, h: rect.h + 1 },
    floors: [],
    props: [],
    lanes: [],
    streetY: 0,
    streetH: 0,
  };
}

/** Reading nook for an unused slot; no workstations or registered agent spots. */
export function interiorSlotShell(slot: number, _lastColumn: boolean): InteriorSlotShell {
  const seed = 0x616d6600 + slot * 7919;
  const theme = roomTheme(seed);
  const layout = layoutProjectRoom({ id: `reserved:${slot}`, slot, seed }, theme);
  const decor = new AreaBuilder(`reserved:${slot}`, 'room', layout.rect);
  const mirror = slot % 4 >= 2;
  const x = (left: number, width = 1) => mirror ? 16 - left - width : left;
  decor.rug(x(1.75, 6.5), 2.5, 6.5, 6.2, theme.carpet2, seed);
  decor.furn('armchair', x(3), 3, 'down');
  decor.furn('armchair', x(5), 3, 'down');
  decor.furn('coffee_table', x(3.5, 2), 5);
  decor.furn('sofa', x(3, 3), 7, 'up');
  decor.furn('floor_lamp', x(1), 7);
  decor.furn('bookshelf', x(12, 2), 4, 'legal');
  decor.furn('plant_tall', x(13), 9, slot % 2 ? 'ficus' : 'monstera');
  decor.wall('painting', mirror ? 11.5 : 4.5);
  return {
    slot,
    rect: layout.rect,
    interior: true,
    floors: layout.floors,
    walls: layout.walls,
    windows: layout.wallItems.filter((w) => w.kind === 'window'),
    wallItems: [...layout.wallItems.filter((w) => w.kind === 'poster' || w.kind === 'door_frame'), ...decor.area.wallItems],
    rugs: decor.area.rugs,
    door: layout.door!,
    props: [],
    furniture: decor.area.furniture.map((f) => {
      const { w, h } = FURNITURE[f.kind].footprint;
      return { kind: f.kind, variant: f.variant, x: (f.tx + w / 2) * TILE + (f.dx ?? 0), y: (f.ty + h) * TILE + (f.dy ?? 0), order: f.order };
    }).sort((a, b) => a.y - b.y || a.order - b.order),
  };
}
