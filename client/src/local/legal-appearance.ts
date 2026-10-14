import type { Appearance, HairStyle } from '../art/api';
import { mulberry32 } from '../../../shared/hash';
import { PART_KEYS, type AppearanceParts } from '../../../shared/appearance';

const SUITS = ['#2f3b55', '#3d4352', '#262a33', '#6b4a35', '#4a6a8a', '#7a2f3a'] as const;
const TROUSERS = ['#2c3655', '#2c2c35', '#2c2c35', '#6e4c38', '#6d7480', '#2c2c35'] as const;
const SHIRTS = ['#f4f4f0', '#d3e3f4', '#dfe3e8'] as const;
const HAIR = ['#2b2530', '#3f2c22', '#5f3c28', '#87593a', '#b0703c', '#d6ae68', '#8f929b'] as const;
const NEAT: readonly HairStyle[] = ['side_part', 'short', 'curly', 'afro', 'bob', 'bun', 'ponytail', 'wavy'];

/** Formal defaults; the caller applies saved editor choices afterwards. */
export function legalAppearance(base: Appearance, seed: number, parts?: AppearanceParts): Appearance {
  const rnd = mulberry32((seed ^ 0x1a77e5) >>> 0);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const outfit = Math.floor(rnd() * SUITS.length);
  const suit = SUITS[outfit];
  const shirt = pick(SHIRTS);
  const jacket = rnd() < .8;
  const hair = pick(HAIR);
  const hairStyle = pick(NEAT);
  const accessory = base.accessory === 'glasses' || base.accessory === 'earrings' ? base.accessory : 'none';
  const chosen = parts ? Object.fromEntries(PART_KEYS.filter((key) => parts[key] !== undefined).map((key) => [key, parts[key]])) : {};
  return {
    ...base,
    topStyle: jacket ? 'jacket' : 'shirt_tie',
    top: jacket ? suit : shirt,
    topAccent: jacket ? '#f4f4f0' : '#7b2d44',
    bottom: TROUSERS[outfit],
    bottomStyle: base.bottomStyle === 'skirt' ? 'skirt' : 'pants',
    shoes: '#2b2b33',
    hair: /^#(e47aa8|5b8fe0|8f6ad8|3fb3a0|e0584e|7cc45a|f0a24a)$/i.test(base.hair) ? hair : base.hair,
    hairStyle: ['spiky', 'mohawk', 'pigtails'].includes(base.hairStyle) ? hairStyle : base.hairStyle,
    accessory,
    accessoryColor: accessory === 'none' ? '#2b2b33' : base.accessoryColor,
    lanyard: base.lanyard ? '#f2b33d' : null,
    ...chosen,
  };
}
