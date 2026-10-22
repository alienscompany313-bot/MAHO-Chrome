"use strict";
/**
 * Store open/closed status in Asia/Kabul.
 * Default schedule matches the owner's official hours.
 * Per-store hoursSchedule overrides the global schedule when present.
 */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_FROM_SHORT = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };
const DAY_LABEL = {
  sat: { fa: "شنبه", en: "Saturday" },
  sun: { fa: "یکشنبه", en: "Sunday" },
  mon: { fa: "دوشنبه", en: "Monday" },
  tue: { fa: "سه‌شنبه", en: "Tuesday" },
  wed: { fa: "چهارشنبه", en: "Wednesday" },
  thu: { fa: "پنجشنبه", en: "Thursday" },
  fri: { fa: "جمعه", en: "Friday" },
};

function defaultDay(close) {
  return { open: "08:00", close: close, closed: false };
}

function defaultSchedule() {
  return {
    timezone: "Asia/Kabul",
    days: {
      sat: defaultDay("20:00"),
      sun: defaultDay("20:00"),
      mon: defaultDay("20:00"),
      tue: defaultDay("20:00"),
      wed: defaultDay("20:00"),
      thu: defaultDay("20:00"),
      fri: defaultDay("12:00"),
    },
    closures: [],
  };
}

function hhmm(value, fallback) {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

function minutes(hhmmStr) {
  const [h, m] = hhmmStr.split(":");
  return (parseInt(h, 10) * 60) + parseInt(m, 10);
}

function normalizeSchedule(raw) {
  const base = defaultSchedule();
  const src = raw && typeof raw === "object" ? raw : {};
  const days = {};
  DAY_KEYS.forEach((key) => {
    const row = (src.days && src.days[key]) || base.days[key];
    const closed = row.closed === true;
    days[key] = {
      closed: closed,
      open: hhmm(row.open, base.days[key].open),
      close: hhmm(row.close, base.days[key].close),
    };
  });
  const closures = [];
  (Array.isArray(src.closures) ? src.closures : []).slice(0, 60).forEach((c) => {
    if (!c || typeof c !== "object") return;
    const date = String(c.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    closures.push({
      date: date,
      closed: c.closed !== false,
      open: c.open ? hhmm(c.open, "08:00") : "",
      close: c.close ? hhmm(c.close, "12:00") : "",
      note: String(c.note || "").replace(/[<>]/g, "").trim().slice(0, 180),
      note_en: String(c.note_en || "").replace(/[<>]/g, "").trim().slice(0, 180),
    });
  });
  return { timezone: "Asia/Kabul", days: days, closures: closures };
}

function kabulParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kabul",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date || new Date());
  const get = (type) => {
    const row = parts.find((p) => p.type === type);
    return row ? row.value : "";
  };
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const weekday = DAY_FROM_SHORT[get("weekday")] || "sat";
  return {
    weekday: weekday,
    date: get("year") + "-" + get("month") + "-" + get("day"),
    minutes: (parseInt(hour, 10) * 60) + parseInt(get("minute"), 10),
    hhmm: String(hour).padStart(2, "0") + ":" + String(get("minute")).padStart(2, "0"),
  };
}

function statusFor(schedule, date) {
  const sch = normalizeSchedule(schedule);
  const now = kabulParts(date || new Date());
  const closure = sch.closures.find((c) => c.date === now.date) || null;
  let open = false;
  let today = sch.days[now.weekday];
  let reason = "";
  if (closure && closure.closed !== false && !closure.open) {
    open = false;
    reason = "closure";
    today = { closed: true, open: "", close: "", note: closure.note, note_en: closure.note_en };
  } else if (closure && closure.open && closure.close) {
    const start = minutes(closure.open);
    const end = minutes(closure.close);
    open = now.minutes >= start && now.minutes < end;
    reason = open ? "special_open" : "special_closed";
    today = { closed: false, open: closure.open, close: closure.close, note: closure.note, note_en: closure.note_en };
  } else if (today.closed) {
    open = false;
    reason = "weekly_closed";
  } else {
    const start = minutes(today.open);
    const end = minutes(today.close);
    open = end > start && now.minutes >= start && now.minutes < end;
    reason = open ? "open" : "closed";
  }
  const week = DAY_KEYS.map((key) => {
    const row = sch.days[key];
    return {
      key: key,
      label: DAY_LABEL[key].fa,
      label_en: DAY_LABEL[key].en,
      closed: !!row.closed,
      open: row.open,
      close: row.close,
      today: key === now.weekday,
    };
  });
  /* Saturday-first display for Dari readers */
  const order = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
  week.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return {
    timezone: "Asia/Kabul",
    open: open,
    reason: reason,
    date: now.date,
    time: now.hhmm,
    weekday: now.weekday,
    today: today,
    closure: closure,
    week: week,
  };
}

function ensureStoreHours(db) {
  if (!db || typeof db !== "object") return false;
  if (!db.storeHours || typeof db.storeHours !== "object" || !db.storeHours.days) {
    db.storeHours = defaultSchedule();
    return true;
  }
  const next = normalizeSchedule(db.storeHours);
  const changed = JSON.stringify(next) !== JSON.stringify(db.storeHours);
  db.storeHours = next;
  return changed;
}

module.exports = {
  DAY_KEYS,
  DAY_LABEL,
  defaultSchedule,
  normalizeSchedule,
  kabulParts,
  statusFor,
  ensureStoreHours,
};
