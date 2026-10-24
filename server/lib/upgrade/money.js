"use strict";

/** Integer minor units. 1 AFN = 100 puls. Afghanistan has no floating minor coins in this ledger. */

function toMinor(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromMinor(minor) {
  const n = Number(minor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function addMinor() {
  let s = 0;
  for (let i = 0; i < arguments.length; i++) s += Math.round(Number(arguments[i]) || 0);
  return s;
}

function formatAfn(minor, lang) {
  const major = fromMinor(minor);
  const num = major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return lang === "en" ? num + " AFN" : num + " افغانی";
}

module.exports = { toMinor, fromMinor, addMinor, formatAfn };
