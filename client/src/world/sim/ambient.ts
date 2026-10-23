// Pessoas do cenário do escritório: personagens locais, sem sessões nem atividades externas.
import type { AgentInfo } from '../../../../shared/types';
import type { ArtModule, HeldItem, Pose } from '../../art/api';
import type { WorldOptions } from '../api';
import type { BuildingLayout } from '../layout/building';
import { CAFE_ID, LOUNGE_ID, RECEPTION_ID, RESTROOM_ID } from '../layout/core';
import type { SpotDef, SpotKind } from '../layout/types';
import type { PathFinder } from '../path/astar';
import { Character } from './character';
import type { SpotRegistry } from './spots';
import type { Step } from './steps';

export interface AmbientHost {
  readonly spots: SpotRegistry;
  readonly building: BuildingLayout;
  readonly finder: PathFinder;
  readonly stallBusy: Set<string>;
}

const CORE_AREAS = new Set([RECEPTION_ID, CAFE_ID, LOUNGE_ID, RESTROOM_ID]);
const SEATS: Readonly<Record<string, ReadonlySet<SpotKind>>> = {
  [RECEPTION_ID]: new Set(['bench', 'armchair', 'sofa']),
  [CAFE_ID]: new Set(['cafe_seat']),
  [LOUNGE_ID]: new Set(['sofa', 'armchair', 'beanbag']),
};
const SPOTS_BY_AREA: Readonly<Record<string, readonly SpotKind[]>> = {
  [RECEPTION_ID]: ['sofa', 'armchair', 'bench', 'water', 'talk'],
  [CAFE_ID]: ['cafe_seat', 'coffee', 'water', 'snack', 'window', 'talk'],
  [LOUNGE_ID]: ['sofa', 'armchair', 'beanbag', 'shelf', 'talk', 'window'],
};
const ROAMERS: readonly ResidentSpec[] = [
  {
    id: 'ambient:visitor', name: 'Lia', role: 'Visitante · ambiente', look: 'f', seed: 0x41a2,
    startArea: RECEPTION_ID, nextAreas: [CAFE_ID, RESTROOM_ID, LOUNGE_ID, RECEPTION_ID], staticSeatPose: 'read',
  },
  {
    id: 'ambient:support-1', name: 'Ravi', role: 'Equipe de apoio · ambiente', look: 'm', seed: 0x72b3,
    startArea: CAFE_ID, nextAreas: [LOUNGE_ID, RECEPTION_ID, RESTROOM_ID, CAFE_ID], staticSeatPose: 'sit',
  },
  {
    id: 'ambient:support-2', name: 'Cecília', role: 'Equipe de apoio · ambiente', look: 'f', seed: 0x93c4,
    startArea: LOUNGE_ID, nextAreas: [RECEPTION_ID, CAFE_ID, RESTROOM_ID, LOUNGE_ID], staticSeatPose: 'read',
  },
];
const RECEPTIONIST: ResidentSpec = {
  id: 'ambient:receptionist', name: 'Nina', role: 'Recepcionista · ambiente', look: 'f', seed: 0x25d1,
  startArea: RECEPTION_ID, fixed: true, staticSeatPose: 'read',
};
const RESIDENTS = [RECEPTIONIST, ...ROAMERS] as const;
const QUIET_SEATED: readonly Pose[] = ['sit', 'read', 'wait'];

interface ResidentSpec {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly look: 'f' | 'm';
  readonly seed: number;
  readonly startArea: string;
  readonly nextAreas?: readonly string[];
  readonly fixed?: boolean;
  readonly staticSeatPose: Pose;
}

interface ResidentState {
  readonly spec: ResidentSpec;
  readonly lastSpotByArea: Map<string, string>;
  readonly staticPose: Pose;
  nextAreaIndex: number;
  poseIndex: number;
}

interface RoutedSpot {
  readonly spot: SpotDef;
  readonly go: Extract<Step, { t: 'go' }>;
}

/** Semana útil local, das 08:00 inclusive às 18:00 exclusive. */
export function isBusinessHours(now: number): boolean {
  if (!Number.isFinite(now)) return false;
  const date = new Date(now);
  const day = date.getDay();
  const minute = date.getHours() * 60 + date.getMinutes();
  return day !== 0 && day !== 6 && minute >= 8 * 60 && minute < 18 * 60;
}

export class AmbientOffice {
  readonly chars = new Map<string, Character>();
  private readonly states = new Map<string, ResidentState>();
  private readonly stallByCharacter = new Map<string, string>();
  private restroomOwner: string | null = null;
  private running = false;
  private reducedMotion = false;
  private retryAt = 0;

  constructor(
    private readonly art: ArtModule,
    private readonly host: AmbientHost,
    private readonly options: () => WorldOptions,
  ) {}

  /** Cria ou remove a população de acordo com o expediente e as preferências atuais. */
  sync(now: number): void {
    const opts = this.options();
    if (opts.ambientLife === false || !isBusinessHours(now)) {
      this.clear();
      return;
    }

    const reducedMotion = opts.reducedMotion === true;
    if (!this.running || reducedMotion !== this.reducedMotion) {
      this.clear();
      this.running = true;
      this.reducedMotion = reducedMotion;
      this.retryAt = now;
    }
    if (this.chars.size < RESIDENTS.length && now >= this.retryAt) {
      this.createMissing(now);
      this.retryAt = now + 15_000;
    }
  }

  /** Planeja a próxima pausa ou passeio apenas para personagens desta população. */
  plan(ch: Character, now: number): boolean {
    const state = this.states.get(ch.id);
    if (!state || this.chars.get(ch.id) !== ch) return false;

    if (this.reducedMotion) {
      ch.setPose(state.staticPose, 'none');
      ch.thinkAt = now + 60_000;
      return true;
    }
    if (state.spec.fixed) return this.planReceptionist(ch, state, now);

    const areas = state.spec.nextAreas!;
    const areaId = areas[state.nextAreaIndex % areas.length];
    if (areaId === RESTROOM_ID) {
      if (this.planRestroomVisit(ch, state, areas[(state.nextAreaIndex + 1) % areas.length])) return true;
      state.nextAreaIndex++;
      return this.pauseHere(ch, state, now);
    }

    const destination = this.chooseSpot(ch, state, areaId, SPOTS_BY_AREA[areaId] ?? [], ch.tx, ch.ty);
    if (!destination || !this.host.spots.reserve(destination.spot.id, ch.id)) {
      state.nextAreaIndex++;
      return this.pauseHere(ch, state, now);
    }

    this.queueMove(ch, state, destination);
    state.nextAreaIndex++;
    state.lastSpotByArea.set(areaId, destination.spot.id);
    return true;
  }

  /** Mantém os caminhos já enfileirados válidos quando as salas de projeto mudam. */
  relayout(): void {
    for (const ch of this.chars.values()) {
      let fromX = ch.tx;
      let fromY = ch.ty;
      if (ch.step?.t === 'go') {
        this.refreshPath(ch.step, fromX, fromY);
        fromX = ch.step.tx;
        fromY = ch.step.ty;
      }
      for (const step of ch.queue) {
        if (step.t === 'go') {
          this.refreshPath(step, fromX, fromY);
          fromX = step.tx;
          fromY = step.ty;
        } else if (step.t === 'enter') {
          const spot = this.host.spots.get(step.spot);
          if (spot) {
            fromX = spot.tx;
            fromY = spot.ty;
          }
        }
      }
    }
  }

  /** Limpa personagens, reservas e qualquer cabine que um passo interrompido deixou ocupada. */
  clear(): void {
    for (const [id, ch] of this.chars) {
      const stall = this.stallByCharacter.get(id);
      if (stall) this.host.stallBusy.delete(stall);
      this.host.spots.releaseAll(id);
      ch.queue.length = 0;
      ch.step = null;
      ch.stepStarted = false;
      ch.atSpot = null;
      ch.seated = false;
      ch.inside = false;
      ch.alpha = 1;
      ch.sortY = null;
      ch.stallUntil = 0;
      ch.gone = true;
    }
    this.chars.clear();
    this.states.clear();
    this.stallByCharacter.clear();
    this.restroomOwner = null;
    this.running = false;
    this.retryAt = 0;
  }

  /** Timelapse pode saltar por cima de uma cabine ou do instante de fechamento. */
  fastForward(now: number): void {
    this.clear();
    this.sync(now);
  }

  private createMissing(now: number): void {
    for (const spec of RESIDENTS) {
      if (this.chars.has(spec.id)) continue;
      const spot = spec.fixed
        ? this.initialSpot(spec.startArea, ['reception_staff'])
        : this.initialSpot(spec.startArea, SPOTS_BY_AREA[spec.startArea] ?? []);
      if (!spot || !this.host.spots.reserve(spot.id, spec.id)) continue;

      const info: AgentInfo = {
        id: spec.id,
        kind: 'main',
        roomId: spec.startArea,
        name: spec.name,
        look: spec.look,
        role: spec.role,
        sessionId: '',
        account: '',
        status: 'idle',
        recent: [],
        tasks: [],
        startedAt: now,
        lastEventAt: now,
        statusSince: now,
        stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
        seed: spec.seed,
      };
      const appearance = { ...this.art.appearanceFromSeed(spec.seed, { look: spec.look }), lanyard: null };
      const ch = new Character(info, appearance);
      ch.mode = 'idle';
      this.placeAtSpot(ch, spot);
      const staticPose: Pose = spot.seated ? spec.staticSeatPose : 'stand';
      ch.setPose(staticPose, staticPose === 'read' ? 'book' : staticPose === 'type' ? 'laptop' : 'none');
      ch.thinkAt = now + 20_000 + ch.rng() * 40_000;
      this.chars.set(ch.id, ch);
      this.states.set(ch.id, {
        spec,
        lastSpotByArea: new Map([[spot.areaId, spot.id]]),
        staticPose,
        nextAreaIndex: 0,
        poseIndex: 0,
      });
    }
  }

  private initialSpot(areaId: string, kinds: readonly SpotKind[]): SpotDef | null {
    if (!CORE_AREAS.has(areaId)) return null;
    for (const kind of kinds) {
      for (const spot of this.host.spots.ofKind(kind)) {
        if (spot.areaId !== areaId || !this.host.spots.isFree(spot.id)) continue;
        if (!this.canUseSeat(spot)) continue;
        if (!this.route(spot.tx, spot.ty, spot)) continue;
        return spot;
      }
    }
    return null;
  }

  private chooseSpot(ch: Character, state: ResidentState, areaId: string, kinds: readonly SpotKind[], fromX: number, fromY: number): RoutedSpot | null {
    if (!CORE_AREAS.has(areaId)) return null;
    for (const kind of kinds) {
      const viable: RoutedSpot[] = [];
      for (const spot of this.host.spots.ofKind(kind)) {
        if (spot.areaId !== areaId || spot.id === ch.atSpot || !this.host.spots.isFree(spot.id)) continue;
        if (!this.canUseSeat(spot)) continue;
        const go = this.route(fromX, fromY, spot);
        if (go) viable.push({ spot, go });
      }
      if (!viable.length) continue;
      const previous = state.lastSpotByArea.get(areaId);
      const fresh = previous ? viable.filter((candidate) => candidate.spot.id !== previous) : viable;
      const choices = fresh.length ? fresh : viable;
      return choices[Math.floor(ch.rng() * choices.length)];
    }
    return null;
  }

  private canUseSeat(spot: SpotDef): boolean {
    if (!SEATS[spot.areaId]?.has(spot.kind)) return true;
    let free = 0;
    for (const seat of this.host.spots.all()) {
      if (seat.areaId === spot.areaId && SEATS[spot.areaId].has(seat.kind) && seat.seated && !this.host.spots.ownerOf(seat.id)) free++;
    }
    // Keep one available seat in each public area after reserving this destination.
    return free > 1;
  }

  private route(fromX: number, fromY: number, spot: SpotDef): Extract<Step, { t: 'go' }> | null {
    if (!CORE_AREAS.has(spot.areaId) || !this.isCoreTile(fromX, fromY) || !this.isCoreTile(spot.tx, spot.ty)) return null;
    const path: number[] = [];
    if (!this.host.finder.find(fromX, fromY, spot.tx, spot.ty, path)) return null;
    for (let i = 0; i < path.length; i += 2) if (!this.isCoreTile(path[i], path[i + 1])) return null;
    return { t: 'go', tx: spot.tx, ty: spot.ty, dir: spot.dir, path, i: 0 };
  }

  private isCoreTile(tx: number, ty: number): boolean {
    const rects = [
      ...this.host.building.core.filter((area) => CORE_AREAS.has(area.id)).map((area) => area.rect),
      this.host.building.corridor.rect,
    ];
    return rects.some((rect) => tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h);
  }

  private refreshPath(step: Extract<Step, { t: 'go' }>, fromX: number, fromY: number): void {
    if (!this.isCoreTile(fromX, fromY) || !this.isCoreTile(step.tx, step.ty)) return;
    const path: number[] = [];
    if (!this.host.finder.find(fromX, fromY, step.tx, step.ty, path)) return;
    if (path.some((tile, i) => i % 2 === 0 && !this.isCoreTile(tile, path[i + 1]))) return;
    // Keep the last checked route if a layout change leaves no new route; deleting it
    // would make the shared executor fall back to an unchecked path or a teleport.
    step.path = path;
    step.i = 0;
    delete step.fine;
  }

  private queueMove(ch: Character, state: ResidentState, destination: RoutedSpot): void {
    const steps: Step[] = [];
    this.appendExit(ch, steps);
    steps.push(destination.go, { t: 'enter', spot: destination.spot.id });
    steps.push(this.pauseStep(ch, destination.spot, state));
    ch.queue.push(...steps);
  }

  private planReceptionist(ch: Character, state: ResidentState, now: number): boolean {
    const spot = this.host.spots.get(ch.atSpot);
    if (!spot) {
      ch.setPose('stand');
      ch.thinkAt = now + 15_000;
      return true;
    }
    const poses: readonly Pose[] = ['sit', 'read', 'type'];
    const pose = poses[state.poseIndex++ % poses.length];
    ch.queue.push({
      t: 'act', pose, ms: 20_000 + ch.rng() * 40_000, dir: spot.dir,
      held: pose === 'read' ? 'book' : pose === 'type' ? 'laptop' : 'none', seated: true,
    });
    return true;
  }

  private pauseHere(ch: Character, state: ResidentState, now: number): boolean {
    const spot = this.host.spots.get(ch.atSpot);
    if (!spot) {
      ch.setPose('stand');
      ch.thinkAt = now + 15_000;
      return true;
    }
    ch.queue.push(this.pauseStep(ch, spot, state));
    return true;
  }

  private pauseStep(ch: Character, spot: SpotDef, state: ResidentState): Extract<Step, { t: 'act' }> {
    const ms = 20_000 + ch.rng() * 40_000;
    if (!spot.seated) {
      const held: HeldItem = spot.kind === 'coffee' ? 'coffee' : spot.kind === 'water' ? 'water' : 'book';
      return { t: 'act', pose: spot.kind === 'water' || spot.kind === 'coffee' ? 'drink' : 'read', held, dir: spot.dir, ms };
    }
    const pose = QUIET_SEATED[state.poseIndex++ % QUIET_SEATED.length];
    return { t: 'act', pose, held: pose === 'read' ? 'book' : 'none', dir: spot.dir, ms, seated: true };
  }

  private planRestroomVisit(ch: Character, state: ResidentState, nextArea: string): boolean {
    if (this.restroomOwner && this.restroomOwner !== ch.id) return false;
    const stall = this.chooseSpot(ch, state, RESTROOM_ID, ['stall'], ch.tx, ch.ty);
    if (!stall) return false;
    const sink = this.chooseSpot(ch, state, RESTROOM_ID, ['sink'], stall.spot.tx, stall.spot.ty);
    if (!sink) return false;
    const destination = this.chooseSpot(ch, state, nextArea, SPOTS_BY_AREA[nextArea] ?? [], sink.spot.tx, sink.spot.ty);
    if (!destination) return false;

    const reservations = [stall.spot, sink.spot, destination.spot];
    const reserved: string[] = [];
    for (const spot of reservations) {
      if (!this.host.spots.reserve(spot.id, ch.id)) {
        for (const id of reserved) this.host.spots.release(id, ch.id);
        return false;
      }
      reserved.push(spot.id);
    }

    const stallFurniture = stall.spot.furnitureId ?? stall.spot.id;
    this.restroomOwner = ch.id;
    this.stallByCharacter.set(ch.id, stallFurniture);
    const steps: Step[] = [];
    this.appendExit(ch, steps);
    steps.push(stall.go, { t: 'stall', spot: stall.spot.id, ms: 5_000 + ch.rng() * 7_000, phase: 0 });
    steps.push({ t: 'do', fn: () => this.host.spots.release(stall.spot.id, ch.id) });
    steps.push(sink.go, { t: 'enter', spot: sink.spot.id });
    steps.push({ t: 'act', pose: 'groom', dir: sink.spot.dir, ms: 2_500 + ch.rng() * 2_500 });
    steps.push({ t: 'exit' });
    steps.push({ t: 'do', fn: () => this.finishRestroom(ch.id, sink.spot.id) });
    steps.push(destination.go, { t: 'enter', spot: destination.spot.id });
    steps.push(this.pauseStep(ch, destination.spot, state));
    ch.queue.push(...steps);

    state.nextAreaIndex += 2;
    state.lastSpotByArea.set(nextArea, destination.spot.id);
    return true;
  }

  private appendExit(ch: Character, steps: Step[]): void {
    const previous = ch.atSpot;
    if (!previous) return;
    steps.push({ t: 'exit' }, { t: 'do', fn: () => this.host.spots.release(previous, ch.id) });
  }

  private finishRestroom(owner: string, sinkId: string): void {
    this.host.spots.release(sinkId, owner);
    const stall = this.stallByCharacter.get(owner);
    if (stall) this.host.stallBusy.delete(stall);
    this.stallByCharacter.delete(owner);
    if (this.restroomOwner === owner) this.restroomOwner = null;
  }

  private placeAtSpot(ch: Character, spot: SpotDef): void {
    ch.placeAtTile(spot.tx, spot.ty);
    ch.x = spot.x;
    ch.y = spot.y;
    ch.dir = spot.dir;
    ch.atSpot = spot.id;
    ch.seated = !!spot.seated;
    ch.sortY = spot.sortY ?? null;
    ch.setPose(spot.seated ? 'sit' : 'stand');
  }
}
