"use strict";
/**
 * Code 128 (subset B) encoder and decoder.
 * Patterns are the ISO/IEC 15417 widths: bar, space, bar, space, bar, space.
 * Stop pattern is seven widths.
 */

const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const STOP = 106;

function pattern(value) {
  const p = PATTERNS[value];
  if (!p) throw new Error("code128_value");
  return p.split("").map((n) => parseInt(n, 10));
}

function encodeValues(text) {
  const raw = String(text || "");
  if (!raw) throw new Error("empty");
  const values = [START_B];
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code > 126) throw new Error("unsupported_char");
    values.push(code - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(STOP);
  return values;
}

function modulesFor(text) {
  const values = encodeValues(text);
  const modules = [];
  values.forEach((v) => {
    const widths = pattern(v);
    let bar = true;
    widths.forEach((w) => {
      for (let i = 0; i < w; i++) modules.push(bar ? 1 : 0);
      bar = !bar;
    });
  });
  return modules;
}

function svgBarcode(text, opts) {
  const o = opts || {};
  const module = o.module || 2;
  const height = o.height || 70;
  const quiet = o.quiet == null ? 10 : o.quiet;
  const modules = modulesFor(text);
  const width = (modules.length + quiet * 2) * module;
  let x = quiet * module;
  let rects = "";
  let run = 0;
  for (let i = 0; i <= modules.length; i++) {
    if (i < modules.length && modules[i] === 1) {
      run += 1;
    } else if (run) {
      rects += `<rect x="${x}" y="0" width="${run * module}" height="${height}" fill="#111111"/>`;
      x += run * module;
      run = 0;
    } else if (i < modules.length) {
      x += module;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${rects}</svg>`;
}

function matchAt(modules, index) {
  for (let value = 0; value < PATTERNS.length; value++) {
    const widths = pattern(value);
    let cursor = index;
    let ok = true;
    let bar = true;
    for (let w = 0; w < widths.length && ok; w++) {
      for (let n = 0; n < widths[w]; n++) {
        if (modules[cursor] !== (bar ? 1 : 0)) ok = false;
        cursor += 1;
      }
      bar = !bar;
    }
    if (ok) return { value: value, next: cursor };
  }
  return null;
}

function decodeModules(modules) {
  let i = 0;
  while (i < modules.length && modules[i] === 0) i += 1;
  const values = [];
  while (i < modules.length) {
    if (modules[i] === 0) break;
    const hit = matchAt(modules, i);
    if (!hit) return null;
    values.push(hit.value);
    i = hit.next;
  }
  if (values.length < 4) return null;
  if (values[0] !== START_B) return null;
  if (values[values.length - 1] !== STOP) return null;
  const data = values.slice(1, -2);
  const check = values[values.length - 2];
  let sum = values[0];
  for (let n = 0; n < data.length; n++) sum += data[n] * (n + 1);
  if ((sum % 103) !== check) return null;
  return data.map((v) => String.fromCharCode(v + 32)).join("");
}

function decodeText(text) {
  return decodeModules(modulesFor(text));
}

module.exports = { encodeValues, modulesFor, svgBarcode, decodeModules, decodeText };
