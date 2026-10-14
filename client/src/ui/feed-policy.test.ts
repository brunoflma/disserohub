import { describe, expect, it } from 'vitest';
import type { Activity, FeedItem } from '../../../shared/types';
import {
  FEED_GROUP_WINDOW_MS,
  activityDisplayText,
  groupFeedItems,
  isImportantActivity,
  isImportantFeedItem,
  sanitizeActivityText,
} from './feed-policy';

function activity(id: string, patch: Partial<Activity> = {}): Activity {
  return { id, kind: 'read', icon: '📖', text: 'Lendo um arquivo', at: 0, ...patch };
}

function feed(id: string, agentId = 'a', patch: Partial<Activity> = {}): FeedItem {
  return {
    id, agentId, agentName: agentId, roomId: 'room', roomName: 'Sala',
    activity: activity(id, patch),
  };
}

describe('política do feed', () => {
  it('usa tipos estruturados para Importantes e reconhece os marcadores estreitos', () => {
    expect(isImportantActivity(activity('ask', { kind: 'ask', icon: '❓', text: 'Precisa de você' }))).toBe(true);
    expect(isImportantActivity(activity('wait', { kind: 'wait', icon: '✋', text: 'Aguardando' }))).toBe(true);
    expect(isImportantActivity(activity('error', { kind: 'error', error: true, icon: '⚠️', text: 'Falhou' }))).toBe(true);
    expect(isImportantActivity(activity('done', { kind: 'done', icon: '✅', text: 'Concluiu' }))).toBe(true);
    expect(isImportantActivity(activity('shell', { kind: 'run', tool: 'ShellDone', icon: '✅', text: 'Shell terminou' }))).toBe(true);
    expect(isImportantActivity(activity('arrival', { kind: 'other', icon: '👋', text: 'Ana chegou' }))).toBe(true);
    expect(isImportantActivity(activity('thinking', { kind: 'think', icon: '💭', text: 'Pensando…' }))).toBe(false);
    expect(isImportantActivity(activity('reading', { kind: 'read' }))).toBe(false);
    expect(isImportantActivity(activity('searching', { kind: 'search' }))).toBe(false);
    expect(isImportantActivity(activity('social', { kind: 'other', icon: '🎲', text: 'Jogando' }))).toBe(false);
    expect(isImportantFeedItem(feed('social:1', 'a', { kind: 'done', icon: '✅', text: 'Concluiu' }))).toBe(false);
  });

  it('agrupa só o mesmo agente e atividade dentro da janela curta', () => {
    const first = feed('one', 'a', { kind: 'read', icon: '📖', text: 'Lendo', at: 100 });
    const second = feed('two', 'a', { kind: 'read', icon: '📖', text: 'Lendo', at: 100 + FEED_GROUP_WINDOW_MS - 1 });
    const outside = feed('three', 'a', { kind: 'read', icon: '📖', text: 'Lendo', at: 100 + FEED_GROUP_WINDOW_MS + 1 });
    const rows = groupFeedItems([first, second, outside]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('one');
    expect(rows[0].repeatCount).toBe(2);
    expect(rows[0].items).toEqual([first, second]);
    expect(rows[1].item).toBe(outside);
    expect(groupFeedItems([first, feed('other-agent', 'b', { kind: 'read', icon: '📖', text: 'Lendo', at: 101 })])).toHaveLength(2);
  });

  it('remove blocos de infraestrutura na apresentação e preserva detalhe cru', () => {
    const raw = 'Pergunta <in-app-browser-context>não mostrar</in-app-browser-context> depois';
    expect(sanitizeActivityText(raw)).toBe('Pergunta depois');
    expect(sanitizeActivityText('<environment_context>segredo</environment_context>\n## Skills\ninstruções\n## Usuário\nOlá')).toBe('## Usuário\nOlá');

    const detail = 'npm test -- feed';
    const a = activity('ambient', { text: '<system>ignore</system>', detail });
    expect(activityDisplayText(a)).toBe(detail);
    expect(a.detail).toBe(detail);
  });

  it('humaniza cua_repl e comunica erro de comando sem declarar falha da tarefa', () => {
    expect(activityDisplayText(activity('browser', { kind: 'browser', tool: 'cua_repl', text: 'cua_repl' }))).toBe('Navegando no navegador');
    expect(activityDisplayText(activity('failed', { kind: 'error', error: true, text: 'A tarefa inteira falhou' }))).toBe('Último comando falhou');
  });
});
