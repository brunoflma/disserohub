import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../../shared/types';
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

function projectRoom(id = '/ambient-project'): RoomInfo {
  return { id, name: 'ambient-project', path: id, slot: 0, seed: 4421, createdAt: OPEN };
}

function workingAgent(id: string, roomId: string): AgentInfo {
  return {
    id, kind: 'main', roomId, name: 'Worker', look: 'm', role: 'Agente principal',
    sessionId: `session-${id}`, account: '.claude', status: 'working', recent: [], tasks: [],
    startedAt: OPEN, lastEventAt: OPEN, statusSince: OPEN,
    stats: { toolCalls: 1, tokensIn: 2, tokensOut: 3, subagents: 0 }, seed: 8811,
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
  if (!sim.spots.ownerOf(target.id)) sim.spots.reserve(target.id, ch.id);
  ch.placeAtTile(target.tx, target.ty);
  ch.x = target.x;
  ch.y = target.y;
  ch.dir = target.dir;
  ch.atSpot = target.id;
  ch.seated = !!target.seated;
  ch.sortY = target.sortY ?? null;
  ch.alpha = 1;
  ch.inside = false;
  ch.arriving = false;
  ch.queue.length = 0;
  ch.step = null;
  ch.stepStarted = false;
}

function placeWorkerAtDesk(sim: Sim, id: string, roomId: string): Character {
  const worker = sim.chars.get(id)!;
  const room = sim.rooms.get(roomId)!;
  let spot = sim.spots.get(worker.homeSpot);
  if (!spot) {
    spot = room.layout.spots.find((candidate) => candidate.kind === 'desk')!;
    expect(sim.spots.reserve(spot.id, worker.id)).toBe(true);
    worker.homeSpot = spot.id;
  }
  worker.placeAtTile(spot.tx, spot.ty);
  worker.x = spot.x;
  worker.y = spot.y;
  worker.atSpot = spot.id;
  worker.seated = true;
  worker.mode = 'work';
  worker.leaving = false;
  worker.gone = false;
  worker.inside = false;
  worker.arriving = false;
  worker.alpha = 1;
  return worker;
}

function placeSupportInProjectOffice(sim: Sim, now: number): { support: Character; roomId: string } {
  const support = characters(sim).find((ch) => ch.info.role === 'Equipe de apoio')!;
  applyQueuedArrival(sim, support);
  const info = workingAgent('real:worker', '/ambient-project');
  sim.applySnapshot({ ...emptySnapshot(), rev: 2, rooms: [projectRoom(info.roomId)], agents: [info] }, now);
  placeWorkerAtDesk(sim, info.id, info.roomId);
  const state = (sim.ambient as unknown as { states: Map<string, { nextOfficeVisitAt: number }> }).states.get(support.id)!;
  state.nextOfficeVisitAt = now;
  expect(sim.ambient.plan(support, now + 100)).toBe(true);
  applyQueuedArrival(sim, support);
  return { support, roomId: info.roomId };
}

function advanceUntil(sim: Sim, start: number, predicate: () => boolean, maxSeconds: number): number {
  let now = start;
  for (let i = 0; i < maxSeconds && !predicate(); i++) {
    now += 1_000;
    sim.update(1, now);
  }
  return now;
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
    const receptionist = sim.ambient.chars.get('ambient:receptionist')!;
    const visitors = characters(sim).filter((ch) => ch.info.role === 'Visitante');
    const support = characters(sim).filter((ch) => ch.info.role === 'Equipe de apoio');
    expect(visitors).toHaveLength(1);
    expect(support).toHaveLength(2);
    expect(characters(sim).every((ch) => ch.info.sessionId === '' && ch.info.account === '')).toBe(true);
    expect(characters(sim).every((ch) => Object.values(ch.info.stats).every((value) => value === 0))).toBe(true);
    expect(characters(sim).every((ch) => ch.appearance.lanyard === null)).toBe(true);
    expect(receptionist.info.role).toBe('Recepcionista');
    expect(visitors[0].info.role).toBe('Visitante');
    expect(support.every((ch) => ch.info.role === 'Equipe de apoio')).toBe(true);
    expect(characters(sim).every((ch) => !ch.info.role.includes('ambiente'))).toBe(true);
    expect(sim.spots.get(visitors[0].atSpot)?.areaId).toBe(RECEPTION_ID);
    expect(support.every((ch) => [CAFE_ID, LOUNGE_ID].includes(sim.spots.get(ch.atSpot)?.areaId as typeof CAFE_ID | typeof LOUNGE_ID))).toBe(true);

    const desk = sim.spots.get(receptionist.atSpot);
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
    const visitor = characters(sim).find((ch) => ch.info.role === 'Visitante')!;
    applyQueuedArrival(sim, visitor);
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
    expect(visitor.queue.some((step) => step.t === 'exit')).toBe(true);
  });

  it('revalidates active movement after layout changes without allowing a fallback route', () => {
    const { sim } = makeSim();
    const visitor = characters(sim).find((ch) => ch.info.role === 'Visitante')!;
    applyQueuedArrival(sim, visitor);
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
    const roamers = characters(sim).filter((ch) => ch.info.role !== 'Recepcionista').map((ch) => ch.id);
    const visited = new Map(roamers.map((id) => [id, new Set<string>()]));
    const duration = 45 * 60_000;

    for (let elapsed = 0; elapsed <= duration; elapsed += 100) {
      sim.update(0.1, OPEN + elapsed);
      for (const id of roamers) {
        const ch = sim.ambient.chars.get(id);
        if (!ch) continue;
        const areaId = sim.spots.get(ch.atSpot)?.areaId
          ?? (ch.step?.t === 'stall' ? sim.spots.get(ch.step.spot)?.areaId : undefined);
        if (areaId && publicAreas.includes(areaId)) visited.get(id)!.add(areaId);
      }
    }

    for (const id of roamers) expect(visited.get(id)!.size).toBeGreaterThanOrEqual(2);
  });

  it('releases ambient bathroom reservations and stall flags at closing while preserving real owners', () => {
    const { sim } = makeSim();
    const visitor = characters(sim).find((ch) => ch.info.role === 'Visitante')!;
    applyQueuedArrival(sim, visitor);
    const state = (sim.ambient as unknown as { states: Map<string, { nextRestroomAt: number }> }).states.get(visitor.id)!;
    state.nextRestroomAt = OPEN + 60_000;
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

  it('soft-penalizes recent public areas without a forced cycle and keeps stays in minutes', () => {
    const { sim } = makeSim();
    const visitor = characters(sim).find((ch) => ch.info.role === 'Visitante')!;
    applyQueuedArrival(sim, visitor);
    const state = (sim.ambient as unknown as { states: Map<string, { nextRestroomAt: number }> }).states.get(visitor.id)!;
    state.nextRestroomAt = OPEN + 60 * 60_000;
    const visited: string[] = [];

    for (let i = 0; i < 32; i++) {
      expect(sim.ambient.plan(visitor, OPEN + i * 1_000)).toBe(true);
      const enter = visitor.queue.find((step) => step.t === 'enter');
      const destination = enter?.t === 'enter' ? sim.spots.get(enter.spot) : undefined;
      expect(destination).toBeDefined();
      if (!destination) return;
      visited.push(destination.areaId);
      const stay = visitor.queue.find((step) => step.t === 'act');
      expect(stay?.t).toBe('act');
      if (stay?.t === 'act') expect(stay.ms).toBeGreaterThanOrEqual(2 * 60_000);
      if (stay?.t === 'act') expect(stay.ms).toBeLessThanOrEqual(5 * 60_000);
      applyQueuedArrival(sim, visitor);
    }

    expect(visited.every((area, i) => i === 0 || area !== visited[i - 1])).toBe(true);
    expect(visited.some((area, i) => i >= 3 && area !== visited[i - 3])).toBe(true);
  });

  it('keeps a cancelled elevator arrival hidden until its physical exit finishes', () => {
    const { sim } = makeSim();
    const visitor = characters(sim).find((ch) => ch.info.role === 'Visitante')!;
    const elevator = sim.elevators[0];
    const elevatorSpot = sim.spots.get(elevator.spotId)!;
    const staleEnter = visitor.queue.find((step) => step.t === 'enter');
    expect(staleEnter?.t).toBe('enter');
    if (staleEnter?.t !== 'enter') return;
    const staleSpotId = staleEnter.spot;
    staleEnter.spot = 'ambient:removed-destination';

    sim.ambient.relayout();

    expect(visitor.queue[0]?.t).toBe('elevOut');
    expect(visitor.queue[1]?.t).toBe('do');
    expect(visitor.inside).toBe(true);
    expect(visitor.alpha).toBe(0);
    expect(visitor.arriving).toBe(true);
    expect(visitor.atSpot).toBeNull();
    expect(sim.spots.ownerOf(staleSpotId)).toBeUndefined();

    const now = advanceUntil(sim, OPEN, () => !visitor.arriving, 12);
    expect(now).toBeLessThanOrEqual(OPEN + 12_000);
    expect(visitor.inside).toBe(false);
    expect(visitor.alpha).toBe(1);
    expect(visitor.gone).toBe(false);
    expect(visitor.tx).toBe(elevatorSpot.tx);
    expect(visitor.ty).toBe(elevatorSpot.ty);
    expect(elevator.load).toBe(0);
  });

  it.each(['removed', 'moved'] as const)('retries a support shift after office %s and rotates only after physical departure/cooldown', (change) => {
    const { sim } = makeSim();
    const { support, roomId } = placeSupportInProjectOffice(sim, OPEN + 10 * 60_000);
    const originalId = support.id;
    const state = (sim.ambient as unknown as { states: Map<string, { shiftEndsAt: number; departing: boolean }> }).states.get(originalId)!;
    const cancelAt = OPEN + 11 * 60_000;
    state.shiftEndsAt = cancelAt;
    support.thinkAt = cancelAt;
    expect(sim.ambient.plan(support, cancelAt)).toBe(true);
    expect(state.departing).toBe(true);
    expect(support.leaving).toBe(true);

    if (change === 'removed') {
      sim.applySnapshot({ ...emptySnapshot(), rev: 3 }, cancelAt);
      sim.update(1, cancelAt);
    } else {
      sim.moveRoom(sim.rooms.get(roomId)!, 1, cancelAt);
    }

    expect(state.departing).toBe(false);
    expect(support.leaving).toBe(false);
    expect((sim.ambient as unknown as { departingId: string | null }).departingId).toBeNull();
    expect(state.shiftEndsAt).toBeGreaterThan(cancelAt);

    let now = advanceUntil(sim, cancelAt, () => !sim.ambient.chars.has(originalId), 1_500);
    expect(sim.ambient.chars.has(originalId)).toBe(false);
    const replacementAt = (sim.ambient as unknown as { replacementAt: Map<string, number> }).replacementAt.get('support')!;
    expect(replacementAt).toBeGreaterThan(now);
    while (now + 1_000 < replacementAt) {
      now += 1_000;
      sim.update(1, now);
    }
    expect(characters(sim).filter((ch) => ch.info.role === 'Equipe de apoio')).toHaveLength(1);
    now += 1_000;
    sim.update(1, now);
    const replacement = characters(sim).filter((ch) => ch.info.role === 'Equipe de apoio');
    expect(replacement).toHaveLength(2);
    expect(replacement.some((ch) => ch.id !== originalId)).toBe(true);
  });

  it('cleans a queued restroom reservation when the source office is removed before stall entry', () => {
    const { sim } = makeSim();
    const { support } = placeSupportInProjectOffice(sim, OPEN + 10 * 60_000);
    const other = characters(sim).find((ch) => ch.info.role === 'Equipe de apoio' && ch.id !== support.id)!;
    applyQueuedArrival(sim, other);
    const state = (sim.ambient as unknown as { states: Map<string, { nextRestroomAt: number; nextOfficeVisitAt: number; shiftEndsAt: number }> }).states.get(support.id)!;
    state.nextOfficeVisitAt = OPEN + 60 * 60_000;
    state.nextRestroomAt = OPEN + 11 * 60_000;
    state.shiftEndsAt = OPEN + 2 * 60 * 60_000;
    expect(sim.ambient.plan(support, OPEN + 11 * 60_000)).toBe(true);
    expect(support.queue.some((step) => step.t === 'stall')).toBe(true);
    expect((sim.ambient as unknown as { restroomOwner: string | null }).restroomOwner).toBe(support.id);

    sim.applySnapshot({ ...emptySnapshot(), rev: 3 }, OPEN + 11 * 60_000);
    sim.update(1, OPEN + 11 * 60_000);

    expect((sim.ambient as unknown as { restroomOwner: string | null }).restroomOwner).toBeNull();
    expect((sim.ambient as unknown as { stallByCharacter: Map<string, string> }).stallByCharacter.has(support.id)).toBe(false);
    expect(sim.spots.reservedBy(support.id).some((id) => ['stall', 'sink'].includes(sim.spots.get(id)?.kind ?? ''))).toBe(false);

    const otherState = (sim.ambient as unknown as { states: Map<string, { nextRestroomAt: number; nextOfficeVisitAt: number; shiftEndsAt: number }> }).states.get(other.id)!;
    otherState.nextOfficeVisitAt = OPEN + 60 * 60_000;
    otherState.nextRestroomAt = OPEN + 11 * 60_000;
    otherState.shiftEndsAt = OPEN + 2 * 60 * 60_000;
    expect(sim.ambient.plan(other, OPEN + 11 * 60_000)).toBe(true);
    expect(other.queue.some((step) => step.t === 'stall')).toBe(true);
  });

  it('finishes the current restroom stall before releasing its reservations after office removal', () => {
    const { sim } = makeSim();
    const { support } = placeSupportInProjectOffice(sim, OPEN + 10 * 60_000);
    const other = characters(sim).find((ch) => ch.info.role === 'Equipe de apoio' && ch.id !== support.id)!;
    applyQueuedArrival(sim, other);
    const state = (sim.ambient as unknown as { states: Map<string, { nextRestroomAt: number; nextOfficeVisitAt: number; shiftEndsAt: number }> }).states.get(support.id)!;
    state.nextOfficeVisitAt = OPEN + 60 * 60_000;
    state.nextRestroomAt = OPEN + 11 * 60_000;
    state.shiftEndsAt = OPEN + 2 * 60 * 60_000;
    expect(sim.ambient.plan(support, OPEN + 11 * 60_000)).toBe(true);

    let now = OPEN + 11 * 60_000;
    for (let i = 0; i < 100 && !(support.step?.t === 'stall' && support.step.phase === 1); i++) {
      now += 1_000;
      sim.update(1, now);
    }
    expect(support.step?.t).toBe('stall');
    if (support.step?.t !== 'stall') return;
    expect(support.step.phase).toBe(1);
    const stall = sim.spots.get(support.step.spot)!;
    const furniture = stall.furnitureId ?? stall.id;
    expect(support.inside).toBe(true);
    expect(support.alpha).toBe(0);
    expect(sim.stallBusy.has(furniture)).toBe(true);

    sim.applySnapshot({ ...emptySnapshot(), rev: 3 }, now);
    now += 1_000;
    sim.update(1, now);
    for (let i = 0; i < 6 && ((sim.ambient as unknown as { restroomOwner: string | null }).restroomOwner || support.step?.t === 'stall'); i++) {
      now += 1_000;
      sim.update(1, now);
    }

    expect((sim.ambient as unknown as { restroomOwner: string | null }).restroomOwner).toBeNull();
    expect((sim.ambient as unknown as { stallByCharacter: Map<string, string> }).stallByCharacter.has(support.id)).toBe(false);
    expect(sim.stallBusy.has(furniture)).toBe(false);
    expect(sim.spots.ownerOf(stall.id)).toBeUndefined();
    expect(support.inside).toBe(false);
    expect(support.alpha).toBe(1);
    expect(support.gone).toBe(false);

    const otherState = (sim.ambient as unknown as { states: Map<string, { nextRestroomAt: number; nextOfficeVisitAt: number; shiftEndsAt: number }> }).states.get(other.id)!;
    otherState.nextOfficeVisitAt = now + 60 * 60_000;
    otherState.nextRestroomAt = now;
    otherState.shiftEndsAt = now + 2 * 60 * 60_000;
    expect(sim.ambient.plan(other, now)).toBe(true);
    expect(other.queue.some((step) => step.t === 'stall')).toBe(true);
  });

  it('visits a free project-room social seat near a working agent without touching agent state', () => {
    const { sim } = makeSim();
    const support = characters(sim).find((ch) => ch.info.role === 'Equipe de apoio')!;
    applyQueuedArrival(sim, support);
    const info = workingAgent('real:worker', '/ambient-project');
    sim.applySnapshot({ ...emptySnapshot(), rev: 2, rooms: [projectRoom(info.roomId)], agents: [info] }, OPEN + 100);

    const worker = placeWorkerAtDesk(sim, info.id, info.roomId);
    const before = { mode: worker.mode, status: worker.info.status, step: worker.step, queue: [...worker.queue], stats: { ...worker.info.stats } };
    const state = (sim.ambient as unknown as { states: Map<string, { nextOfficeVisitAt: number }> }).states.get(support.id)!;
    state.nextOfficeVisitAt = OPEN;

    expect(sim.workingAgentPositions()).toEqual([{ roomId: info.roomId, tx: worker.tx, ty: worker.ty }]);
    expect(sim.ambient.plan(support, OPEN + 10 * 60_000)).toBe(true);
    const enter = support.queue.find((step) => step.t === 'enter');
    const destination = enter?.t === 'enter' ? sim.spots.get(enter.spot) : undefined;
    expect(destination?.areaId).toBe(info.roomId);
    expect(['nook', 'stool']).toContain(destination?.kind);
    expect(support.queue.some((step) => step.t === 'act' && step.pose === 'talk')).toBe(true);
    expect(sim.spots.ownerOf(destination!.id)).toBe(support.id);
    expect(sim.chars.size).toBe(1);
    expect(sim.ambient.chars.size).toBe(4);
    expect({ mode: worker.mode, status: worker.info.status, step: worker.step, queue: [...worker.queue], stats: { ...worker.info.stats } }).toEqual(before);
  });

  it('rotates visitor identity only after elevator departure and cooldown', () => {
    const { sim } = makeSim();
    const visitor = characters(sim).find((ch) => ch.info.role === 'Visitante')!;
    const originalId = visitor.id;
    const originalName = visitor.info.name;
    applyQueuedArrival(sim, visitor);
    visitor.thinkAt = OPEN;
    const state = (sim.ambient as unknown as { states: Map<string, { shiftEndsAt: number }> }).states.get(visitor.id)!;
    state.shiftEndsAt = OPEN;

    sim.update(1, OPEN + 1);
    expect(visitor.queue.some((step) => step.t === 'elevIn')).toBe(true);
    expect(visitor.queue.some((step) => step.t === 'remove')).toBe(true);
    expect(visitor.id).toBe(originalId);
    expect(visitor.info.name).toBe(originalName);

    for (let i = 2; i < 20 && sim.ambient.chars.has(originalId); i++) sim.update(1, OPEN + i * 1000);
    expect(sim.ambient.chars.has(originalId)).toBe(false);
    sim.ambient.sync(OPEN + 7 * 60_000);
    expect(characters(sim).filter((ch) => ch.info.role === 'Visitante')).toHaveLength(0);
    sim.ambient.sync(OPEN + 16 * 60_000);
    const replacement = characters(sim).find((ch) => ch.info.role === 'Visitante');
    expect(replacement).toBeDefined();
    expect(replacement?.id).not.toBe(originalId);
    expect(replacement?.info.name).not.toBe(originalName);
    expect(replacement?.queue[0]?.t).toBe('elevOut');
  });

  it('moves a project-room visitor into the ghost office and lets them leave before teardown', () => {
    const { sim } = makeSim();
    const support = characters(sim).find((ch) => ch.info.role === 'Equipe de apoio')!;
    applyQueuedArrival(sim, support);
    const info = workingAgent('real:worker', '/ambient-project');
    sim.applySnapshot({ ...emptySnapshot(), rev: 2, rooms: [projectRoom(info.roomId)], agents: [info] }, OPEN + 100);
    const worker = placeWorkerAtDesk(sim, info.id, info.roomId);
    const state = (sim.ambient as unknown as { states: Map<string, { nextOfficeVisitAt: number }> }).states.get(support.id)!;
    state.nextOfficeVisitAt = OPEN;
    expect(sim.ambient.plan(support, OPEN + 10 * 60_000)).toBe(true);
    applyQueuedArrival(sim, support);
    expect(sim.ambient.occupantsInRoom(sim.rooms.get(info.roomId)!.layout.rect)).toBe(1);
    sim.chars.delete(worker.id);

    const room = sim.rooms.get(info.roomId)!;
    sim.moveRoom(room, 1, OPEN + 11 * 60_000);
    const ghost = [...sim.rooms.values()].find((candidate) => candidate.ghost)!;
    expect(sim.spots.get(support.atSpot)?.areaId).toBe(ghost.id);
    expect(sim.ambient.occupantsInRoom(ghost.layout.rect)).toBe(1);

    for (let i = 0; i < 600 && sim.ambient.occupantsInRoom(ghost.layout.rect) > 0; i++) {
      sim.update(1 / 30, OPEN + 11 * 60_000 + i * (1000 / 30));
    }
    expect(sim.ambient.occupantsInRoom(ghost.layout.rect)).toBe(0);
    expect(sim.spots.reservedBy(support.id).some((id) => sim.spots.get(id)?.areaId === ghost.id)).toBe(false);
  });
});
