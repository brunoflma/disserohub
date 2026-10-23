import { describe, expect, it } from 'vitest';
import { appearanceFromSeed, editorOptions } from '../art/character/appearance';
import { PART_KEYS } from '../../../shared/appearance';
import { renderFurniture } from '../art/furniture';
import { FURNITURE } from '../art/api';
import { roomTheme } from '../art/theme';
import { layoutCafe, layoutLounge, layoutReception, layoutRestroom } from '../world/layout/core';
import { layoutProjectRoom } from '../world/layout/room';
import { seasonalThemeFor } from '../world/api';
import { legalAppearance } from './legal-appearance';

describe('legal office presentation', () => {
  it('keeps identity and uses deterministic formal defaults across 200 seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const base = appearanceFromSeed(seed, { sub: true });
      const a = legalAppearance(base, seed);
      expect(a).toEqual(legalAppearance(base, seed));
      expect([a.skin, a.eyes, a.look, a.facialHair]).toEqual([base.skin, base.eyes, base.look, base.facialHair]);
      expect(['jacket', 'shirt_tie']).toContain(a.topStyle);
      expect(['pants', 'skirt']).toContain(a.bottomStyle);
      expect(['none', 'glasses', 'earrings']).toContain(a.accessory);
      expect(a.lanyard).not.toBeNull();
      const choices = editorOptions(a);
      for (const key of PART_KEYS) expect(choices[key]).toContain(a[key]);
    }
  });
  it('honors saved editor choices and ignores explicit undefined parts', () => {
    const base = appearanceFromSeed(42);
    const parts = { topStyle: 'hoodie' as const, hairStyle: 'afro' as const, top: '#e2604f', shoes: undefined };
    const a = legalAppearance(base, 42, parts);
    expect(a.topStyle).toBe('hoodie');
    expect(a.top).toBe(parts.top);
    expect(a.hairStyle).toBe('afro');
    expect(a.shoes).toBeDefined();
    expect(parts).toEqual({ topStyle: 'hoodie', hairStyle: 'afro', top: '#e2604f', shoes: undefined });
  });
  it('retains skin diversity and curly and afro hairstyles', () => {
    const people = Array.from({ length: 500 }, (_, seed) => legalAppearance(appearanceFromSeed(seed), seed));
    expect(new Set(people.map((p) => p.skin)).size).toBe(8);
    expect(people.some((p) => p.hairStyle === 'afro')).toBe(true);
    expect(people.some((p) => p.hairStyle === 'curly')).toBe(true);
  });
  it('disables seasonal costumes in legal mode without changing calendar mode', () => {
    expect(seasonalThemeFor('legal', new Date(2026, 9, 13))).toBe('none');
    expect(seasonalThemeFor('auto', new Date(2026, 9, 13))).toBe('halloween');
  });
  it('replaces recreational furniture with a usable library and meeting area', () => {
    const area = layoutLounge();
    expect(area.furniture.some((f) => f.kind === 'pingpong_table' || f.kind === 'arcade' || f.kind === 'beanbag')).toBe(false);
    expect(area.spots.some((s) => ['pingpong', 'arcade', 'watch'].includes(s.kind))).toBe(false);
    expect(area.furniture.some((f) => f.kind === 'meeting_table' && f.variant === 'legal')).toBe(true);
    expect(area.furniture.some((f) => f.kind === 'bookshelf' && f.variant === 'legal')).toBe(true);
    expect(area.spots.filter((s) => s.kind === 'armchair').length).toBeGreaterThanOrEqual(5);
  });
  it('keeps chairs in purposeful seating groups and none in the restroom', () => {
    const restroom = layoutRestroom();
    expect(restroom.spots.some((s) => s.seated)).toBe(false);
    expect(restroom.furniture.some((f) => ['bench', 'armchair', 'sofa', 'cafe_chair', 'stool', 'beanbag'].includes(f.kind))).toBe(false);
    expect(layoutCafe().spots.filter((s) => s.kind === 'cafe_seat')).toHaveLength(6);
    const reception = layoutReception();
    expect(reception.spots.filter((s) => s.seated && s.kind !== 'reception_staff')).toHaveLength(5);
    expect(reception.spots.filter((s) => s.seated && s.kind === 'reception_staff')).toHaveLength(1);
    expect(layoutLounge().spots.filter((s) => s.group === 'debate:library')).toHaveLength(4);
  });
  it('keeps project capacity, work spots and legal decoration across layouts', () => {
    for (let seed = 0; seed < 30; seed++) {
      const room = layoutProjectRoom({ id: `legal:${seed}`, slot: seed % 6, seed }, roomTheme(seed));
      expect(room.spots.filter((s) => s.kind === 'desk')).toHaveLength(6);
      expect(room.furniture.some((f) => f.kind === 'beanbag')).toBe(false);
      expect(room.wallItems.filter((w) => w.kind === 'poster').every((w) => w.variant?.startsWith('law_'))).toBe(true);
    }
  });
  it('keeps plants in corner zones across common areas and mirrored project layouts', () => {
    const areas = [layoutReception(), layoutRestroom(), layoutCafe(), layoutLounge()];
    for (let seed = 0; seed < 120; seed++) {
      areas.push(layoutProjectRoom({ id: `corners:${seed}`, slot: seed % 2, seed }, roomTheme(seed)));
    }
    for (const area of areas) {
      for (const f of area.furniture.filter((f) => f.kind === 'plant_small' || f.kind === 'plant_tall')) {
        const x = f.tx - area.rect.x;
        const y = f.ty - area.rect.y;
        expect((x <= 2 || x >= 13) && (y <= 3 || y >= 9), `${area.id}: plant at ${x},${y}`).toBe(true);
      }
    }
  });
  it('renders the common-area fixtures within their declared floor anchors', () => {
    for (const kind of ['washroom_vanity', 'hygiene_cabinet', 'magazine_rack'] as const) {
      const { base } = renderFurniture(kind);
      expect(base.buf.bounds()).not.toBeNull();
      expect(base.ax).toBeGreaterThan(0);
      expect(base.ax).toBeLessThan(base.buf.w);
      expect(base.ay).toBeGreaterThan(0);
      expect(base.ay).toBeLessThan(base.buf.h);
    }
  });
  it('renders all legal variants with the existing furniture footprints', () => {
    for (const kind of ['desk', 'desk_back', 'bookshelf', 'meeting_table'] as const) {
      expect(FURNITURE[kind].variants).toContain('legal');
      for (let seed = 0; seed < 6; seed++) {
        const sprite = renderFurniture(kind, 'legal', 0, seed);
        expect(sprite.base.buf.bounds()).not.toBeNull();
      }
    }
  });
});
