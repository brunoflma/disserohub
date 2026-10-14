import { describeTool, type ActivityDescription } from '../../../shared/activity';
import type { Activity } from '../../../shared/types';

type Rec = Record<string, unknown>;
const LIMIT = 128;
const toolKind = (name: string) => /^(?:functions\.)?request_user_input(_async)?$/.exec(name);
const object = (v: unknown): Rec | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** Os dois formatos do Codex usam a mesma apresentação, já mascarada, do AskUserQuestion. */
export function codexQuestionDescription(name: string, input: Rec): ActivityDescription | undefined {
  if (!toolKind(name) || !Array.isArray(input.questions)) return;
  const questions = input.questions.slice(0, 4).map((raw) => {
    const q = object(raw) ?? {};
    return {
      ...q,
      question: q.question ?? q.title,
      options: Array.isArray(q.options) ? q.options.slice(0, 6).map((o) => typeof o === 'string' ? { label: o } : o) : [],
    };
  });
  const desc = describeTool('AskUserQuestion', { questions });
  return desc.questions?.length ? desc : undefined;
}

function accepted(raw: unknown): boolean {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return false; }
  }
  return object(raw)?.accepted === true;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value);
  if (map.size > LIMIT) map.delete(map.keys().next().value!);
}

interface PendingQuestion { activity: Activity; async: boolean }

/** Estado separado da atividade atual: uma pergunta assíncrona pode coexistir com outras ferramentas. */
export class CodexQuestions {
  private pending = new Map<string, PendingQuestion>();
  // Respostas e resultados também podem estar na janela final, antes de carregarmos a chamada do prefixo.
  private replies = new Map<string, Set<number>>();
  private outputs = new Map<string, boolean>();
  private turnEndAt = -1;

  get waiting(): boolean { return this.pending.size > 0; }
  activities(): Activity[] { return [...this.pending.values()].map((q) => q.activity); }

  start(callId: string | undefined, name: string, input: Rec, at: number, prefix: string): boolean {
    const desc = codexQuestionDescription(name, input);
    if (!callId || !desc) return false;
    const q: PendingQuestion = { activity: { id: `${prefix}#${callId}`, at, ...desc, tool: name }, async: !!toolKind(name)?.[1] };
    const remaining = this.remaining(callId, q);
    if (!remaining) return false;
    // Hook + rollout da mesma chamada não voltam a criar perguntas respondidas nem mudam sua identidade.
    if (this.pending.has(callId)) return false;
    remember(this.pending, callId, remaining);
    return true;
  }

  complete(callId: string | undefined, output: unknown): boolean {
    if (!callId) return false;
    const ack = accepted(output);
    remember(this.outputs, callId, (this.outputs.get(callId) ?? true) && ack);
    const q = this.pending.get(callId);
    // accepted:true só confirma a criação do cartão; não representa uma resposta do usuário.
    return q && (!q.async || !ack) ? this.pending.delete(callId) : false;
  }

  /** Envelope realmente gravado pelo app ao responder ou pular uma pergunta assíncrona. */
  reply(text: string): boolean {
    const match = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(text);
    if (!match || match[1].length > 256_000) return false;
    let raw: unknown;
    try { raw = JSON.parse(match[1]); } catch { return false; }
    const records = Array.isArray(raw) ? raw : object(raw) ? [raw] : [];
    let changed = false;
    for (const r of records.slice(0, LIMIT)) {
      const encoded = object(r)?.questionItemId;
      if (typeof encoded !== 'string' || encoded.length > 500) continue;
      let id: unknown;
      try { id = JSON.parse(encoded); } catch { continue; }
      if (!Array.isArray(id) || id.length !== 3 || typeof id[0] !== 'string' || !toolKind(id[0])?.[1] || typeof id[1] !== 'string' || !id[1] || !Number.isInteger(id[2]) || id[2] < 0 || id[2] >= 4) continue;
      const callId = id[1];
      const indices = this.replies.get(callId) ?? new Set<number>();
      indices.add(id[2]);
      remember(this.replies, callId, indices);
      const q = this.pending.get(callId);
      if (!q || !q.activity.questions?.some((question) => question.index === id[2])) continue;
      const remaining = this.remaining(callId, q);
      if (remaining) this.pending.set(callId, remaining);
      else this.pending.delete(callId);
      changed = true;
    }
    return changed;
  }

  /** O app só apresenta perguntas do turno em andamento; fim/interrupção encerra seus cartões. */
  endTurn(at: number): void {
    this.turnEndAt = Math.max(this.turnEndAt, at);
    for (const [id, q] of this.pending) if (q.activity.at <= this.turnEndAt) this.pending.delete(id);
  }

  /** Reconstrói perguntas antigas sem desfazer respostas ou conclusões já lidas na janela final/ao vivo. */
  merge(prefix: CodexQuestions): boolean {
    this.turnEndAt = Math.max(this.turnEndAt, prefix.turnEndAt);
    for (const [id, indices] of prefix.replies) {
      remember(this.replies, id, new Set([...indices, ...(this.replies.get(id) ?? [])]));
    }
    for (const [id, ack] of prefix.outputs) remember(this.outputs, id, (this.outputs.get(id) ?? true) && ack);
    let changed = false;
    for (const [id, q] of this.pending) {
      const remaining = this.remaining(id, q);
      if (remaining === q) continue;
      if (remaining) this.pending.set(id, remaining);
      else this.pending.delete(id);
      changed = true;
    }
    for (const [id, q] of prefix.pending) {
      if (this.pending.has(id)) continue;
      const remaining = this.remaining(id, q);
      if (!remaining) continue;
      remember(this.pending, id, remaining);
      changed = true;
    }
    return changed;
  }

  private remaining(id: string, q: PendingQuestion): PendingQuestion | undefined {
    if (q.activity.at <= this.turnEndAt || (this.outputs.has(id) && (!q.async || !this.outputs.get(id)))) return;
    const replied = this.replies.get(id);
    const questions = q.activity.questions?.filter((question) => !replied?.has(question.index)) ?? [];
    if (!questions.length) return;
    return questions.length === q.activity.questions?.length ? q : { ...q, activity: { ...q.activity, questions } };
  }
}
