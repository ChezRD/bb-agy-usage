import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandError,
  parseAgyUsage,
  readAgyUsage,
} from "../src/agy.js";

const AUTHORIZED = [
  "Gemini Models\tWeekly Limit Remaining\t94%\t2026-10-31T19:51:20Z",
  "Gemini Models\tFive Hour Limit Remaining\t100%\t2026-10-27T18:30:45Z",
  "Claude and GPT models\tWeekly Limit Remaining\t25%\t2026-10-28T15:34:35Z",
  "Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-10-27T18:46:13Z",
  "Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t70%\t2026-10-29T11:09:42Z",
].join("\n");

const AUTH_MESSAGE = [
  "Authentication required. Please visit the URL to log in:",
  "Waiting for authentication (timeout 60s)...",
  "authentication failed or timed out",
].join("\n");

test("parses the agy usage table", () => {
  const windows = parseAgyUsage(AUTHORIZED);
  assert.equal(windows.length, 5);

  assert.deepEqual(windows[0], {
    id: "gemini-weekly-7d-gemini",
    label: "7d - Gemini",
    kind: "weekly",
    model: "Gemini",
    usedPercent: 6,
    resetsAt: "2026-10-31T19:51:20.000Z",
  });
  assert.equal(windows[1]?.kind, "five-hour");
  assert.equal(windows[1]?.label, "5h - Gemini");
  assert.equal(windows[1]?.usedPercent, 0);
  assert.equal(windows[2]?.model, "Claude & GPT");
  assert.equal(windows[2]?.label, "7d - Claude");
  assert.equal(windows[2]?.usedPercent, 75);
  assert.equal(windows[3]?.label, "5h - Claude");
  assert.equal(windows[4]?.model, "Gemini 4 Argon");
  assert.equal(windows[4]?.label, "7d - Argon");
  assert.equal(windows[4]?.usedPercent, 30);
});

test("ignores ANSI colours and CRLF", () => {
  const output = [
    "\u001b[32mGemini Models\u001b[0m\tWeekly Limit Remaining\t94%\t2026-10-31T19:51:20Z\r",
    "",
    "not a usage row",
  ].join("\n");
  const windows = parseAgyUsage(output);
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.usedPercent, 6);
});

test("accepts space-separated output", () => {
  const windows = parseAgyUsage(
    "Gemini Models  Weekly Limit Remaining  94%  2026-10-31T19:51:20Z",
  );
  assert.equal(windows.length, 1);
  assert.equal(windows[0]?.kind, "weekly");
});

test("supports labels that report used instead of remaining", () => {
  const windows = parseAgyUsage(
    "Gemini Models\tWeekly Limit Used\t94%\t2026-10-31T19:51:20Z",
  );
  assert.equal(windows[0]?.usedPercent, 94);
});

test("returns ok when agy reports quota windows", async () => {
  const state = await readAgyUsage({
    run: async () => ({ stdout: AUTHORIZED, stderr: "" }),
  });
  assert.equal(state.status, "ok");
  if (state.status === "ok") assert.equal(state.windows.length, 5);
});

test("maps authentication output to unauthenticated", async () => {
  const state = await readAgyUsage({
    run: async () => {
      throw new CommandError("agy exited", {
        code: 1,
        stderr: AUTH_MESSAGE,
      });
    },
  });
  assert.deepEqual(state, { status: "unauthenticated" });
});

test("maps authentication output from a killed process to unauthenticated", async () => {
  const state = await readAgyUsage({
    run: async () => {
      throw new CommandError("agy timed out", {
        killed: true,
        stderr: AUTH_MESSAGE,
      });
    },
  });
  assert.deepEqual(state, { status: "unauthenticated" });
});

test("maps expired output to expired", async () => {
  const state = await readAgyUsage({
    run: async () => {
      throw new CommandError("agy exited", {
        code: 1,
        stderr: "invalid_grant: token expired",
      });
    },
  });
  assert.deepEqual(state, { status: "expired" });
});

test("maps ENOENT to not_installed", async () => {
  const state = await readAgyUsage({
    run: async () => {
      throw new CommandError("spawn agy ENOENT", { code: "ENOENT" });
    },
  });
  assert.deepEqual(state, { status: "not_installed" });
});

test("times out without an auth hint as an error", async () => {
  const state = await readAgyUsage({
    run: async () => {
      throw new CommandError("agy timed out", { killed: true });
    },
  });
  assert.equal(state.status, "error");
});

test("rejects empty output", async () => {
  const state = await readAgyUsage({
    run: async () => ({ stdout: "Remaining credits 0", stderr: "" }),
  });
  assert.equal(state.status, "error");
});
