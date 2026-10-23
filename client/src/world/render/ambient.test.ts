import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../../../../shared/types';
import type { Appearance, Sprite } from '../../art/api';
import { Character } from '../sim/character';
import { Renderer, type HeadInfo } from './renderer';

describe('renderização das pessoas do cenário', () => {
  it('desenha o personagem sem criar alvo de sessão, alerta ou efeito de trabalho', () => {
    const sprite = { canvas: { width: 2, height: 2, getContext: () => null }, ax: 1, ay: 2 } as unknown as Sprite;
    const drawImage = vi.fn();
    const drawAlertRing = vi.fn();
    const drawRing = vi.fn();
    const characterSprite = vi.fn(() => sprite);
    const heads = new Map<string, HeadInfo>();
    const ambientHeads = new Map<string, HeadInfo>();
    const residents = new Map<string, Character>();
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      ctx: { drawImage, globalAlpha: 1 }, heads, ambientHeads,
      sim: { chars: new Map(), ambient: { chars: residents } },
      art: { characterSprite, poseFrameCount: () => 1, poseFrameDuration: () => 500 },
      req: {}, theme: 'none', drawAlertRing, drawRing,
    }) as Renderer;
    const ch = new Character({ id: 'ambient:recepcao', seed: 42, roomId: 'core:recepcao', name: 'Clara', role: 'Recepcionista · ambiente' } as AgentInfo, {} as Appearance);
    ch.placeAtTile(10, 4);
    ch.seated = true;
    ch.mode = 'wait';
    ch.icon = 'alert';
    residents.set(ch.id, ch);

    // A referência passa pelas opções que normalmente acionariam anéis e ícones de sessão.
    (renderer as unknown as { drawCharacter: (ch: Character, now: number, sel: { agent: string | null; hover: string | null }, ambient: boolean) => void }).drawCharacter(ch, 1000, { agent: ch.id, hover: ch.id }, true);

    expect(characterSprite).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledOnce();
    expect(heads.has(ch.id)).toBe(false);
    expect(ambientHeads.get(ch.id)).toMatchObject({ visible: true, bw: 2, bh: 2 });
    expect(drawAlertRing).not.toHaveBeenCalled();
    expect(drawRing).not.toHaveBeenCalled();

    residents.clear();
    renderer.pruneHeads();
    expect(ambientHeads.size).toBe(0);
  });
});
