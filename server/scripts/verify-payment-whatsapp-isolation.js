#!/usr/bin/env node
"use strict";
/**
 * WhatsApp payment isolation — WhatsApp must NOT be a fallback for
 * Account Pay (hesab), bank, card, or any other non-WhatsApp method.
 */
const fs = require("fs");
const path = require("path");
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); };
const ok = (m) => console.log("OK  " + m);

const ROOT = path.join(__dirname, "..", "..");
const { whatsappInvokeCount, isCanonicalWhatsAppPayment } = require("../lib/payment-whatsapp-gate");

/* ---- Explicit regression counters ---- */
assert(whatsappInvokeCount("hesab") === 0, "Account Pay (hesab) -> WhatsApp invoked = 0");
assert(whatsappInvokeCount("bank") === 0, "Bank Account -> WhatsApp invoked = 0");
assert(whatsappInvokeCount("card") === 0, "Card -> WhatsApp invoked = 0");
assert(whatsappInvokeCount("whatsapp") === 1, "WhatsApp method -> WhatsApp invoked = 1");
assert(whatsappInvokeCount("account_pay") === 0, "unknown/non-canonical -> WhatsApp invoked = 0");
assert(whatsappInvokeCount("") === 0, "empty -> WhatsApp invoked = 0");
assert(isCanonicalWhatsAppPayment("whatsapp") === true, "canonical whatsapp");
assert(isCanonicalWhatsAppPayment("hesab") === false, "hesab not canonical whatsapp");
ok("Account Pay -> WhatsApp invoked = 0");
ok("Bank Account -> WhatsApp invoked = 0");
ok("Card -> WhatsApp invoked = 0");
ok("WhatsApp method -> WhatsApp invoked = 1");

/* ---- Static: afterOrderPlaced must not fall through to WhatsApp ---- */
const mainJs = fs.readFileSync(path.join(ROOT, "website", "js", "main.js"), "utf8");
const fnMatch = mainJs.match(/function afterOrderPlaced\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
assert(fnMatch, "afterOrderPlaced present");
const fn = fnMatch[0];

/* Only one WhatsApp deep-link open in afterOrderPlaced (no hesab/card/else duplicates) */
const waHits = fn.match(/window\.open\(\s*"https:\/\/wa\.me\//g) || [];
assert(waHits.length === 1, "exactly one WhatsApp window.open in afterOrderPlaced");
assert(/if\s*\(\s*method\s*===\s*"whatsapp"\s*\)\s*\{[\s\S]*?window\.open\(\s*"https:\/\/wa\.me\//.test(fn),
  "WhatsApp window.open nested under method===whatsapp");

/* hesab / card branches must not open WhatsApp */
assert(!/method\s*===\s*"hesab"[\s\S]*?window\.open\(\s*"https:\/\/wa\.me\//.test(fn),
  "hesab branch does not open WhatsApp");
assert(!/method\s*===\s*"card"[\s\S]*?window\.open\(\s*"https:\/\/wa\.me\//.test(fn),
  "card branch does not open WhatsApp");

/* No catch-all else that opens WhatsApp */
assert(!/else\s*\{\s*window\.open\(\s*"https:\/\/wa\.me\//.test(fn), "no else→WhatsApp fallback");

/* Payment payload must not coerce non-WhatsApp selections to whatsapp */
assert(!/payment:\s*payMethod\s*===\s*"hesab"[\s\S]{0,80}\?\s*payMethod\s*:\s*"whatsapp"/.test(mainJs),
  "no payment ternary that defaults unknown methods to whatsapp");
assert(/payment:\s*paymentMethod/.test(mainJs) || /payment:\s*payMethod(?!\s*===)/.test(mainJs),
  "selected payment method preserved on order payload");

ok("afterOrderPlaced WhatsApp isolation (static)");
ok("payment method preserved (no coerce-to-whatsapp)");

console.log("\nALL WHATSAPP PAYMENT ISOLATION CHECKS PASSED");
