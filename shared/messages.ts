// Mensagens pelo escritório (POST /api/messages): o que o servidor, o demo e a página têm em comum.
// Código puro: sem APIs de Node nem de DOM.
import { maskSecrets, truncate, type ActivityDescription } from './activity';
import { tr } from './i18n';

/** Tamanho máximo de uma mensagem (caracteres). */
export const MESSAGE_MAX = 20_000;
/** Stable tool identifier for the message activity; retained for historical sessions. */
export const MESSAGE_TOOL = 'HabblaudMessage';
/** Detalhe da atividade: o começo do texto, mascarado e cortado (o texto inteiro vai só para a sessão). */
const DETAIL_MAX = 300;

/**
 * Atividade "Mensagem pelo Dissero" de uma mensagem entregue à sessão (entrou nela ou na fila dela: não quer dizer
 * que o agente já leu).
 */
export function describeMessage(text: string): ActivityDescription & { tool: string } {
  const detail = truncate(maskSecrets(text.slice(0, DETAIL_MAX * 4)), DETAIL_MAX);
  return { kind: 'communicate', icon: '✉️', text: tr('Mensagem pelo Dissero'), tool: MESSAGE_TOOL, ...(detail ? { detail } : {}) };
}
