// Local presentation policy shared by DOM panels and canvas, without UI dependencies.
import type { Activity, ActivityKind, FeedItem } from '../../../shared/types';
import { tr } from '../../../shared/i18n';

/** Janela curta em que atividades semanticamente iguais continuam sendo uma linha. */
export const FEED_GROUP_WINDOW_MS = 10_000;

const AMBIENT_TAG_NAMES = [
  'in-app-browser-context',
  'environment_context',
  'environment-context',
  'system',
  'system-instructions',
  'developer',
  'developer-instructions',
  'skill',
  'skills',
  'tool-context',
  'browser-context',
] as const;
const AMBIENT_TAG = AMBIENT_TAG_NAMES.join('|');
const CLOSED_AMBIENT_BLOCK = new RegExp(`<(${AMBIENT_TAG})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
const OPEN_AMBIENT_BLOCK = new RegExp(`<(${AMBIENT_TAG})\\b[^>]*>[\\s\\S]*$`, 'gi');
const FENCED_AMBIENT_BLOCK = /```(?:system|developer|skills?|environment[_ -]?context)\b[\s\S]*?```/gi;

function isAmbientSectionHeading(line: string): boolean {
  return /^\s*(?:#{1,6}\s*)?(?:skills?|system(?:\s+instructions?)?|developer(?:\s+instructions?)?|environment(?:[_ -]context)?|in-app-browser-context)\s*:?[ \t]*$/i.test(line);
}

function stripAmbientSections(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let inAmbientSection = false;
  for (const line of lines) {
    if (isAmbientSectionHeading(line)) {
      inAmbientSection = true;
      continue;
    }
    if (inAmbientSection && /^\s*#{1,6}\s+\S/.test(line)) inAmbientSection = false;
    if (!inAmbientSection) kept.push(line);
  }
  return kept.join('\n');
}

/** Remove blocos de contexto/instruções injetados apenas na cópia exibida. */
export function sanitizePresentationText(input: unknown): string {
  if (typeof input !== 'string' || !input) return '';
  let text = input.replace(CLOSED_AMBIENT_BLOCK, '').replace(OPEN_AMBIENT_BLOCK, '').replace(FENCED_AMBIENT_BLOCK, '');
  text = stripAmbientSections(text);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Sanitiza texto de atividade para apresentação sem modificar o objeto recebido. */
export function sanitizeActivityText(text: string): string {
  return sanitizePresentationText(text);
}

/** Nome alternativo explícito para consumidores que sanitizam texto vindo de uma sessão. */
export const sanitizeUserText = sanitizePresentationText;

function escapeRegExp(value: string): string {
  return value.replace(/[\^$.*+?()[\]{}|]/g, '\\$&');
}

function looksOpaqueToolName(value: string): boolean {
  return /^(?:mcp__)?[a-z0-9][a-z0-9_.:-]*(?:[_-][a-z0-9_.:-]+|__[a-z0-9_.:-]+)+$/i.test(value);
}

function titleCase(value: string): string {
  return value.replace(/[._-]+/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** Humaniza nomes de ferramenta que escaparam do descritor estruturado do servidor. */
export function humanizeToolName(input: string): string {
  const raw = sanitizePresentationText(input).trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (/(^|__)cua[_-]?repl(?:$|__)/i.test(lower) || /playwright|puppeteer|browser|chrome/.test(lower)) {
    return tr('Navegando no navegador');
  }
  const parts = raw.replace(/^mcp__/i, '').split('__').filter(Boolean).map(titleCase);
  return tr('Ferramenta: {0}', [parts.join(': ') || raw]);
}

const KIND_FALLBACK: Partial<Record<ActivityKind, string>> = {
  prompt: 'Recebeu uma instrução',
  ask: 'Precisa de você',
  wait: 'Aguardando',
  done: 'Concluiu',
  error: 'Último comando falhou',
};

/** Texto curto da linha, sem transformar erro de comando em uma conclusão falsa da tarefa. */
export function activityDisplayText(activity: Activity): string {
  if (activity.error || activity.kind === 'error') return tr('Último comando falhou');

  const text = sanitizeActivityText(activity.text);
  const detail = sanitizeActivityText(activity.detail ?? '');
  const tool = sanitizeActivityText(activity.tool ?? '');
  if (activity.kind === 'prompt' && /^(?:Recebeu|Received)\s*[“"'…]*$/i.test(text)) return tr('Recebeu uma instrução');
  if (/^(?:mcp__)?cua[_-]?repl(?::\s*|__)\w+/i.test(text)) return tr('Navegando no navegador');
  if (tool && looksOpaqueToolName(tool)) {
    if (!text || text.toLowerCase() === tool.toLowerCase()) return humanizeToolName(tool);
    if (text.toLowerCase().includes(tool.toLowerCase())) {
      return text.replace(new RegExp(escapeRegExp(tool), 'gi'), humanizeToolName(tool));
    }
  }
  if (text && looksOpaqueToolName(text)) return humanizeToolName(text);
  return text || detail || tr(KIND_FALLBACK[activity.kind] ?? 'Atividade');
}

function isShellOutcome(activity: Pick<Activity, 'kind' | 'tool' | 'icon' | 'text'>): boolean {
  if (activity.tool?.toLowerCase() === 'shelldone') return true;
  if (activity.kind !== 'run') return false;
  return ['✅', '❌', '🛑'].includes(activity.icon) && /^\s*Shell\s+(?:terminou|falhou|interrompido)\b/i.test(activity.text);
}

/** Reconhece chegada/saída sem tratar qualquer atividade textual como um evento importante. */
export function isArrivalOrDepartureActivity(activity: Pick<Activity, 'kind' | 'tool' | 'icon' | 'text' | 'id'>): boolean {
  if (activity.kind !== 'other') return false;
  const marker = `${activity.tool ?? ''} ${activity.id}`.toLowerCase();
  if (/(?:arriv|depart|join|leave|offline|cheg|entr|sai|part)/.test(marker)) return true;
  if (!['👋', '🚪', '🏃'].includes(activity.icon)) return false;
  return /(?:cheg|entr|sai|part|foi embora|deixou o escrit|voltou)/i.test(activity.text);
}

/** Decide o modo Importantes a partir do tipo estruturado, com fallback estreito para marcadores conhecidos. */
export function isImportantActivity(activity: Pick<Activity, 'kind' | 'tool' | 'icon' | 'text' | 'error' | 'id'>): boolean {
  if (activity.error || activity.kind === 'ask' || activity.kind === 'wait' || activity.kind === 'error' || activity.kind === 'done') return true;
  if (activity.kind === 'prompt') return true;
  if (isShellOutcome(activity)) return true;
  return isArrivalOrDepartureActivity(activity);
}

/** Regra de importância no nível do feed: eventos sociais são sempre rotina no modo Importantes. */
export function isImportantFeedItem(item: FeedItem): boolean {
  return !item.id.startsWith('social:') && isImportantActivity(item.activity);
}

export interface FeedDisplayRow {
  /** Id do primeiro evento; mantém a chave DOM estável enquanto o grupo cresce. */
  readonly id: string;
  /** Último evento do grupo, usado para horário, texto e navegação. */
  readonly item: FeedItem;
  /** Eventos crus que compõem a linha exibida. */
  readonly items: readonly FeedItem[];
  readonly repeatCount: number;
}

function sameActivity(a: FeedItem, b: FeedItem): boolean {
  return a.agentId === b.agentId
    && a.roomId === b.roomId
    && a.account === b.account
    && a.activity.kind === b.activity.kind
    && a.activity.icon === b.activity.icon
    && a.activity.tool === b.activity.tool
    && a.activity.text === b.activity.text
    && !!a.activity.error === !!b.activity.error;
}

/** Agrupa apenas eventos consecutivos do mesmo agente e da mesma atividade dentro da janela curta. */
export function groupFeedItems(items: readonly FeedItem[], windowMs = FEED_GROUP_WINDOW_MS): FeedDisplayRow[] {
  const rows: FeedDisplayRow[] = [];
  const window = Math.max(0, windowMs);
  for (const item of items) {
    const previous = rows[rows.length - 1];
    const last = previous?.item;
    const delta = previous ? item.activity.at - previous.items[0].activity.at : Number.POSITIVE_INFINITY;
    if (previous && last && sameActivity(last, item) && delta >= 0 && delta <= window) {
      rows[rows.length - 1] = {
        ...previous,
        item,
        items: [...previous.items, item],
        repeatCount: previous.repeatCount + 1,
      };
    } else {
      rows.push({ id: item.id, item, items: [item], repeatCount: 1 });
    }
  }
  return rows;
}
