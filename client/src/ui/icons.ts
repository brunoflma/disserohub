// Ícones da interface em pixel art (mapas de pixels -> SVG com bordas nítidas), coerentes com o escritório.
// Cada '#' é um pixel pintado com currentColor; renderizados a 2 px de tela por pixel.

function pixelPaths(rows: readonly string[], palette: Readonly<Record<string, string>>): string {
  let out = '';
  for (const [ch, color] of Object.entries(palette)) {
    let d = '';
    rows.forEach((row, y) => {
      // Agrupa pixels consecutivos da linha num único retângulo.
      let x = 0;
      while (x < row.length) {
        if (row[x] !== ch) {
          x++;
          continue;
        }
        let run = 1;
        while (row[x + run] === ch) run++;
        d += `M${x} ${y}h${run}v1h-${run}z`;
        x += run;
      }
    });
    if (d) out += `<path fill="${color}" d="${d}"/>`;
  }
  return out;
}

export function pixelIcon(rows: readonly string[], palette: Readonly<Record<string, string>> = { '#': 'currentColor' }, cls = 'ui-px-icon'): string {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  return `<svg class="${cls}" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${pixelPaths(rows, palette)}</svg>`;
}

const PIXEL_ICONS = {
  overview: pixelIcon([
    '###....###',
    '#........#',
    '#........#',
    '...####...',
    '...#..#...',
    '...#..#...',
    '...####...',
    '#........#',
    '#........#',
    '###....###',
  ]),
  zoomIn: pixelIcon([
    '..........',
    '....##....',
    '....##....',
    '....##....',
    '.########.',
    '.########.',
    '....##....',
    '....##....',
    '....##....',
    '..........',
  ]),
  zoomOut: pixelIcon([
    '..........',
    '..........',
    '..........',
    '..........',
    '.########.',
    '.########.',
    '..........',
    '..........',
    '..........',
    '..........',
  ]),
  sidebar: pixelIcon([
    '##########',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '##########',
  ]),
  feed: pixelIcon([
    '##########',
    '#........#',
    '#........#',
    '#........#',
    '##########',
    '#.##.###.#',
    '#........#',
    '#.##.##..#',
    '#........#',
    '##########',
  ]),
  settings: pixelIcon([
    '....##....',
    '.#.####.#.',
    '..######..',
    '.###..###.',
    '####..####',
    '####..####',
    '.###..###.',
    '..######..',
    '.#.####.#.',
    '....##....',
  ]),
  help: pixelIcon([
    '..######..',
    '.##....##.',
    '.##....##.',
    '......##..',
    '.....##...',
    '....##....',
    '....##....',
    '..........',
    '....##....',
    '....##....',
  ]),
  maximize: pixelIcon([
    '..........',
    '.####.....',
    '.##.......',
    '.#.#......',
    '.#........',
    '........#.',
    '......#.#.',
    '.......##.',
    '.....####.',
    '..........',
  ]),
  restore: pixelIcon([
    '..........',
    '...#......',
    '...#......',
    '.###......',
    '..........',
    '..........',
    '......###.',
    '......#...',
    '......#...',
    '..........',
  ]),
  pencil: pixelIcon([
    '.......##.',
    '......#..#',
    '.....#..#.',
    '....#..#..',
    '...#..#...',
    '..#..#....',
    '.#..#.....',
    '.#.#......',
    '.##.......',
    '..........',
  ]),
  close: pixelIcon([
    '..........',
    '.##....##.',
    '.###..###.',
    '..######..',
    '...####...',
    '...####...',
    '..######..',
    '.###..###.',
    '.##....##.',
    '..........',
  ]),
  search: pixelIcon([
    '.####.....',
    '#....#....',
    '#....#....',
    '#....#....',
    '#....#....',
    '.####.....',
    '.....##...',
    '......##..',
    '.......##.',
    '........#.',
  ]),
  copy: pixelIcon([
    '...#######',
    '...#.....#',
    '...#.....#',
    '#######..#',
    '#.....#..#',
    '#.....#..#',
    '#.....####',
    '#.....#...',
    '#.....#...',
    '#######...',
  ]),
  check: pixelIcon([
    '..........',
    '.........#',
    '........##',
    '.......##.',
    '#.....##..',
    '##...##...',
    '.##.##....',
    '..###.....',
    '...#......',
    '..........',
  ]),
  follow: pixelIcon([
    '....##....',
    '....##....',
    '..######..',
    '.#......#.',
    '##..##..##',
    '##..##..##',
    '.#......#.',
    '..######..',
    '....##....',
    '....##....',
  ]),
  center: pixelIcon([
    '###....###',
    '#........#',
    '#........#',
    '....##....',
    '...####...',
    '...####...',
    '....##....',
    '#........#',
    '#........#',
    '###....###',
  ]),
  hand: pixelIcon([
    '...#.#....',
    '..#.#.#...',
    '..#.#.#.#.',
    '..#.#.#.#.',
    '..#######.',
    '#.#######.',
    '##.######.',
    '.########.',
    '..######..',
    '...####...',
  ]),
  warn: pixelIcon([
    '....##....',
    '...####...',
    '...#..#...',
    '..##..##..',
    '..##..##..',
    '.###..###.',
    '.########.',
    '####..####',
    '##########',
    '..........',
  ]),
  clock: pixelIcon([
    '..######..',
    '.#......#.',
    '#....#...#',
    '#....#...#',
    '#....###.#',
    '#........#',
    '#........#',
    '.#......#.',
    '..######..',
    '..........',
  ]),
  // Ampulheta (esperando o shell): moldura na cor do texto e areia âmbar caindo.
  hourglass: pixelIcon(
    [
      '#########',
      '.#sssss#.',
      '.#sssss#.',
      '..#sss#..',
      '...#s#...',
      '...#s#...',
      '..#.s.#..',
      '.#..s..#.',
      '.#.sss.#.',
      '#########',
    ],
    { '#': 'currentColor', s: '#f7c76b' },
  ),
  // Janela de terminal com o prompt ">_".
  terminal: pixelIcon([
    '##########',
    '#........#',
    '#.#......#',
    '#..#.....#',
    '#...#....#',
    '#..#.....#',
    '#.#..###.#',
    '#........#',
    '##########',
  ]),
  /** Pessoa com um +: novo agente (o + sozinho já é o "aproximar" da câmera). */
  newAgent: pixelIcon(['..##......', '.####.....', '.####...#.', '..##...###', '........#.', '.####.....', '######....', '######....']),
  delivery: pixelIcon(['...####...', '..#....#..', '.#......#.', '##########', '#....#...#', '#...###..#', '#....#...#', '#........#', '##########']),
  chevronLeft: pixelIcon(['....##', '...##.', '..##..', '.##...', '..##..', '...##.', '....##']),
  chevronRight: pixelIcon(['##....', '.##...', '..##..', '...##.', '..##..', '.##...', '##....']),
  mic: pixelIcon(['...##...', '..####..', '..####..', '..####..', '#.####.#', '#..##..#', '.#....#.', '..####..', '...##...', '..####..']),
  stopRec: pixelIcon(['........', '.######.', '.######.', '.######.', '.######.', '.######.', '.######.', '........']),
  attach: pixelIcon(['...###..', '..#...#.', '..#.#.#.', '..#.#.#.', '..#.#.#.', '..#.#.#.', '..#...#.', '...###..']),
  lock: pixelIcon(['..####..', '.##..##.', '.#....#.', '.#....#.', '########', '###..###', '###..###', '########', '########']),
  chevronDown: pixelIcon(['#......#', '##....##', '.##..##.', '..####..', '...##...']),
  chevronUp: pixelIcon(['...##...', '..####..', '.##..##.', '##....##', '#......#']),
  arrowDown: pixelIcon(['...##...', '...##...', '...##...', '#######.', '.#####..', '..###...', '...#....'].map((r) => r.padEnd(8, '.'))),
} as const;

export type IconKey = keyof typeof ICONS;

/** Cohesive, scalable controls; the brand and world retain their pixel artwork. */
export function lineIcon(paths: string): string {
  return `<svg class="ui-px-icon ui-line-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}
const path = (d: string) => lineIcon(`<path d="${d}"/>`);
export const ICONS = {
  ...PIXEL_ICONS,
  overview: path('M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z'),
  zoomIn: path('M12 5v14M5 12h14'),
  zoomOut: path('M5 12h14'),
  sidebar: path('M4 4h16v16H4zM9 4v16'),
  feed: path('M4 4h16v16H4zM4 10h16M8 14h3m3 0h2M8 17h3m3 0h2'),
  settings: path('m9 3-.7 2.3-2 1.2-2.4-.5L2 9l1.7 1.8v2.4L2 15l1.9 3 2.4-.5 2 1.2L9 21h6l.7-2.3 2-1.2 2.4.5 1.9-3-1.7-1.8v-2.4L22 9l-1.9-3-2.4.5-2-1.2L15 3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'),
  help: path('M9.1 8a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4m.1 3h0M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'),
  maximize: path('M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'),
  restore: path('M8 8h12v12H8zM4 16V4h12'),
  pencil: path('m4 16-1 5 5-1L20 8l-4-4zM14 6l4 4'),
  close: path('m6 6 12 12M18 6 6 18'),
  search: path('M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 5 6 6'),
  folderPlus: path('M3 6h6l2 3h10v11H3zM12 12v6m-3-3h6'),
  folder: path('M3 6h6l2 3h10v11H3z'),
  copy: path('M9 9h12v12H9zM5 15H3V3h12v2'),
  check: path('m5 12 4 4L19 6'),
  follow: path('M12 3v3m0 12v3M3 12h3m12 0h3M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0'),
  center: path('M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5M12 9v6m-3-3h6'),
  warn: path('m12 3 10 18H2zM12 9v5m0 3h0'),
  clock: path('M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'),
  terminal: path('M3 4h18v16H3zM7 9l3 3-3 3m6 0h4'),
  chevronLeft: path('m15 6-6 6 6 6'),
  chevronRight: path('m9 6 6 6-6 6'),
  chevronDown: path('m6 9 6 6 6-6'),
  chevronUp: path('m6 15 6-6 6 6'),
  arrowDown: path('M12 4v16m-6-6 6 6 6-6'),
  attach: path('m9 13 7-7a3 3 0 0 1 4 4L10 20a5 5 0 0 1-7-7L13 3'),
  lock: path('M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4m-4 5v2'),
  mic: path('M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8'),
  stopRec: path('M5 5h14v14H5z'),
};

/** Official Dissero open-D mark, matching the referenced site. */
export const FALLBACK_MARK = `<svg class="ui-mark ui-dissero-mark" viewBox="0 0 128 128" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect width="128" height="128" rx="22" fill="#122521"/>
<path d="M35 47V24h23c31 0 48 15 48 40s-17 40-48 40H35V85" fill="none" stroke="#f3f0e8" stroke-width="5"/>
<path d="M49 37h11c23 0 33 10 33 27S83 91 60 91H49" fill="none" stroke="#bca477" stroke-width="2"/>
<path d="M20 59h43M20 73h31" stroke="#dfcba4" stroke-width="4"/>
<circle cx="63" cy="59" r="3" fill="#dfcba4"/>
</svg>`;
