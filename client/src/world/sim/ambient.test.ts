import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../../../shared/types';
import { appearanceFromSeed } from '../../art/character/appearance';
import type { ArtModule } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS, type WorldOptions } from '../api';
import { CAFE_ID, LOUNGE_ID, RECEPTION_ID, RESTROOM_ID } from '../layout/core';
import type { SpotDef, SpotKind } from '../layout/types';
import type { Character } from './character';
import { isBusinessHours } from './ambient';
import { Sim } from './sim';
import type { Step } from './steps';

const art = { appearanceFromSeed } as unknown as ArtModule;
const OPEN = new Date(2026, 9, 26, 8, 0).getTime();
const CLOSE = new Date(2026, 9, 26, 18, 0).getTime();
const optionsAtOpen: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, ambientLife: true };
const seatKinds: Readonly<Record<string, ReadonlySet<SpotKind>>> = {
  [RECEPTION_ID]: new Set(['bench', 'armchair', 'sofa']),
  [CAFE_ID]: new Set(['cafe_seat']),
  [LOUNGE_ID]: new Set(['sofa', 'armchair', 'beanbag']),
};

function emptySnapshot(): OfficeSnapshot {
  return {
    rev: 1,
    serverTime: OPEN,
    rooms: [],
    agents: [],
    accounts: [],
    meta: { demo: false, sources: [], startedAt: OPEN, version: 'test' },
  };
}

function makeSim(options: Partial<WorldOptions> = {}, prepare?: (sim: Sim) => void): { sim: Sim; options: WorldOptions } {
  const currentOptions: WorldOptions = { ...optionsAtOpen, ...options };
  const sim = new Sim(art, () => currentOptions, null);
  prepare?.(sim);
  sim.applySnapshot(emptySnapshot(), OPEN);
  return { sim, options: currentOptions };
}

function characters(sim: Sim): Character[] {
  return [...sim.ambient.chars.values()];
}

function spotFor(sim: Sim, step: Step | undefined): SpotDef | undefined {
  if (step?.t === 'enter') return sim.spots.get(step.spot);
  return undefined;
}

function applyQueuedArrival(sim: Sim, ch: Character): void {
  const target = spotFor(sim, ch.queue.find((step) => step.t === 'enter'));
  expect(target).toBeDefined();
  if (!target) return;
  if (ch.atSpot) sim.spots.release(ch.atSpot, ch.id);
  ch.placeAtTile(target.tx, target.ty);
  ch.x = target.x;
  ch.y = target.y;
  ch.dir = target.dir;
  ch.atSpot = target.id;
  ch.seated = !!target.seated;
  ch.sortY = target.sortY ?? null;
  ch.queue.length = 0;
  ch.step = null;
  ch.stepStarted = false;
}

describe('AmbientOffice', () => {
  it('uses local weekday boundaries and keeps residents outside the session map', () => {
    const at = (hour: number, minute = 0) => new Date(2026, 9, 26, hour, minute).getTime();
    expect(new Date(OPEN).getDay()).toBeGreaterThan(0);
    expect(new Date(OPEN).getDay()).toBeLessThan(6);
    expect(isBusinessHours(at(7, 59))).toBe(false);
    expect(isBusinessHours(at(8, 0))).toBe(true);
    expect(isBusinessHours(at(17, 59))).toBe(true);
    expect(isBusinessHours(at(18, 0))).toBe(false);
    expect(isBusinessHours(new Date(2026, 9, 24, 10).getTime())).toBe(false);
    expect(isBusinessHours(new Date(2026, 9, 25, 10).getTime())).toBe(false);

    const { sim } = makeSim();
    expect(sim.ambient.chars.size).toBe(4);
    expect(sim.chars.size).toBe(0);
    expect(characters(sim).map((ch) => ch.id).sort()).toEqual([
      'ambient:receptionist', 'ambient:support-1', 'ambient:support-2', 'ambient:visitor',
    ]);
    expect(characters(sim).every((ch) => ch.info.sessionId === '' && ch.info.account === '')).toBe(true);
    expect(characters(sim).every((ch) => Object.values(ch.info.stats).every((value) => value === 0))).toBe(true);
    expect(characters(sim).every((ch) => ch.appearance.lanyard === null)).toBe(true);
    expect(sim.ambient.chars.get('ambient:receptionist')?.info.role).toBe('Recepcionista · ambiente');
    expect(sim.ambient.chars.get('ambient:visitor')?.info.role).toBe('Visitante · ambiente');
    expect(sim.ambient.chars.get('ambient:support-1')?.info.role).toBe('Equipe de apoio · ambiente');
    expect(sim.spots.get(sim.ambient.chars.get('ambient:visitor')?.atSpot)?.areaId).toBe(RECEPTION_ID);
    expect(sim.spots.get(sim.ambient.chars.get('ambient:support-1')?.atSpot)?.areaId).toBe(CAFE_ID);
    expect(sim.spots.get(sim.ambient.chars.get('ambient:support-2')?.atSpot)?.areaId).toBe(LOUNGE_ID);

    const desk = sim.spots.get(sim.ambient.chars.get('ambient:receptionist')?.atSpot);
    const deskPath: number[] = [];
    expect(desk?.kind).toBe('reception_staff');
    expect(desk && sim.finder.find(desk.tx, desk.ty, desk.tx, desk.ty, deskPath)).toBe(true);

    const occupied = characters(sim).map((ch) => ch.atSpot);
    expect(new Set(occupied).size).toBe(4);
    for (const ch of characters(sim)) expect(sim.spots.ownerOf(ch.atSpot!)).toBe(ch.id);
    for (const areaId of Object.keys(seatKinds)) {
      const seatsLeft = [...sim.spots.all()].filter((spot) => spot.areaId === areaId
        && spot.seated && seatKinds[areaId].has(spot.kind) && !sim.spots.ownerOf(spot.id));
      expect(seatsLeft.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('skips occupied seats and queues only reachable core routes with reservations made first', () => {
    let occupiedId = '';
    const { sim } = makeSim({}, (candidate) => {
      const occupied = [...candidate.spots.all()].find((spot) => spot.areaId === RECEPTION_ID
        && spot.seated && seatKinds[RECEPTION_ID].has(spot.kind))!;
      occupiedId = occupied.id;
      expect(candidate.spots.reserve(occupied.id, 'real:agent')).toBe(true);
    });
    const visitor = sim.ambient.chars.get('ambient:visitor')!;
    expect(visitor.atSpot).not.toBe(occupiedId);
    expect(sim.spots.ownerOf(visitor.atSpot!)).toBe(visitor.id);
    expect(sim.ambient.plan(visitor, OPEN)).toBe(true);

    const destination = spotFor(sim, visitor.queue.find((step) => step.t === 'enter'))!;
    const go = visitor.queue.find((step) => step.t === 'go');
    expect(go?.t).toBe('go');
    if (go?.t !== 'go') return;
    expect(go.path).toBeDefined();
    const verified: number[] = [];
    expect(sim.finder.find(visitor.tx, visitor.ty, destination.tx, destination.ty, verified)).toBe(true);
    expect(go.path).toEqual(verified);
    const coreAreas = new Set([RECEPTION_ID, CAFE_ID, LOUNGE_ID, RESTROOM_ID]);
    for (let i = 0; i < go.path!.length; i += 2) {
      const inPublicRoom = sim.building.core.some((area) => coreAreas.has(area.id)
        && go.path![i] >= area.rect.x && go.path![i] < area.rect.x + area.rect.w
        && go.path![i + 1] >= area.rect.y && go.path![i + 1] < area.rect.y + area.rect.h);
      const corridor = sim.building.corridor.rect;
      const inCorridor = go.path![i] >= corridor.x && go.path![i] < corridor.x + corridor.w
        && go.path![i + 1] >= corridor.y && go.path![i + 1] < corridor.y + corridor.h;
      expect(inPublicRoom || inCorridor).toBe(true);
    }
    expect(sim.spots.ownerOf(visitor.atSpot!)).toBe(visitor.id);
    expect(sim.spots.ownerOf(destination.id)).toBe(visitor.id);
    expect(visitor.queue[0]?.t).toBe('exit');
  });

  it('revalidates active movement after layout changes without allowing a fallback route', () => {
    const { sim } = makeSim();
    const visitor = sim.ambient.chars.get('ambient:visitor')!;
    expect(sim.ambient.plan(visitor, OPEN)).toBe(true);
    const go = visitor.queue.find((step) => step.t === 'go');
    expect(go?.t).toBe('go');
    if (go?.t !== 'go') return;

    visitor.step = go;
    visitor.queue.length = 0;
    go.path = [sim.building.rect.x, sim.building.rect.y];
    go.i = 0;
    sim.ambient.relayout();

    const verified: number[] = [];
    expect(sim.finder.find(visitor.tx, visitor.ty, go.tx, go.ty, verified)).toBe(true);
    expect(go.path).toEqual(verified);
  });

  it('moves residents through public areas during ordinary Sim updates', () => {
    const { sim } = makeSim();
    const publicAreas = [RECEPTION_ID, CAFE_ID, LOUNGE_ID, RESTROOM_ID];
    const roamers = ['ambient:visitor', 'ambient:support-1', 'ambient:support-2'];
    const visited = new Map(roamers.map((id) => [id, new Set<string>()]));
    const duration = 10 * 60_000;

    for (let elapsed = 0; elapsed <= duration; elapsed += 100) {
      sim.update(0.1, OPEN + elapsed);
      for (const id of roamers) {
        const ch = sim.ambient.chars.get(id)!;
        const areaId = sim.spots.get(ch.atSpot)?.areaId
          ?? (ch.step?.t === 'stall' ? sim.spots.get(ch.step.spot)?.areaId : undefined);
        if (areaId && publicAreas.includes(areaId)) visited.get(id)!.add(areaId);
      }
    }

    for (const id of roamers) {
      expect([...visited.get(id)!]).toContain(RECEPTION_ID);
      expect([...visited.get(id)!]).toContain(CAFE_ID);
      expect([...visited.get(id)!]).toContain(LOUNGE_ID);
    }
    for (const id of roamers) expect(visited.get(id)!.has(RESTROOM_ID)).toBe(true);
  });

  it('releases ambient bathroom reservations and stall flags at closing while preserving real owners', () => {
    const { sim } = makeSim();
    const visitor = sim.ambient.chars.get('ambient:visitor')!;
    expect(sim.ambient.plan(visitor, OPEN)).toBe(true);
    applyQueuedArrival(sim, visitor);
    expect(sim.ambient.plan(visitor, OPEN + 60_000)).toBe(true);

    const stallStep = visitor.queue.find((step) => step.t === 'stall');
    expect(stallStep?.t).toBe('stall');
    if (stallStep?.t !== 'stall') return;
    const stall = sim.spots.get(stallStep.spot)!;
    const ambientFurniture = stall.furnitureId ?? stall.id;
    const realStall = sim.spots.ofKind('stall').find((spot) => spot.id !== stall.id)!;
    const realFurniture = realStall.furnitureId ?? realStall.id;
    expect(sim.spots.ownerOf(stall.id)).toBe(visitor.id);
    expect(sim.spots.reserve(realStall.id, 'real:agent')).toBe(true);
    sim.stallBusy.add(ambientFurniture);
    sim.stallBusy.add(realFurniture);

    sim.ambient.sync(CLOSE);
    expect(sim.ambient.chars.size).toBe(0);
    expect(sim.spots.ownerOf(stall.id)).toBeUndefined();
    expect(sim.spots.ownerOf(realStall.id)).toBe('real:agent');
    expect(sim.stallBusy.has(ambientFurniture)).toBe(false);
    expect(sim.stallBusy.has(realFurniture)).toBe(true);
  });

  it('keeps reduced-motion residents in fixed poses and cleans up when disabled', () => {
    const { sim, options } = makeSim({ reducedMotion: true });
    const before = characters(sim).map((ch) => ({ id: ch.id, x: ch.x, y: ch.y, spot: ch.atSpot, pose: ch.pose }));
    expect(characters(sim).every((ch) => ch.thinkAt > OPEN)).toBe(true);
    for (const ch of characters(sim)) {
      expect(sim.ambient.plan(ch, OPEN)).toBe(true);
      expect(ch.queue).toHaveLength(0);
      expect(ch.pose).not.toBe('walk');
      expect(ch.pose).not.toBe('run');
    }
    expect(characters(sim).map((ch) => ({ id: ch.id, x: ch.x, y: ch.y, spot: ch.atSpot, pose: ch.pose }))).toEqual(before);

    options.ambientLife = false;
    sim.ambient.sync(OPEN + 1_000);
    expect(sim.ambient.chars.size).toBe(0);
    expect([...sim.spots.all()].some((spot) => sim.spots.ownerOf(spot.id)?.startsWith('ambient:'))).toBe(false);
  });

  it('fast-forwards by clearing stale state and resynchronizing to the destination time', () => {
    const { sim } = makeSim();
    sim.ambient.fastForward(OPEN + 60_000);
    expect(sim.ambient.chars.size).toBe(4);
    sim.ambient.fastForward(CLOSE);
    expect(sim.ambient.chars.size).toBe(0);
    expect([...sim.spots.all()].some((spot) => sim.spots.ownerOf(spot.id)?.startsWith('ambient:'))).toBe(false);
  });
});
