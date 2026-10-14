// Indoor view: preserve room/corridor geometry without reserving exterior space.
import { FURNITURE, type FurnitureKind } from '../../art/api';
import { roomTheme } from '../../art/theme';
import { TILE } from '../constants';
import { buildingRect } from './geometry';
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

/** Standard office presentation only: the open doorway does not register a room or agent spots. */
export function interiorSlotShell(slot: number, _lastColumn: boolean): InteriorSlotShell {
  const seed = 0x616d6600 + slot * 7919;
  const layout = layoutProjectRoom({ id: `reserved:${slot}`, slot, seed }, roomTheme(seed));
  return {
    slot,
    rect: layout.rect,
    interior: true,
    floors: layout.floors,
    walls: layout.walls,
    windows: layout.wallItems.filter((w) => w.kind === 'window'),
    wallItems: layout.wallItems.filter((w) => !['window', 'sign', 'clock', 'light_switch'].includes(w.kind)),
    rugs: layout.rugs,
    door: layout.door!,
    props: [],
    furniture: layout.furniture.map((f) => {
      const { w, h } = FURNITURE[f.kind].footprint;
      return { kind: f.kind, variant: f.variant, x: (f.tx + w / 2) * TILE + (f.dx ?? 0), y: (f.ty + h) * TILE + (f.dy ?? 0), order: f.order };
    }).sort((a, b) => a.y - b.y || a.order - b.order),
  };
}
