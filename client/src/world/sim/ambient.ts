// Pessoas do cenário do escritório: personagens locais, sem sessões nem atividades externas.
import type { AgentInfo } from '../../../../shared/types';
import { hash32, mulberry32 } from '../../../../shared/hash';
import type { ArtModule, Dir, HeldItem, Pose } from '../../art/api';
import type { WorldOptions } from '../api';
import type { BuildingLayout } from '../layout/building';
import { CAFE_ID, LOUNGE_ID, RECEPTION_ID, RESTROOM_ID } from '../layout/core';
import { inRect } from '../layout/geometry';
import type { SpotDef, SpotKind, TileRect } from '../layout/types';
import type { PathFinder } from '../path/astar';
import { Character } from './character';
import type { Elevator } from './elevator';
import type { SpotRegistry } from './spots';
import type { Step } from './steps';

export interface AmbientAgentPosition {
  readonly roomId: string;
  readonly tx: number;
  readonly ty: number;
}

export interface AmbientHost {
  readonly spots: SpotRegistry;
  readonly building: BuildingLayout;
  readonly finder: PathFinder;
  readonly stallBusy: Set<string>;
  readonly elevators: readonly Elevator[];
  readonly now: number;
  workingAgentPositions(): readonly AmbientAgentPosition[];
  isAgentNameInUse(name: string): boolean;
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
const VISITORS: readonly ResidentSpec[] = [
  {
    id: 'ambient:visitor:lia', name: 'Lia', role: 'Visitante', rosterRole: 'visitor', look: 'f', seed: 0x41a2,
    startArea: RECEPTION_ID, staticSeatPose: 'read',
  },
  {
    id: 'ambient:visitor:maya', name: 'Maya', role: 'Visitante', rosterRole: 'visitor', look: 'f', seed: 0x2bd5,
    startArea: RECEPTION_ID, staticSeatPose: 'read',
  },
  {
    id: 'ambient:visitor:theo', name: 'Theo', role: 'Visitante', rosterRole: 'visitor', look: 'm', seed: 0xb781,
    startArea: RECEPTION_ID, staticSeatPose: 'read',
  },
];
const SUPPORT_STAFF: readonly ResidentSpec[] = [
  { id: 'ambient:support:ravi', name: 'Ravi', role: 'Equipe de apoio', rosterRole: 'support', look: 'm', seed: 0x72b3, startArea: CAFE_ID, staticSeatPose: 'sit' },
  { id: 'ambient:support:cecilia', name: 'Cecília', role: 'Equipe de apoio', rosterRole: 'support', look: 'f', seed: 0x93c4, startArea: LOUNGE_ID, staticSeatPose: 'read' },
  { id: 'ambient:support:caio', name: 'Caio', role: 'Equipe de apoio', rosterRole: 'support', look: 'm', seed: 0x56e2, startArea: CAFE_ID, staticSeatPose: 'sit' },
  { id: 'ambient:support:ines', name: 'Inês', role: 'Equipe de apoio', rosterRole: 'support', look: 'f', seed: 0x8a13, startArea: LOUNGE_ID, staticSeatPose: 'read' },
];
const RECEPTIONIST: ResidentSpec = {
  id: 'ambient:receptionist', name: 'Nina', role: 'Recepcionista', rosterRole: 'receptionist', look: 'f', seed: 0x25d1,
  startArea: RECEPTION_ID, fixed: true, staticSeatPose: 'read',
};
const ROSTER_POOLS: Readonly<Record<RosterRole, readonly ResidentSpec[]>> = {
  visitor: VISITORS,
  support: SUPPORT_STAFF,
};
const ROSTER_TARGETS: Readonly<Record<RosterRole, number>> = { visitor: 1, support: 2 };
const PUBLIC_AREAS = [RECEPTION_ID, CAFE_ID, LOUNGE_ID] as const;
const PROJECT_SOCIAL_SPOTS: readonly SpotKind[] = ['nook', 'stool'];
const QUIET_SEATED: readonly Pose[] = ['sit', 'read', 'wait'];
const MIN_STAY_MS = 2 * 60_000;
const MAX_STAY_MS = 5 * 60_000;
const MIN_VISITOR_STAY_MS = 20 * 60_000;
const MAX_VISITOR_STAY_MS = 45 * 60_000;
const MIN_SHIFT_MS = 150 * 60_000;
const MAX_SHIFT_MS = 240 * 60_000;
const MIN_REPLACEMENT_COOLDOWN_MS = 8 * 60_000;
const MAX_REPLACEMENT_COOLDOWN_MS = 15 * 60_000;
const MIN_ROOM_COOLDOWN_MS = 8 * 60_000;
const MAX_ROOM_COOLDOWN_MS = 15 * 60_000;
const ERRAND_MIN_MS = 15 * 60_000;
const ERRAND_MAX_MS = 25 * 60_000;

interface ResidentSpec {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly rosterRole: RosterRole | 'receptionist';
  readonly look: 'f' | 'm';
  readonly seed: number;
  readonly startArea: string;
  readonly fixed?: boolean;
  readonly staticSeatPose: Pose;
}

type RosterRole = 'visitor' | 'support';

interface ResidentState {
  readonly spec: ResidentSpec;
  readonly lastSpotByArea: Map<string, string>;
  readonly staticPose: Pose;
  readonly recentAreas: string[];
  poseIndex: number;
  nextRestroomAt: number;
  nextOfficeVisitAt: number;
  shiftEndsAt: number;
  officeRoomId: string | null;
  visitRoomId: string | null;
  forceExitRoomId: string | null;
  departing: boolean;
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
  private readonly roomVisitors = new Map<string, string>();
  private readonly roomCooldownUntil = new Map<string, number>();
  private readonly replacementAt = new Map<RosterRole, number>();
  private readonly lastDepartureAt = new Map<string, number>();
  private roster: ResidentSpec[] = [];
  private rosterDay = '';
  private rosterRng: () => number = () => 0.5;
  private departingId: string | null = null;
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
    const day = this.dayKey(now);
    if (day !== this.rosterDay) this.selectDailyRoster(now);
    if (!this.running) {
      this.running = true;
      this.reducedMotion = reducedMotion;
      this.retryAt = now;
    } else if (reducedMotion !== this.reducedMotion) {
      // Preserve each person and their current position when the motion preference changes.
      this.reducedMotion = reducedMotion;
      if (reducedMotion) for (const [id, ch] of this.chars) {
        const state = this.states.get(id);
        if (state && !ch.step && !ch.queue.length) ch.setPose(state.staticPose, 'none');
      }
    }
    this.cleanupGone(now);
    for (const state of this.states.values()) {
      if (state.spec.rosterRole !== 'receptionist' && !state.departing && this.host.isAgentNameInUse(state.spec.name)) {
        state.shiftEndsAt = Math.min(state.shiftEndsAt, now);
      }
    }
    this.fillRoster(now);
    if (this.chars.size < this.roster.length && now >= this.retryAt) {
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
    if (state.shiftEndsAt <= now && this.departingId === null && this.planDeparture(ch, state)) return true;
    if (state.forceExitRoomId) return this.planPublicVisit(ch, state, now, true);
    if (state.spec.rosterRole === 'support' && now >= state.nextOfficeVisitAt) {
      if (this.planOfficeVisit(ch, state, now)) return true;
      state.nextOfficeVisitAt = now + 2 * 60_000;
    }
    return this.planPublicVisit(ch, state, now, false);
  }

  /** Mantém os caminhos já enfileirados válidos quando as salas de projeto mudam. */
  relayout(): void {
    for (const [id, ch] of this.chars) {
      const state = this.states.get(id);
      let invalid = false;
      const at = this.host.spots.get(ch.atSpot);
      if (ch.atSpot && !at) {
        ch.atSpot = null;
        ch.seated = false;
        ch.sortY = null;
        this.host.spots.releaseAll(ch.id);
        if (state?.officeRoomId) state.forceExitRoomId = state.officeRoomId;
        invalid = true;
      }
      let fromX = ch.tx;
      let fromY = ch.ty;
      if (ch.step?.t === 'go') {
        invalid = !this.refreshPath(ch.step, fromX, fromY) || invalid;
        fromX = ch.step.tx;
        fromY = ch.step.ty;
      }
      for (const step of ch.queue) {
        if (step.t === 'go') {
          invalid = !this.refreshPath(step, fromX, fromY) || invalid;
          fromX = step.tx;
          fromY = step.ty;
        } else if (step.t === 'enter') {
          const spot = this.host.spots.get(step.spot);
          if (spot) {
            fromX = spot.tx;
            fromY = spot.ty;
          } else invalid = true;
        }
      }
      if (invalid) this.cancelPlan(ch, state, this.host.now, true);
    }
  }

  /** Evacua visitantes quando uma sala deixa de ser listada, sem tocar no estado de agentes. */
  roomUnavailable(roomId: string, now: number): void {
    for (const [id, ch] of this.chars) {
      const state = this.states.get(id);
      if (!state || state.forceExitRoomId === roomId) continue;
      const targetsRoom = state.visitRoomId === roomId || state.officeRoomId === roomId
        || [...(ch.step ? [ch.step, ...ch.queue] : ch.queue)].some((step) =>
          step.t === 'enter' && this.host.spots.get(step.spot)?.areaId === roomId);
      if (targetsRoom) this.cancelPlan(ch, state, now, true);
    }
  }

  /** Preserva o cômodo antigo como uma sala fantasma até os visitantes saírem dele. */
  roomMoved(roomId: string, ghostId: string, alias: ReadonlyMap<string, string>, oldRect: TileRect, now: number): void {
    for (const [id, ch] of this.chars) {
      const state = this.states.get(id);
      if (!state) continue;
      const current = this.host.spots.get(ch.atSpot);
      const atOldSpot = !!current && current.areaId === roomId;
      const inOldRoom = inRect(oldRect, ch.tx, ch.ty);
      const plannedForRoom = state.visitRoomId === roomId || state.officeRoomId === roomId
        || [...(ch.step ? [ch.step, ...ch.queue] : ch.queue)].some((step) =>
          (step.t === 'enter' && this.host.spots.get(step.spot)?.areaId === roomId)
          || (step.t === 'go' && inRect(oldRect, step.tx, step.ty)));
      if (!plannedForRoom && !inOldRoom && !atOldSpot) continue;

      let nextSpotId = ch.atSpot;
      if (nextSpotId && alias.has(nextSpotId)) nextSpotId = alias.get(nextSpotId)!;
      const nextSpot = this.host.spots.get(nextSpotId);
      this.cancelPlan(ch, state, now, false);
      if (nextSpot && inOldRoom) {
        if (ch.atSpot && ch.atSpot !== nextSpot.id) this.host.spots.release(ch.atSpot, ch.id);
        ch.atSpot = nextSpot.id;
        ch.x = nextSpot.x;
        ch.y = nextSpot.y;
        ch.tx = nextSpot.tx;
        ch.ty = nextSpot.ty;
        ch.dir = nextSpot.dir;
        ch.seated = !!nextSpot.seated;
        ch.sortY = nextSpot.sortY ?? null;
      }
      if (inOldRoom || atOldSpot) {
        state.officeRoomId = ghostId;
        state.forceExitRoomId = ghostId;
      } else {
        state.officeRoomId = null;
        state.forceExitRoomId = null;
      }
      state.visitRoomId = null;
      this.finishRoomVisit(id, roomId, now);
    }
  }

  /** Só impede a desmontagem enquanto um ambient está fisicamente dentro da sala. */
  occupantsInRoom(rect: TileRect): number {
    let count = 0;
    for (const ch of this.chars.values()) if (!ch.gone && !ch.inside && inRect(rect, ch.tx, ch.ty)) count++;
    return count;
  }

  /** Limpa personagens, reservas e qualquer cabine que um passo interrompido deixou ocupada. */
  clear(): void {
    for (const [id, ch] of this.chars) {
      const stall = this.stallByCharacter.get(id);
      if (stall) this.host.stallBusy.delete(stall);
      this.host.spots.releaseAll(id);
      for (const elevator of this.host.elevators) elevator.release(id, this.host.now);
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
    this.roomVisitors.clear();
    this.roomCooldownUntil.clear();
    this.departingId = null;
    this.restroomOwner = null;
    this.running = false;
    this.retryAt = 0;
  }

  /** Timelapse pode saltar por cima de uma cabine ou do instante de fechamento. */
  fastForward(now: number): void {
    this.clear();
    this.sync(now);
  }

  /** Remove moradores que concluíram uma saída e abre a vaga após o tempo de retorno. */
  cleanupGone(now: number): void {
    for (const [id, ch] of this.chars) {
      if (!ch.gone) continue;
      const state = this.states.get(id);
      const stall = this.stallByCharacter.get(id);
      if (stall) this.host.stallBusy.delete(stall);
      this.host.spots.releaseAll(id);
      for (const elevator of this.host.elevators) elevator.release(id, now);
      if (state?.visitRoomId) this.finishRoomVisit(id, state.visitRoomId, now);
      if (state?.departing) {
        this.roster = this.roster.filter((spec) => spec.id !== id);
        this.lastDepartureAt.set(id, now);
        this.replacementAt.set(state.spec.rosterRole as RosterRole, now + this.randomCooldown(now, MIN_REPLACEMENT_COOLDOWN_MS, MAX_REPLACEMENT_COOLDOWN_MS, ch.rng));
        if (this.departingId === id) this.departingId = null;
      }
      this.stallByCharacter.delete(id);
      this.states.delete(id);
      this.chars.delete(id);
    }
  }

  /** Permite que testes e Sim contem só a presença física ambient para evitar remover o piso sob ela. */
  isInRoom(roomId: string): boolean {
    const room = this.host.building.rooms.find((area) => area.id === roomId);
    return !!room && this.occupantsInRoom(room.rect) > 0;
  }

  private createMissing(now: number): void {
    for (const spec of this.roster) {
      if (this.chars.has(spec.id)) continue;
      if (spec.rosterRole !== 'receptionist' && this.host.isAgentNameInUse(spec.name)) continue;
      const spot = spec.fixed
        ? this.initialSpot(spec.startArea, ['reception_staff'])
        : this.initialSpot(spec.startArea, SPOTS_BY_AREA[spec.startArea] ?? []);
      if (!spot || !this.host.spots.reserve(spot.id, spec.id)) continue;

      const elevator = spec.fixed || this.reducedMotion ? null : this.leastBusyElevator();
      const elevatorSpot = elevator ? this.host.spots.get(elevator.spotId) : undefined;
      const arrival = elevator && elevatorSpot ? this.route(elevatorSpot.tx, elevatorSpot.ty, spot) : null;
      if (!spec.fixed && !this.reducedMotion && (!elevator || !elevatorSpot || !arrival)) {
        this.host.spots.release(spot.id, spec.id);
        continue;
      }

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
        recentAreas: [spot.areaId],
        poseIndex: 0,
        nextRestroomAt: now + this.randomCooldown(now, ERRAND_MIN_MS, ERRAND_MAX_MS, ch.rng),
        nextOfficeVisitAt: now + 4 * 60_000 + ch.rng() * 4 * 60_000,
        shiftEndsAt: spec.rosterRole === 'receptionist' ? Number.POSITIVE_INFINITY
          : spec.rosterRole === 'visitor' ? now + MIN_VISITOR_STAY_MS + ch.rng() * (MAX_VISITOR_STAY_MS - MIN_VISITOR_STAY_MS)
          : now + MIN_SHIFT_MS + ch.rng() * (MAX_SHIFT_MS - MIN_SHIFT_MS),
        officeRoomId: null,
        visitRoomId: null,
        forceExitRoomId: null,
        departing: false,
      });
      if (!spec.fixed && elevator && elevatorSpot && arrival) this.queueArrival(ch, this.states.get(ch.id)!, spot, elevator, elevatorSpot, arrival, now);
    }
  }

  private dayKey(now: number): string {
    const date = new Date(now);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  private selectDailyRoster(now: number): void {
    this.rosterDay = this.dayKey(now);
    this.rosterRng = mulberry32(hash32(`ambient-office:${this.rosterDay}`));
    this.roster = [RECEPTIONIST];
    this.replacementAt.clear();
    this.lastDepartureAt.clear();
    for (const role of ['visitor', 'support'] as const) {
      const count = ROSTER_TARGETS[role];
      const available = ROSTER_POOLS[role].filter((spec) => !this.host.isAgentNameInUse(spec.name));
      const candidates = [...available];
      while (this.roster.filter((spec) => spec.rosterRole === role).length < count && candidates.length) {
        const index = Math.floor(this.rosterRng() * candidates.length);
        this.roster.push(candidates.splice(index, 1)[0]);
      }
    }
  }

  private fillRoster(now: number): void {
    if (this.departingId) return;
    for (const role of ['visitor', 'support'] as const) {
      const count = this.roster.filter((spec) => spec.rosterRole === role).length;
      if (count >= ROSTER_TARGETS[role] || now < (this.replacementAt.get(role) ?? 0)) continue;
      const activeIds = new Set(this.roster.map((spec) => spec.id));
      const pool = ROSTER_POOLS[role].filter((spec) => !activeIds.has(spec.id) && !this.host.isAgentNameInUse(spec.name));
      const rested = pool.filter((spec) => now - (this.lastDepartureAt.get(spec.id) ?? -Infinity) >= 60 * 60_000);
      const choices = rested.length ? rested : pool;
      if (!choices.length) continue;
      const next = choices[Math.floor(this.rosterRng() * choices.length)];
      this.roster.push(next);
      this.replacementAt.delete(role);
    }
  }

  private randomCooldown(_now: number, min: number, max: number, rng: () => number): number {
    return min + rng() * (max - min);
  }

  private leastBusyElevator(): Elevator | null {
    if (!this.host.elevators.length) return null;
    return [...this.host.elevators].sort((a, b) => a.load - b.load || a.index - b.index)[0] ?? null;
  }

  private queueArrival(ch: Character, state: ResidentState, spot: SpotDef, elevator: Elevator, elevatorSpot: SpotDef, arrival: Extract<Step, { t: 'go' }>, now: number): void {
    ch.placeAtTile(elevatorSpot.tx, elevatorSpot.ty);
    ch.x = elevatorSpot.x;
    ch.y = elevatorSpot.y - 6;
    ch.alpha = 0;
    ch.inside = true;
    ch.arriving = true;
    ch.hiddenUntil = elevator.reserveAppear(now);
    ch.queue.push(
      { t: 'elevOut', elev: elevator.index, phase: 0 },
      arrival,
      { t: 'enter', spot: spot.id },
      { t: 'do', fn: () => { ch.arriving = false; } },
      this.pauseStep(ch, spot, state),
    );
  }

  private planDeparture(ch: Character, state: ResidentState): boolean {
    const elevator = this.leastBusyElevator();
    const spot = elevator && this.host.spots.get(elevator.spotId);
    const route = spot ? this.route(ch.tx, ch.ty, spot) : null;
    if (!elevator || !spot || !route) {
      state.shiftEndsAt = this.host.now + 30_000;
      return false;
    }
    const steps: Step[] = [];
    this.appendExit(ch, steps);
    steps.push(route, { t: 'elevIn', elev: elevator.index, phase: 0 }, { t: 'remove' });
    ch.queue.push(...steps);
    ch.leaving = true;
    state.departing = true;
    this.departingId = ch.id;
    return true;
  }

  private planPublicVisit(ch: Character, state: ResidentState, now: number, forceExit: boolean): boolean {
    if (!forceExit && now >= state.nextRestroomAt) {
      const nextArea = this.chooseNextPublicArea(ch, state, this.areaAt(ch));
      if (nextArea && this.planRestroomVisit(ch, state, nextArea)) {
        this.rememberArea(state, RESTROOM_ID);
        this.rememberArea(state, nextArea);
        state.lastSpotByArea.set(nextArea, this.host.spots.reservedBy(ch.id)
          .map((id) => this.host.spots.get(id))
          .find((spot) => spot?.areaId === nextArea)?.id ?? '');
        state.nextRestroomAt = now + this.randomCooldown(now, ERRAND_MIN_MS, ERRAND_MAX_MS, ch.rng);
        return true;
      }
      state.nextRestroomAt = now + 3 * 60_000;
    }

    const areaId = this.chooseNextPublicArea(ch, state, this.areaAt(ch));
    if (!areaId) {
      ch.thinkAt = now + 30_000;
      return true;
    }
    const destination = this.chooseSpot(ch, state, areaId, SPOTS_BY_AREA[areaId] ?? [], ch.tx, ch.ty);
    if (!destination || !this.host.spots.reserve(destination.spot.id, ch.id)) {
      if (forceExit) {
        ch.thinkAt = now + 15_000;
        return true;
      }
      return this.pauseHere(ch, state, now);
    }

    this.queueMove(ch, state, destination, {
      afterArrival: () => {
        if (state.forceExitRoomId) state.forceExitRoomId = null;
        if (state.officeRoomId && state.officeRoomId !== areaId) state.officeRoomId = null;
        state.officeRoomId = null;
      },
    });
    this.rememberArea(state, areaId);
    state.lastSpotByArea.set(areaId, destination.spot.id);
    return true;
  }

  private planOfficeVisit(ch: Character, state: ResidentState, now: number): boolean {
    const targets = this.host.workingAgentPositions().filter((target) => {
      const room = this.host.building.rooms.find((area) => area.id === target.roomId);
      return !!room && !room.id.includes('#mudança')
        && now >= (this.roomCooldownUntil.get(target.roomId) ?? 0)
        && !this.roomVisitors.has(target.roomId);
    });
    if (!targets.length) return false;
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(ch.rng() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }

    for (const target of targets) {
      const destination = this.chooseSocialSpot(ch, state, target, ch.tx, ch.ty);
      if (!destination || !this.host.spots.reserve(destination.spot.id, ch.id)) continue;
      this.roomVisitors.set(target.roomId, ch.id);
      state.visitRoomId = target.roomId;
      state.officeRoomId = target.roomId;
      state.forceExitRoomId = null;
      this.queueMove(ch, state, destination, {
        talkTo: target,
        afterPause: () => this.finishRoomVisit(ch.id, target.roomId, this.host.now),
      });
      state.lastSpotByArea.set(target.roomId, destination.spot.id);
      state.nextOfficeVisitAt = now + this.randomCooldown(now, MIN_ROOM_COOLDOWN_MS, MAX_ROOM_COOLDOWN_MS, ch.rng);
      return true;
    }
    return false;
  }

  private chooseSocialSpot(ch: Character, state: ResidentState, target: AmbientAgentPosition, fromX: number, fromY: number): RoutedSpot | null {
    const viable: Array<RoutedSpot & { distance: number }> = [];
    for (const kind of PROJECT_SOCIAL_SPOTS) {
      for (const spot of this.host.spots.ofKind(kind)) {
        if (spot.areaId !== target.roomId || spot.id === ch.atSpot || !this.host.spots.isFree(spot.id) || !this.canUseProjectSocialSpot(spot)) continue;
        const go = this.route(fromX, fromY, spot);
        if (go) viable.push({ spot, go, distance: Math.abs(spot.tx - target.tx) + Math.abs(spot.ty - target.ty) });
      }
    }
    if (!viable.length) return null;
    viable.sort((a, b) => a.distance - b.distance);
    const nearest = viable.filter((candidate) => candidate.distance === viable[0].distance);
    const previous = state.lastSpotByArea.get(target.roomId);
    const fresh = previous ? nearest.filter((candidate) => candidate.spot.id !== previous) : nearest;
    const choices = fresh.length ? fresh : nearest;
    return choices[Math.floor(ch.rng() * choices.length)];
  }

  private chooseNextPublicArea(ch: Character, state: ResidentState, currentArea: string | undefined): string | null {
    const recent = new Set(state.recentAreas.slice(-2));
    const candidates = PUBLIC_AREAS.filter((area) => area !== currentArea);
    const weights = candidates.map((area) => {
      const support = state.spec.rosterRole === 'support';
      const base = area === CAFE_ID ? (support ? 4 : 3) : area === LOUNGE_ID ? (support ? 3 : 2) : 2;
      return base * (recent.has(area) ? 0.45 : 1);
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = ch.rng() * total;
    for (let i = 0; i < candidates.length; i++) {
      pick -= weights[i];
      if (pick < 0) return candidates[i];
    }
    return candidates[candidates.length - 1] ?? null;
  }

  private rememberArea(state: ResidentState, areaId: string): void {
    state.recentAreas.push(areaId);
    if (state.recentAreas.length > 4) state.recentAreas.shift();
  }

  private areaAt(ch: Character): string | undefined {
    return this.host.spots.get(ch.atSpot)?.areaId
      ?? this.host.building.rooms.find((room) => inRect(room.rect, ch.tx, ch.ty))?.id
      ?? this.host.building.core.find((area) => inRect(area.rect, ch.tx, ch.ty))?.id;
  }

  private finishRoomVisit(id: string, roomId: string, now: number): void {
    if (this.roomVisitors.get(roomId) === id) this.roomVisitors.delete(roomId);
    this.roomCooldownUntil.set(roomId, now + MIN_ROOM_COOLDOWN_MS + (this.chars.get(id)?.rng() ?? 0.5) * (MAX_ROOM_COOLDOWN_MS - MIN_ROOM_COOLDOWN_MS));
    const state = this.states.get(id);
    if (state?.visitRoomId === roomId) state.visitRoomId = null;
  }

  private cancelPlan(ch: Character, state: ResidentState | undefined, now: number, forceExit: boolean): void {
    const completingDeparture = state?.departing && (
      ch.step?.t === 'elevIn' || ch.step?.t === 'remove' || (ch.inside && ch.queue[0]?.t === 'remove')
    );
    if (completingDeparture) {
      // Once a character has entered the elevator, let the existing remove step finish.
      ch.replan = false;
      return;
    }

    const oldVisit = state?.visitRoomId;
    const oldOffice = state?.officeRoomId;
    if (oldVisit) this.finishRoomVisit(ch.id, oldVisit, now);

    if (state?.departing) {
      state.departing = false;
      state.shiftEndsAt = now + 30_000;
      if (this.departingId === ch.id) this.departingId = null;
      ch.leaving = false;
    }

    const arrivalStep = ch.step?.t === 'elevOut'
      ? ch.step
      : !ch.step && ch.queue[0]?.t === 'elevOut' ? ch.queue[0] : null;
    if (arrivalStep) {
      // Finish the elevator animation, but discard the now-invalid destination reservation and route.
      ch.queue.length = 0;
      if (ch.step !== arrivalStep) ch.queue.push(arrivalStep);
      ch.queue.push({ t: 'do', fn: () => { ch.arriving = false; } });
      this.host.spots.releaseAll(ch.id);
      ch.atSpot = null;
      ch.seated = false;
      ch.sortY = null;
      ch.replan = false;
      if (state) {
        state.visitRoomId = null;
        state.officeRoomId = null;
        state.forceExitRoomId = null;
      }
      ch.thinkAt = now;
      return;
    }

    const stallStep = ch.step?.t === 'stall' ? ch.step : null;
    if (stallStep) {
      // Preserve the active stall step until its normal exit animation completes. Keep its
      // reservation while occupied; release the sink and destination reservations now.
      for (const spotId of this.host.spots.reservedBy(ch.id)) {
        if (spotId !== stallStep.spot) this.host.spots.release(spotId, ch.id);
      }
      if (stallStep.phase === 0) stallStep.ms = Math.min(stallStep.ms, 2_000);
      else if (stallStep.phase === 1) ch.stallUntil = Math.min(ch.stallUntil ?? now + 2_000, now + 2_000);
      ch.queue.length = 0;
      ch.queue.push({ t: 'do', fn: () => {
        this.host.spots.releaseAll(ch.id);
        this.finishRestroom(ch.id);
      } });
      ch.replan = false;
      const physicalOffice = this.host.building.rooms.find((room) => inRect(room.rect, ch.tx, ch.ty))?.id;
      const exitRoom = physicalOffice ?? oldOffice ?? oldVisit;
      if (state) {
        state.visitRoomId = null;
        if (forceExit && exitRoom) {
          state.officeRoomId = exitRoom;
          state.forceExitRoomId = exitRoom;
        } else {
          state.officeRoomId = physicalOffice ?? null;
          state.forceExitRoomId = null;
        }
      }
      ch.thinkAt = now;
      return;
    }

    const wasArriving = ch.arriving;
    ch.queue.length = 0;
    ch.step = null;
    ch.stepStarted = false;
    ch.replan = false;
    const currentSpot = ch.atSpot;
    this.host.spots.releaseAll(ch.id);
    if (wasArriving) {
      ch.atSpot = null;
      ch.seated = false;
      ch.sortY = null;
      ch.arriving = false;
    } else if (currentSpot && this.host.spots.get(currentSpot) && !this.host.spots.ownerOf(currentSpot)) {
      this.host.spots.reserve(currentSpot, ch.id);
    }
    if (this.restroomOwner === ch.id || this.stallByCharacter.has(ch.id)) this.finishRestroom(ch.id);
    const physicalOffice = this.host.building.rooms.find((room) => inRect(room.rect, ch.tx, ch.ty))?.id;
    const exitRoom = physicalOffice ?? oldOffice ?? oldVisit;
    if (state) {
      state.visitRoomId = null;
      if (forceExit && exitRoom) {
        state.officeRoomId = exitRoom;
        state.forceExitRoomId = exitRoom;
      } else {
        state.officeRoomId = physicalOffice ?? null;
        state.forceExitRoomId = null;
      }
    }
    ch.thinkAt = now;
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
    if (!CORE_AREAS.has(areaId) && !this.host.building.rooms.some((room) => room.id === areaId && !room.id.includes('#mudança'))) return null;
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

  private canUseProjectSocialSpot(spot: SpotDef): boolean {
    if (!PROJECT_SOCIAL_SPOTS.includes(spot.kind)) return false;
    let free = 0;
    for (const candidate of this.host.spots.all()) {
      if (candidate.areaId === spot.areaId && PROJECT_SOCIAL_SPOTS.includes(candidate.kind)
        && candidate.seated && !this.host.spots.ownerOf(candidate.id)) free++;
    }
    return free > 1;
  }

  private route(fromX: number, fromY: number, spot: SpotDef): Extract<Step, { t: 'go' }> | null {
    const fromRoom = this.projectRoomAt(fromX, fromY);
    const toRoom = this.projectRoomAt(spot.tx, spot.ty);
    if (toRoom && toRoom !== spot.areaId) return null;
    const allowedRooms = new Set([fromRoom, toRoom].filter((id): id is string => !!id));
    if (!CORE_AREAS.has(spot.areaId) && !toRoom) return null;
    if (!this.isAmbientTile(fromX, fromY, allowedRooms) || !this.isAmbientTile(spot.tx, spot.ty, allowedRooms)) return null;
    const path: number[] = [];
    if (!this.host.finder.find(fromX, fromY, spot.tx, spot.ty, path)) return null;
    for (let i = 0; i < path.length; i += 2) if (!this.isAmbientTile(path[i], path[i + 1], allowedRooms)) return null;
    return { t: 'go', tx: spot.tx, ty: spot.ty, dir: spot.dir, path, i: 0 };
  }

  private projectRoomAt(tx: number, ty: number): string | undefined {
    return this.host.building.rooms.find((room) => inRect(room.rect, tx, ty))?.id;
  }

  private isAmbientTile(tx: number, ty: number, allowedRooms: ReadonlySet<string>): boolean {
    const rects = [
      ...this.host.building.core.filter((area) => CORE_AREAS.has(area.id)).map((area) => area.rect),
      this.host.building.corridor.rect,
    ];
    if (rects.some((rect) => inRect(rect, tx, ty))) return true;
    return this.host.building.rooms.some((room) => allowedRooms.has(room.id) && inRect(room.rect, tx, ty));
  }

  private refreshPath(step: Extract<Step, { t: 'go' }>, fromX: number, fromY: number): boolean {
    const allowedRooms = new Set([this.projectRoomAt(fromX, fromY), this.projectRoomAt(step.tx, step.ty)].filter((id): id is string => !!id));
    if (!this.isAmbientTile(fromX, fromY, allowedRooms) || !this.isAmbientTile(step.tx, step.ty, allowedRooms)) return false;
    const path: number[] = [];
    if (!this.host.finder.find(fromX, fromY, step.tx, step.ty, path)) return false;
    if (path.some((tile, i) => i % 2 === 0 && !this.isAmbientTile(tile, path[i + 1], allowedRooms))) return false;
    // Keep the last checked route if a layout change leaves no new route; deleting it
    // would make the shared executor fall back to an unchecked path or a teleport.
    step.path = path;
    step.i = 0;
    delete step.fine;
    return true;
  }

  private queueMove(ch: Character, state: ResidentState, destination: RoutedSpot, options: {
    talkTo?: AmbientAgentPosition;
    afterArrival?: () => void;
    afterPause?: () => void;
  } = {}): void {
    const steps: Step[] = [];
    this.appendExit(ch, steps);
    steps.push(destination.go, { t: 'enter', spot: destination.spot.id });
    if (options.afterArrival) steps.push({ t: 'do', fn: options.afterArrival });
    if (options.talkTo) {
      steps.push({
        t: 'act', pose: 'talk', ms: 20_000 + ch.rng() * 25_000,
        dir: this.faceDirection(destination.spot.tx, destination.spot.ty, options.talkTo.tx, options.talkTo.ty),
        seated: !!destination.spot.seated,
      });
    }
    steps.push(this.pauseStep(ch, destination.spot, state));
    if (options.afterPause) steps.push({ t: 'do', fn: options.afterPause });
    ch.queue.push(...steps);
  }

  private faceDirection(fromX: number, fromY: number, toX: number, toY: number): Dir {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
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
    const ms = MIN_STAY_MS + ch.rng() * (MAX_STAY_MS - MIN_STAY_MS);
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
    steps.push({ t: 'do', fn: () => { state.officeRoomId = null; state.forceExitRoomId = null; } });
    steps.push(this.pauseStep(ch, destination.spot, state));
    ch.queue.push(...steps);

    state.lastSpotByArea.set(nextArea, destination.spot.id);
    return true;
  }

  private appendExit(ch: Character, steps: Step[]): void {
    const previous = ch.atSpot;
    if (!previous) return;
    steps.push({ t: 'exit' }, { t: 'do', fn: () => this.host.spots.release(previous, ch.id) });
  }

  private finishRestroom(owner: string, sinkId?: string): void {
    if (sinkId) this.host.spots.release(sinkId, owner);
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
