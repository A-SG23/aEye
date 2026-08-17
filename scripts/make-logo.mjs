/**
 * Generates the pixel-art eye logo as a real PNG at its native grid size.
 *
 * PLACEHOLDER. Authored to the spec's description (pixel-art eye, green iris,
 * black liner) because no logo asset was supplied. To swap in the real one,
 * drop it at public/aeye-logo.png and delete this script — the CSS already
 * enforces integer scaling and pixelated rendering, so nothing else changes.
 * If the real logo's palette differs, resample the tokens in src/theme.css.
 *
 * Kept as a script rather than a binary blob so the pixel grid stays editable.
 * Run: npm run logo
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// . transparent  k liner  w sclera  g iris  d pupil  h highlight
const GRID = [
  '.....................',
  '................kkkk.',
  '.............kkkkkkk.',
  '....kkkkkkkkkkkkkk...',
  '..kkwwwwwwwwwwwwwkk..',
  '.kwwwwwgggggwwwwwwk..',
  '.kwwwwggdddggwwwwwk..',
  '.kwwwwggdhdggwwwwwk..',
  '.kwwwwwgdddgwwwwwwk..',
  '..kwwwwwgggwwwwwwk...',
  '...kkwwwwwwwwwwwkk...',
  '.....kkkkkkkkkkkk....',
  '.....................',
];

const PALETTE = {
  '.': [0, 0, 0, 0],
  k: [0x19, 0x15, 0x18, 0xff], // --ink
  w: [0xff, 0xff, 0xff, 0xff],
  g: [0x1f, 0x9d, 0x5b, 0xff], // --green
  d: [0x0c, 0x3a, 0x24, 0xff],
  h: [0xff, 0xff, 0xff, 0xff],
};

const WIDTH = GRID[0].length;
const HEIGHT = GRID.length;

const table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// One filter byte (0 = none) per scanline, then RGBA.
const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
let p = 0;
for (let y = 0; y < HEIGHT; y++) {
  raw[p++] = 0;
  for (let x = 0; x < WIDTH; x++) {
    const ch = GRID[y][x];
    const rgba = PALETTE[ch];
    if (!rgba) throw new Error(`Unknown pixel '${ch}' at ${x},${y}`);
    raw[p++] = rgba[0];
    raw[p++] = rgba[1];
    raw[p++] = rgba[2];
    raw[p++] = rgba[3];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'aeye-logo.png');
writeFileSync(out, png);
console.log(`wrote ${out} — ${WIDTH}x${HEIGHT}px native, ${png.length} bytes`);
