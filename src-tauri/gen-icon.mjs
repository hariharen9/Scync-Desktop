// Generates src-tauri/icons/source.png — a 1024x1024 Scync vault emblem:
// near-black rounded square, emerald hexagon, dot in the centre.
// Pure Node (zlib + manual PNG chunks), no dependencies.
import zlib from 'node:zlib';
import fs from 'node:fs';

const SIZE = 1024;

function rgba(x, y) {
  // Rounded-square mask, 22% corner radius
  const r = SIZE * 0.22;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  const insideRect = (x >= r && x <= SIZE - r) || (y >= r && y <= SIZE - r);
  const insideCorner = (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
  if (!(insideRect || insideCorner)) return [0, 0, 0, 0];

  // Background: subtle vertical gradient #0a0c10 → #05060a
  const t = y / SIZE;
  let colR = Math.round(10 + 5 * (1 - t));
  let colG = Math.round(12 + 6 * (1 - t));
  let colB = Math.round(16 + 10 * (1 - t));

  // Emerald hexagon centred, inradius ~30% of size
  const dx = x - SIZE / 2;
  const dy = y - SIZE / 2;
  const radius = SIZE * 0.30;
  // Pointy-top hexagon: distance metric
  const angle = Math.atan2(dy, dx);
  const dist = Math.hypot(dx, dy);
  // Hexagon support function: max distance to edge = radius / cos(30° - (angle mod 60°))
  const a = Math.abs(((Math.abs(angle) * 180) / Math.PI) % 60 - 30) * Math.PI / 180;
  const hexR = radius / Math.cos(a);
  const d = dist - hexR; // signed distance (approx)
  if (d <= 0) {
    // Inside hexagon: dark fill with emerald border
    if (d > -SIZE * 0.012) {
      return [16, 185, 129, 255]; // #10b981 border
    }
    colR = 8; colG = 10; colB = 13;
  }

  // Centre dot: emerald, radius 13%
  const dot = SIZE * 0.13;
  if (dist <= dot) return [16, 185, 129, 255];

  return [colR, colG, colB, 255];
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = rgba(x, y);
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc);
  return Buffer.concat([len, body, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(new URL('./source.png', import.meta.url), png);
console.log('wrote source.png', png.length, 'bytes');
