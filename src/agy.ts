import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostUsageState, UsageWindow } from "./contract.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 1_000_000;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const TAB_SEPARATOR = /\t+/u;
const SPACE_SEPARATOR =
  /^(.+?)\s{2,}(.+?)\s{2,}(-?\d+(?:\.\d+)?)\s*%\s+(.+)$/u;
const AUTH_ERROR =
  /(authentication required|please visit the url to log in|waiting for authentication|authentication failed|not logged in|login required|sign in)/iu;
const EXPIRED_ERROR = /(token expired|invalid_grant|expired)/iu;
const DURATION_LABELS: Record<UsageWindow["kind"], string> = {
  "five-hour": "5h",
  daily: "1d",
  weekly: "7d",
  custom: "",
};
const MODEL_ORDER = [/argon/iu, /gemini/iu, /claude/iu] as const;

export class CommandError extends Error {
  readonly code: string | number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly killed: boolean;

  constructor(
    message: string,
    details: {
      code?: string | number;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "CommandError";
    this.code = details.code;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
    this.killed = details.killed ?? false;
  }
}

export interface RunOptions {
  timeoutMs: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

export interface ReadAgyUsageOptions {
  agyPath?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  run?: RunCommand;
}

export async function readAgyUsage(
  options: ReadAgyUsageOptions = {},
): Promise<HostUsageState> {
  const configuredPath =
    options.agyPath ?? process.env.ANTIGRAVITY_AGY_PATH ?? "";
  const candidates =
    configuredPath.trim() === ""
      ? defaultCandidates()
      : [configuredPath.trim()];
  const run = options.run ?? runCommand;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    NO_COLOR: "1",
    TERM: "dumb",
    LANG: "C",
    LC_ALL: "C",
    AGY_CLI_DISABLE_AUTO_UPDATE: "1",
  };

  for (const command of candidates) {
    try {
      const result = await run(command, ["--print", "/usage"], {
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env,
        cwd: homedir(),
      });
      return stateFromText(
        result.stdout,
        result.stderr,
        "agy returned no usage windows.",
      );
    } catch (cause) {
      const error = cause instanceof CommandError ? cause : null;
      const state = stateFromText(
        error?.stdout ?? "",
        error?.stderr ?? "",
        error?.killed
          ? "agy usage timed out."
          : "agy usage could not be collected.",
      );
      if (state.status !== "error") return state;
      if (error?.code === "ENOENT") continue;
      return state;
    }
  }

  return { status: "not_installed" };
}

export function parseAgyUsage(stdout: string): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const seen = new Map<string, number>();

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = stripAnsi(rawLine).trim();
    if (line === "") continue;
    const row = parseRow(line);
    if (!row) continue;

    const kind = windowKindFromLabel(row.label);
    const model = modelFamily(row.scope);
    const label = labelForWindow(kind, model, row.label);
    const baseId = slug(`${model ?? "antigravity"}-${kind}-${label}`);
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);

    windows.push({
      id: count === 0 ? baseId : `${baseId}-${count + 1}`,
      label,
      kind,
      model,
      usedPercent: usedPercentFromLabel(row.label, row.remainingPercent),
      resetsAt: isoOrNull(row.resetsAt),
    });
  }

  windows.sort(
    (left, right) => modelRank(left.model) - modelRank(right.model),
  );
  return windows;
}

function modelRank(model: string | null): number {
  if (model === null) return MODEL_ORDER.length;
  const index = MODEL_ORDER.findIndex((pattern) => pattern.test(model));
  return index === -1 ? MODEL_ORDER.length : index;
}

interface UsageRow {
  scope: string;
  label: string;
  remainingPercent: number;
  resetsAt: string;
}

function stateFromText(
  stdout: string,
  stderr: string,
  emptyMessage: string,
): HostUsageState {
  const windows = parseAgyUsage(stdout);
  if (windows.length > 0) return { status: "ok", windows };
  const output = `${stdout}\n${stderr}`;
  if (AUTH_ERROR.test(output)) return { status: "unauthenticated" };
  if (EXPIRED_ERROR.test(output)) return { status: "expired" };
  return { status: "error", message: emptyMessage };
}

function parseRow(line: string): UsageRow | null {
  const cells = line.split(TAB_SEPARATOR).map((cell) => cell.trim());
  if (cells.length >= 4) {
    const remainingPercent = parsePercent(cells[2] ?? "");
    if (
      remainingPercent !== null &&
      cells[0] !== "" &&
      cells[1] !== "" &&
      cells[3] !== ""
    ) {
      return {
        scope: cells[0],
        label: cells[1],
        remainingPercent,
        resetsAt: cells[3],
      };
    }
  }

  const match = SPACE_SEPARATOR.exec(line);
  if (!match) return null;
  const remainingPercent = parsePercent(match[3] ?? "");
  if (remainingPercent === null) return null;
  return {
    scope: (match[1] ?? "").trim(),
    label: (match[2] ?? "").trim(),
    remainingPercent,
    resetsAt: (match[4] ?? "").trim(),
  };
}

function parsePercent(value: string): number | null {
  const parsed = Number(value.replace(/%/gu, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function windowKindFromLabel(label: string): UsageWindow["kind"] {
  if (/five[\s-]?hour/iu.test(label)) return "five-hour";
  if (/\bdaily\b|\bday\b/iu.test(label)) return "daily";
  if (/\bweekly\b|\bweek\b/iu.test(label)) return "weekly";
  return "custom";
}

function labelForWindow(
  kind: UsageWindow["kind"],
  model: string | null,
  rawLabel: string,
): string {
  const duration = DURATION_LABELS[kind] || customLabel(rawLabel);
  return model === null ? duration : `${duration} - ${shortModel(model)}`;
}

function customLabel(label: string): string {
  const cleaned = label.replace(/\s+(?:remaining|used)$/iu, "").trim();
  if (/^month(?:ly)?\b/iu.test(cleaned)) return "Monthly";
  return cleaned === "" ? "Custom" : cleaned;
}

function shortModel(model: string): string {
  return model === "Gemini 4 Argon" ? "Argon" : model;
}

function modelFamily(scope: string): string | null {
  const value = scope.trim();
  if (value === "") return null;
  if (/^gemini(?:\s+models?)?$/iu.test(value)) return "Gemini";
  if (/^claude(?:\s+(?:and|&)\s+gpt)?(?:\s+models?)?$/iu.test(value)) {
    return "Claude & GPT";
  }
  if (/^(?:all\s+)?models?$/iu.test(value)) return null;
  return value;
}

function usedPercentFromLabel(label: string, percent: number): number {
  const consumed = /\bused\b/iu.test(label) ? percent : 100 - percent;
  return Math.max(0, Math.round(consumed * 100) / 100);
}

function isoOrNull(value: string): string | null {
  const text = value.trim();
  if (text === "" || text === "-") return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function slug(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
  const result = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return result === "" ? "window" : result;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function defaultCandidates(): string[] {
  const executable = process.platform === "win32" ? "agy.exe" : "agy";
  const home = homedir();
  const candidates = [executable, join(home, ".local", "bin", executable)];
  if (process.platform === "darwin") {
    candidates.push("/usr/local/bin/agy", "/opt/homebrew/bin/agy");
  } else if (process.platform === "linux") {
    candidates.push("/usr/local/bin/agy", "/usr/bin/agy");
  }
  return [...new Set(candidates)];
}

function runCommand(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        encoding: "utf8",
        windowsHide: true,
        env: options.env,
        cwd: options.cwd,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new CommandError(error.message, {
              code: error.code ?? undefined,
              stdout: String(stdout ?? ""),
              stderr: String(stderr ?? ""),
              killed: error.killed,
            }),
          );
          return;
        }
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}
