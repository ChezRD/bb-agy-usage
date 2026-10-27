import assert from "node:assert/strict";
import test from "node:test";
import { toMeasurement } from "../server.js";

test("maps a successful host result to a native usage measurement", () => {
  const measurement = toMeasurement(
    {
      status: "ok",
      windows: [
        {
          id: "gemini-weekly-weekly-limit",
          label: "Weekly limit",
          kind: "weekly",
          model: "Gemini",
          usedPercent: 6,
          resetsAt: "2026-10-31T19:51:20.000Z",
        },
      ],
    },
    null,
  );

  assert.equal(measurement.usage.status, "ok");
  assert.equal(measurement.accountKey, null);
  assert.equal(measurement.observedAt === null, false);
  if (measurement.usage.status === "ok") {
    assert.equal(measurement.usage.planLabel, "Antigravity");
    assert.equal(measurement.usage.windows[0]?.cost, null);
    assert.equal(measurement.usage.windows[0]?.kind, "weekly");
  }
});

test("shows an actionable English message when agy is signed out", () => {
  const measurement = toMeasurement({ status: "unauthenticated" }, 1234);
  assert.deepEqual(measurement, {
    accountKey: null,
    observedAt: 1234,
    usage: {
      status: "error",
      plan: null,
      accountEmail: null,
      planLabel: null,
      message: "Sign in to Antigravity in agy on this machine, then reload.",
    },
  });
});

test("shows an actionable English message when the agy session expired", () => {
  const measurement = toMeasurement({ status: "expired" }, null);
  assert.equal(measurement.usage.status, "error");
  if (measurement.usage.status === "error") {
    assert.match(measurement.usage.message, /agy.*expired/i);
  }
});

test("keeps the error message", () => {
  const measurement = toMeasurement(
    { status: "error", message: "agy usage timed out." },
    null,
  );
  assert.equal(measurement.usage.status, "error");
  if (measurement.usage.status === "error") {
    assert.equal(measurement.usage.message, "agy usage timed out.");
  }
});
