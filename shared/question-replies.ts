// Async Codex questions are answered as user input, not as tool approvals.
import { checkAnswers } from './answers';
import type { Activity, PermissionAnswer } from './types';

export interface QuestionReply {
  agentId: string;
  activityId: string;
  answer: PermissionAnswer;
}

/** Blocking request_user_input needs its owning client; never queue an apparent tool result. */
export function isAsyncQuestion(activity: Activity): boolean {
  return /^(?:functions\.)?request_user_input_async$/.test(activity.tool ?? '');
}

/** Same user-message envelope recorded by the Codex app for an asynchronous question reply. */
export function questionReplyText(activity: Activity, raw: PermissionAnswer): string | undefined {
  if (!isAsyncQuestion(activity)) return;
  const question = activity.questions?.find(q => q.index === raw.question);
  const answer = question && checkAnswers([question], [raw])?.[0];
  const separator = activity.id.lastIndexOf('#');
  const callId = separator >= 0 ? activity.id.slice(separator + 1) : '';
  if (!question || !answer || !callId || callId.length > 500 || /[\s\x00]/.test(callId)) return;
  const labels = (answer.options ?? []).map(index => question.options.find(o => o.index === index)!.label);
  if (answer.other) labels.push(answer.other);
  const text = labels.join('\n');
  if (!text.trim() || text.includes('\0')) return;
  const reply = { questionItemId: JSON.stringify([activity.tool, callId, question.index]), answer: text };
  // Preserve arbitrary answer text without letting it create a literal envelope delimiter.
  const json = JSON.stringify(reply).replace(/</g, '\\u003c');
  return `<send_user_message_question_reply>\n${json}\n</send_user_message_question_reply>`;
}
