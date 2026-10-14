// Legal furniture uses the existing footprints and anchors.
import { floorSheet, type BufFurniture } from '../core/sprite';
import { M, book, contact, papers, topFace, woodGrain } from './kit';
import { desk, deskBack } from './office';

const COVERS = ['#33465a', '#643747', '#3b5048', '#4a4241', '#83704d'];

export function legalDesk(seed: number, back = false): BufFurniture {
  const result = back ? deskBack('dark', seed) : desk('dark', seed);
  const b = result.base.buf;
  // Bound case file with a gold spine, alongside the real activity monitor.
  b.rect(1, 1, 6, 4, '#3b5048');
  b.vline(2, 1, 4, '#c9ac70');
  b.hline(3, 5, 2, '#ede6d6');
  return result;
}

export function legalBookshelf(seed: number): BufFurniture {
  const s = floorSheet(2, 1, 22);
  const b = s.buf;
  topFace(b, 0, -21, 32, 3, M.walnut);
  b.rect(0, -18, 32, 34, M.walnut.base);
  b.rect(2, -17, 28, 31, M.walnut.dd);
  for (const [row, bottom] of [-9, 2, 13].entries()) {
    for (let col = 0; col < 7; col++) {
      const x = 3 + col * 4;
      const height = 7 + (seed + col + row) % 3;
      book(b, x, bottom - height + 1, 3, height, COVERS[(seed + col + row) % COVERS.length]);
      b.hline(x, x + 2, bottom - height + 2, '#d1b374');
      b.hline(x, x + 2, bottom - 1, '#c4a467');
    }
    b.hline(1, 30, bottom + 1, M.walnut.hi);
    b.hline(1, 30, bottom + 2, M.walnut.dk);
  }
  b.vline(0, -18, 15, M.walnut.lt);
  b.vline(31, -18, 15, M.walnut.dd);
  b.outline();
  contact(b, 0, 14, 32, 3, .2);
  return { base: s };
}

export function legalMeetingTable(seed: number): BufFurniture {
  const s = floorSheet(3, 2, 10);
  const b = s.buf;
  for (const x of [3, 42]) {
    b.rect(x, 20, 3, 12, M.graphite.base);
    b.vline(x, 20, 31, M.graphite.lt);
  }
  topFace(b, 0, -4, 48, 24, M.walnut);
  woodGrain(b, 1, -3, 46, 22, M.walnut, seed);
  b.hline(0, 47, 20, M.walnut.base);
  b.hline(0, 47, 21, M.walnut.dk);
  // Open briefs, leather folders, pens and a glass water carafe.
  b.rect(6, 0, 10, 7, '#33465a');
  papers(b, 7, 0, 8, 6);
  papers(b, 31, 12, 9, 6);
  b.rect(6, 13, 9, 5, '#643747');
  b.hline(7, 13, 14, '#c9ac70');
  b.rect(32, 0, 8, 5, '#3b5048');
  b.vline(19, 1, 6, '#343a41');
  b.set(19, 1, '#c9ac70');
  b.rect(23, 6, 4, 6, '#c4dde1');
  b.rect(24, 4, 2, 3, '#e4eeec');
  b.hline(23, 26, 9, '#78a2ac');
  for (const x of [18, 29]) b.rect(x, 11, 2, 3, '#e1eff0');
  b.outline();
  contact(b, 0, 28, 48, 4, .2);
  return { base: s };
}
