"use strict";

/**
 * Public customer numbers for newly created accounts: 20260001, 20260002, ...
 * Existing MO000001-style numbers are left unchanged. This does not renumber anyone.
 */
function allocateCustomerNo(db) {
  const data = db && typeof db === "object" ? db : {};
  let max = 20260000;
  (data.users || []).forEach((user) => {
    const value = String((user && user.customerNo) || "");
    if (/^20\d{6}$/.test(value)) max = Math.max(max, Number(value));
  });
  const stored = Number(data.seqPublicCustomer) || 0;
  const next = Math.max(max, stored) + 1;
  data.seqPublicCustomer = next;
  return String(next);
}

module.exports = { allocateCustomerNo };
