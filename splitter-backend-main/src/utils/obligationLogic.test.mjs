import test from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, recordableMinor, outstandingMinor, can, checkPayment, reminderAllowed, obligationsFromShares, planSync, summarize, paymentState, REMINDER_INTERVAL_MS } from "./obligationLogic.ts";

const A = (amountMinor, confirmedMinor = 0, pendingMinor = 0) => ({ amountMinor, confirmedMinor, pendingMinor });

test("status follows the payments; forgiven/cancelled are final", () => {
  assert.equal(deriveStatus(A(1000)), "UNPAID");
  assert.equal(deriveStatus(A(1000, 400)), "PARTIALLY_PAID");
  assert.equal(deriveStatus(A(1000, 400, 100)), "PAID_PENDING_CONFIRMATION");
  assert.equal(deriveStatus(A(1000, 0, 1000)), "PAID_PENDING_CONFIRMATION");
  assert.equal(deriveStatus(A(1000, 1000)), "PAID");
  assert.equal(deriveStatus(A(1000, 1000), "FORGIVEN"), "FORGIVEN");
  assert.equal(deriveStatus(A(1000), "CANCELLED"), "CANCELLED");
  assert.equal(recordableMinor(A(1000, 400, 100)), 500);
  assert.equal(outstandingMinor(A(1000, 400, 100), "PAID_PENDING_CONFIRMATION"), 600);
  assert.equal(outstandingMinor(A(1000, 400), "FORGIVEN"), 0);
});

test("permissions: the debtor marks, only the creditor confirms, rejects, forgives, reminds", () => {
  for (const a of ["recordReceived", "confirm", "reject", "forgive", "remind"]) {
    assert.equal(can("creditor", a), true, a);
    assert.equal(can("debtor", a), false, `debtor ${a}`);
    assert.equal(can("participant", a), false, `participant ${a}`);
    assert.equal(can("outsider", a), false, `outsider ${a}`);
  }
  assert.equal(can("debtor", "markPaid"), true);
  assert.equal(can("creditor", "markPaid"), false);
  assert.equal(can("participant", "markPaid"), false);
});

test("payments never exceed what is left; 'the rest' is the default", () => {
  assert.deepEqual(checkPayment(A(1000), "UNPAID", undefined), { ok: true, amountMinor: 1000 });
  assert.deepEqual(checkPayment(A(1000, 300, 200), "PAID_PENDING_CONFIRMATION", undefined), { ok: true, amountMinor: 500 });
  assert.deepEqual(checkPayment(A(1000, 300, 200), "PAID_PENDING_CONFIRMATION", 501), { ok: false, code: "OVERPAYMENT" });
  assert.deepEqual(checkPayment(A(1000, 300, 200), "PAID_PENDING_CONFIRMATION", 500), { ok: true, amountMinor: 500 });
  assert.deepEqual(checkPayment(A(1000, 0, 1000), "PAID_PENDING_CONFIRMATION", undefined), { ok: false, code: "OVERPAYMENT" });
  for (const bad of [0, -1, 1.5, NaN]) assert.equal(checkPayment(A(1000), "UNPAID", bad).code, "VALIDATION", String(bad));
  for (const s of ["PAID", "FORGIVEN", "CANCELLED"]) assert.equal(checkPayment(A(1000, 1000), s, 1).code, "OBLIGATION_CLOSED", s);
});

test("reminders at most once per 24 hours per debt", () => {
  const now = 10 * REMINDER_INTERVAL_MS;
  assert.deepEqual(reminderAllowed(null, now), { ok: true });
  assert.deepEqual(reminderAllowed(now - REMINDER_INTERVAL_MS, now), { ok: true });
  assert.deepEqual(reminderAllowed(now - 1000, now), { ok: false, retryAt: now - 1000 + REMINDER_INTERVAL_MS });
});

test("obligations from shares: payer skipped, negatives flip, zeros skipped, duplicates merged", () => {
  const out = obligationsFromShares([{ userId: 1, minor: 500 }, { userId: 2, minor: 333 }, { userId: 2, minor: 1 }, { userId: 3, minor: 0 }, { userId: 4, minor: -250 }, { userId: 9, minor: 99 }], 9, "USD");
  assert.deepEqual(out, [
    { debtorId: 1, creditorId: 9, amountMinor: 500, currency: "USD" },
    { debtorId: 2, creditorId: 9, amountMinor: 334, currency: "USD" },
    { debtorId: 9, creditorId: 4, amountMinor: 250, currency: "USD" },
  ]);
});

test("re-finalizing: identical debts stay, changed unpaid ones are replaced, changes after a payment are locked", () => {
  const ex = (id, debtorId, amountMinor, status = "UNPAID", hasPayments = false) => ({ id, debtorId, creditorId: 9, amountMinor, currency: "USD", status, hasPayments });
  const d = (debtorId, amountMinor) => ({ debtorId, creditorId: 9, amountMinor, currency: "USD" });
  assert.deepEqual(planSync([ex(1, 1, 500), ex(2, 2, 300)], [d(1, 500), d(2, 300)]), { keep: [1, 2], cancel: [], create: [], locked: false });
  assert.deepEqual(planSync([ex(1, 1, 500), ex(2, 2, 300)], [d(1, 500), d(2, 350)]), { keep: [1], cancel: [2], create: [d(2, 350)], locked: false });
  assert.equal(planSync([ex(1, 1, 500, "PARTIALLY_PAID", true)], [d(1, 600)]).locked, true);
  assert.equal(planSync([ex(1, 1, 500, "UNPAID", true)], [d(1, 600)]).locked, true, "a rejected mark still counts as history");
  assert.equal(planSync([ex(1, 1, 500, "PARTIALLY_PAID", true)], [d(1, 500)]).locked, false, "same numbers: nothing to rewrite");
  assert.deepEqual(planSync([ex(1, 1, 500, "CANCELLED")], [d(1, 500)]).create, [d(1, 500)]);
});

test("summaries are per currency and never mix currencies; cents are exact", () => {
  const rows = [
    { currency: "USD", direction: "owedToMe", counterpartId: 2, amountMinor: 3334, confirmedMinor: 1000, status: "PARTIALLY_PAID" },
    { currency: "USD", direction: "owedToMe", counterpartId: 3, amountMinor: 3333, confirmedMinor: 0, status: "UNPAID" },
    { currency: "USD", direction: "iOwe", counterpartId: 3, amountMinor: 1, confirmedMinor: 0, status: "UNPAID" },
    { currency: "JPY", direction: "owedToMe", counterpartId: 2, amountMinor: 1500, confirmedMinor: 0, status: "FORGIVEN" },
    { currency: "UZS", direction: "iOwe", counterpartId: 4, amountMinor: 45000, confirmedMinor: 45000, status: "PAID" },
    { currency: "USD", direction: "owedToMe", counterpartId: 5, amountMinor: 999, confirmedMinor: 0, status: "CANCELLED" },
  ];
  const s = summarize(rows);
  assert.deepEqual(s.map((c) => c.currency), ["JPY", "USD", "UZS"]);
  const usd = s.find((c) => c.currency === "USD");
  assert.equal(usd.owedToMe.outstandingMinor, 2334 + 3333);
  assert.equal(usd.owedToMe.settledMinor, 1000);
  assert.equal(usd.iOwe.outstandingMinor, 1);
  assert.equal(usd.netMinor, 5667 - 1);
  assert.deepEqual(usd.owedToMe.people.map((p) => p.id), [3, 2]);
  const jpy = s.find((c) => c.currency === "JPY");
  assert.deepEqual([jpy.owedToMe.outstandingMinor, jpy.owedToMe.forgivenMinor], [0, 1500]);
  assert.equal(s.find((c) => c.currency === "UZS").iOwe.outstandingMinor, 0);
});

test("bill payment state for history", () => {
  assert.equal(paymentState([]), "none");
  assert.equal(paymentState([{ status: "PAID", amountMinor: 1, confirmedMinor: 1 }, { status: "FORGIVEN", amountMinor: 1, confirmedMinor: 0 }]), "paid");
  assert.equal(paymentState([{ status: "PAID", amountMinor: 1, confirmedMinor: 1 }, { status: "UNPAID", amountMinor: 1, confirmedMinor: 0 }]), "partial");
  assert.equal(paymentState([{ status: "UNPAID", amountMinor: 1, confirmedMinor: 0 }, { status: "CANCELLED", amountMinor: 1, confirmedMinor: 0 }]), "unpaid");
  assert.equal(paymentState([{ status: "PAID_PENDING_CONFIRMATION", amountMinor: 1, confirmedMinor: 0 }]), "partial");
});
