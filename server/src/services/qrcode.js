/**
 * 无依赖二维码（SVG Data URL）
 * 基于字节模式 + ECL M 的精简实现，适合订单短文本
 */
const { writePngGray } = require('./png');

// GF(256)
const EXP = new Array(256);
const LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  EXP[255] = EXP[0];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function rsGenerator(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = data.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (!coef) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
  }
  return res.slice(data.length);
}

// version 1-4 ECL M: [dataCodewords, ecCodewords]
const VER = {
  1: { size: 21, data: 16, ec: 10 },
  2: { size: 25, data: 28, ec: 16 },
  3: { size: 29, data: 44, ec: 26 },
  4: { size: 33, data: 64, ec: 36 },
};

function chooseVersion(byteLen) {
  // mode 4 + len 8 + data + pad
  const need = Math.ceil((4 + 8 + byteLen * 8) / 8);
  for (const v of [1, 2, 3, 4]) {
    if (need <= VER[v].data) return v;
  }
  return 4;
}

function setProbe(mod, n, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const dark =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      if (r === -1 || r === 7 || c === -1 || c === 7) mod[rr][cc] = false;
      else mod[rr][cc] = dark;
    }
  }
}

function encodeMatrix(text) {
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));
  if (bytes.length > 60) bytes.length = 60;
  const version = chooseVersion(bytes.length);
  const { size: n, data: dataCw, ec: ecCw } = VER[version];

  // bit stream
  const bits = [];
  const put = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  // terminator
  const capacity = dataCw * 8;
  const term = Math.min(4, capacity - bits.length);
  put(0, term);
  while (bits.length % 8 !== 0) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  const pads = [0xec, 0x11];
  let pi = 0;
  while (data.length < dataCw) data.push(pads[pi++ % 2]);

  const ec = rsEncode(data, ecCw);
  const code = data.concat(ec);

  const mod = Array.from({ length: n }, () => Array(n).fill(null));
  setProbe(mod, n, 0, 0);
  setProbe(mod, n, n - 7, 0);
  setProbe(mod, n, 0, n - 7);
  // timing
  for (let i = 8; i < n - 8; i++) {
    if (mod[6][i] === null) mod[6][i] = i % 2 === 0;
    if (mod[i][6] === null) mod[i][6] = i % 2 === 0;
  }
  // dark module
  mod[n - 8][8] = true;

  // format info ECL M mask 0: 0x5412 after BCH — use known value 0x5412 xor masked
  // Mask pattern 0, ECC M => format bits 101010000010010
  const format = 0b101010000010010;
  const placeFormat = (i, bit) => {
    // vertical near left probe
    const coords = [
      [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
      [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    ];
    const coords2 = [
      [8, n - 1], [8, n - 2], [8, n - 3], [8, n - 4], [8, n - 5], [8, n - 6], [8, n - 7], [8, n - 8],
      [n - 7, 8], [n - 6, 8], [n - 5, 8], [n - 4, 8], [n - 3, 8], [n - 2, 8], [n - 1, 8],
    ];
    if (coords[i]) mod[coords[i][0]][coords[i][1]] = bit;
    if (coords2[i]) mod[coords2[i][0]][coords2[i][1]] = bit;
  };
  for (let i = 0; i < 15; i++) placeFormat(i, ((format >> (14 - i)) & 1) === 1);

  // data placement mask 0: (r+c)%2==0 -> invert
  let bitIdx = 0;
  const totalBits = code.length * 8;
  let direction = -1;
  let row = n - 1;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (mod[row][cc] === null) {
          let dark = false;
          if (bitIdx < totalBits) {
            const byte = code[bitIdx >> 3];
            dark = ((byte >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          if ((row + cc) % 2 === 0) dark = !dark;
          mod[row][cc] = dark;
        }
      }
      row += direction;
      if (row < 0 || row >= n) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mod[r][c] === null) mod[r][c] = false;
  return mod;
}

function toDataURL(text) {
  const mod = encodeMatrix(text);
  const n = mod.length;
  const scale = 6;
  const margin = 2;
  const dim = (n + margin * 2) * scale;
  const pixels = Buffer.alloc(dim * dim, 255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!mod[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const yy = (r + margin) * scale + y;
          const xx = (c + margin) * scale + x;
          pixels[yy * dim + xx] = 0;
        }
      }
    }
  }
  const png = writePngGray(dim, dim, pixels);
  return `data:image/png;base64,${png.toString('base64')}`;
}

module.exports = { toDataURL };
