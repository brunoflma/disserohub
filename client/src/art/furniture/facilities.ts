// Purposeful common-area furnishings, with the same pixel scale and floor anchors as the office.
import { floorSheet, type BufFurniture } from '../core/sprite';
import { M, contact, frontFace, glass, papers, topFace } from './kit';

export function washroomVanity(): BufFurniture {
  const s = floorSheet(3, 1, 26);
  const b = s.buf;
  // A freestanding mirror and pale stone countertop, with closed storage below.
  b.rect(3, -24, 42, 22, M.steelDark.base);
  b.rect(5, -22, 38, 18, '#cfdee5');
  glass(b, 5, -22, 38, 18, { alpha: .7 });
  b.vline(24, -22, -5, M.steelDark.base);
  frontFace(b, 1, 5, 46, 11, M.white);
  for (const x of [16, 31]) b.vline(x, 6, 15, M.steel.dk);
  for (const x of [10, 24, 38]) b.rect(x, 8, 4, 1, M.steelDark.base);
  topFace(b, 0, -2, 48, 7, M.stone);
  b.ellipse(24, 1, 8, 2.5, '#fafaf6');
  b.ellipse(24, 1, 6, 1.5, '#bccfd6');
  b.rect(23, -5, 2, 5, M.steel.base);
  b.hline(23, 27, -5, '#f7f8f7');
  b.rect(5, -4, 3, 5, '#a3bfbd');
  b.hline(5, 8, -5, M.steelDark.base);
  b.rect(38, 0, 7, 3, '#f5f4ee');
  b.hline(38, 44, 1, '#d4dedf');
  b.outline();
  contact(b, 0, 14, 48, 3);
  return { base: s };
}

export function hygieneCabinet(): BufFurniture {
  const s = floorSheet(2, 1, 24);
  const b = s.buf;
  topFace(b, 1, -23, 30, 3, M.white);
  frontFace(b, 1, -20, 30, 36, M.white);
  b.rect(3, -18, 26, 17, '#8fa1a8');
  // Folded towels and sealed supplies on two open shelves.
  for (const y of [-16, -7]) {
    b.rect(5, y, 11, 5, '#f7f5ee');
    b.hline(5, 15, y + 2, '#d3dede');
    b.rect(19, y + 1, 7, 4, '#a3c2c5');
    b.hline(3, 28, y + 6, M.white.hi);
  }
  b.vline(15, 1, 15, M.steel.dk);
  b.rect(12, 5, 1, 4, M.steelDark.base);
  b.rect(18, 5, 1, 4, M.steelDark.base);
  b.outline();
  contact(b, 1, 14, 30, 3);
  return { base: s };
}

export function magazineRack(): BufFurniture {
  const s = floorSheet(1, 1, 15);
  const b = s.buf;
  b.rect(2, -13, 12, 26, M.walnut.base);
  for (const y of [-11, -3, 5]) {
    b.rect(3, y, 10, 7, M.walnut.dd);
    papers(b, 4, y + 1, 8, 5);
    b.rect(5, y + 2, 3, 2, '#33465a');
    b.hline(3, 12, y + 6, M.walnut.hi);
  }
  for (const x of [3, 12]) b.rect(x, 13, 1, 3, M.walnut.dd);
  b.outline();
  contact(b, 2, 14, 12, 3);
  return { base: s };
}
