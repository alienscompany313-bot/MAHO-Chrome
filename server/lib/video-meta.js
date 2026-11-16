"use strict";

const MAX_SECONDS = 30;

function sniffVideo(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return "video/webm";
  if (buf.slice(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  return null;
}

function mp4Brands(buf) {
  if (!buf || buf.length < 16 || buf.slice(4, 8).toString("ascii") !== "ftyp") return [];
  const size = buf.readUInt32BE(0);
  const end = Math.min(buf.length, size > 8 ? size : 16);
  const brands = [];
  for (let i = 8; i + 4 <= end; i += 4) {
    const brand = buf.slice(i, i + 4).toString("ascii").replace(/\0/g, "");
    if (i === 8) brands.push(brand);
    else if (i >= 16 && brand.trim()) brands.push(brand);
  }
  return brands;
}

const PLAYABLE_MP4_BRANDS = {
  isom: true, iso2: true, iso4: true, iso5: true, iso6: true,
  mp41: true, mp42: true, avc1: true, avc3: true, dash: true,
};

function movCompatible(buf) {
  const brands = mp4Brands(buf);
  if (!brands.length) return false;
  return brands.some((brand) => PLAYABLE_MP4_BRANDS[brand.trim()]);
}

function readU32(buf, offset) {
  if (offset < 0 || offset + 4 > buf.length) return null;
  return buf.readUInt32BE(offset);
}

function mp4DurationSeconds(buf) {
  function walk(start, end, depth) {
    let offset = start;
    while (offset + 8 <= end && depth < 8) {
      let size = readU32(buf, offset);
      if (size == null) return null;
      const type = buf.slice(offset + 4, offset + 8).toString("ascii");
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return null;
        const hi = readU32(buf, offset + 8);
        const lo = readU32(buf, offset + 12);
        size = hi * 0x100000000 + lo;
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (!Number.isFinite(size) || size < header || offset + size > end) return null;
      const childStart = offset + header;
      const childEnd = offset + size;
      if (type === "mvhd" || type === "mdhd") {
        const version = buf[childStart];
        if (version === 0 && childStart + 20 <= childEnd) {
          const timescale = readU32(buf, childStart + 12);
          const duration = readU32(buf, childStart + 16);
          if (timescale > 0 && duration > 0) return duration / timescale;
        } else if (version === 1 && childStart + 32 <= childEnd) {
          const timescale = readU32(buf, childStart + 20);
          const hi = readU32(buf, childStart + 24);
          const lo = readU32(buf, childStart + 28);
          const duration = hi * 0x100000000 + lo;
          if (timescale > 0 && duration > 0) return duration / timescale;
        }
      }
      if (type === "moov" || type === "trak" || type === "mdia") {
        const found = walk(childStart, childEnd, depth + 1);
        if (found) return found;
      }
      offset += size;
    }
    return null;
  }
  return walk(0, buf.length, 0);
}

function readId(buf, offset) {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (!first) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) { length += 1; mask >>= 1; }
  if (offset + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + buf[offset + i];
  return { id: id, length: length };
}

function readVint(buf, offset) {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (!first) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) { length += 1; mask >>= 1; }
  if (offset + length > buf.length) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i += 1) value = value * 256 + buf[offset + i];
  return { value: value, length: length };
}

function webmDurationSeconds(buf) {
  const end = Math.min(buf.length, 512 * 1024);
  let timescale = 1000000;
  let duration = null;
  function walk(start, stop, depth) {
    let offset = start;
    while (offset + 2 < stop && depth < 6) {
      const id = readId(buf, offset);
      if (!id) return;
      const size = readVint(buf, offset + id.length);
      if (!size) return;
      const data = offset + id.length + size.length;
      const len = size.value;
      const unknown = len > (stop - data);
      if (unknown) return;
      if (data + len > buf.length) return;
      if (id.id === 0x2AD7B1 && len > 0 && len <= 8) {
        let scale = 0;
        for (let i = 0; i < len; i += 1) scale = scale * 256 + buf[data + i];
        if (scale > 0) timescale = scale;
      }
      if (id.id === 0x4489 && (len === 4 || len === 8)) {
        const value = len === 4 ? buf.readFloatBE(data) : buf.readDoubleBE(data);
        if (Number.isFinite(value) && value > 0) duration = value;
      }
      const container = id.id === 0x18538067 || id.id === 0x1549A966 || id.id === 0x1A45DFA3;
      if (container) walk(data, data + len, depth + 1);
      offset = data + len;
    }
  }
  walk(0, end, 0);
  if (duration == null) return null;
  return (duration * timescale) / 1e9;
}

function inspectVideo(buf) {
  const kind = sniffVideo(buf);
  if (!kind) return { error: "invalid_video_signature" };
  if (kind === "video/mp4" && !movCompatible(buf)) return { error: "mov_unsupported" };
  const seconds = kind === "video/webm" ? webmDurationSeconds(buf) : mp4DurationSeconds(buf);
  if (!seconds || !Number.isFinite(seconds)) return { error: "duration_unreadable" };
  if (seconds > MAX_SECONDS + 0.05) return { error: "video_too_long", maxSeconds: MAX_SECONDS };
  return { mime: kind, duration: Math.round(seconds * 100) / 100, maxSeconds: MAX_SECONDS };
}

module.exports = {
  MAX_SECONDS,
  sniffVideo,
  mp4Brands,
  movCompatible,
  mp4DurationSeconds,
  webmDurationSeconds,
  inspectVideo,
};
