import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  usageHostContract,
  usageWindowKindSchema,
  type HostUsageState,
} from "./src/contract.js";

const PROVIDER_ID = "acp-antigravity";
const LIST_RESOURCES = "provider-usage.v1.listResources";
const GET_RESOURCE = "provider-usage.v1.getResource";
const CACHE_TTL_MS = 60_000;

const usageWindowMeasurementSchema = z.object({
  kind: usageWindowKindSchema,
  id: z.string().min(1),
  label: z.string().min(1),
  usedPercent: z.number().nonnegative(),
  resetsAt: z.string().nullable(),
  model: z.string().nullable(),
  cost: z
    .object({
      usedUsdCents: z.number().nonnegative(),
      limitUsdCents: z.number().positive(),
    })
    .nullable(),
});

const unavailableAccount = {
  plan: z.null(),
  accountEmail: z.null(),
  planLabel: z.null(),
};

const usageStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    plan: z.null(),
    accountEmail: z.string().nullable(),
    planLabel: z.string().nullable(),
    windows: z.array(usageWindowMeasurementSchema),
  }),
  z.object({ status: z.literal("not_installed"), ...unavailableAccount }),
  z.object({ status: z.literal("unauthenticated"), ...unavailableAccount }),
  z.object({ status: z.literal("expired"), ...unavailableAccount }),
  z.object({
    status: z.literal("error"),
    ...unavailableAccount,
    message: z.string(),
  }),
]);

const usageMeasurementSchema = z.object({
  accountKey: z.string().min(1).nullable(),
  observedAt: z.number().int().nonnegative().nullable(),
  usage: usageStateSchema,
});

type UsageMeasurement = z.infer<typeof usageMeasurementSchema>;

const usageSourceContract = defineRpcContract({
  [LIST_RESOURCES]: {
    input: z.object({}),
    output: z.object({
      label: z.string().min(1).optional(),
      resources: z.array(
        z.object({
          accountKey: z.string().min(1).nullable(),
          id: z.string().min(1),
          providerId: z.string().min(1),
          label: z.string().min(1),
          scope: z.object({
            kind: z.literal("host"),
            hostId: z.string().min(1),
            hostName: z.string().min(1),
          }),
        }),
      ),
    }),
  },
  [GET_RESOURCE]: {
    input: z.object({
      resourceId: z.string().min(1),
      refresh: z.boolean(),
    }),
    output: usageMeasurementSchema,
  },
});

export default function plugin(bb: BbPluginApi): void {
  const settings = bb.settings.define({
    agyPath: {
      type: "string",
      label: "agy executable",
      default: "",
      description:
        "Absolute path to the agy CLI. Leave empty to resolve agy from PATH.",
    },
  });
  const host = bb.hosts.experimental_client({ contract: usageHostContract });
  const cache = new Map<
    string,
    { measuredAt: number; measurement: UsageMeasurement }
  >();

  bb.rpc.register(
    usageSourceContract,
    {
      async [LIST_RESOURCES]() {
        const hosts = await bb.sdk.hosts.list();
        return {
          resources: hosts
            .filter((entry) => entry.status === "connected")
            .map((entry) => ({
              accountKey: null,
              id: entry.id,
              providerId: PROVIDER_ID,
              label: "Antigravity",
              scope: {
                kind: "host" as const,
                hostId: entry.id,
                hostName: entry.name,
              },
            })),
        };
      },

      async [GET_RESOURCE]({ resourceId, refresh }) {
        const values = await settings
          .get()
          .catch(() => ({ agyPath: "" }));
        const configuredPath =
          typeof values.agyPath === "string" ? values.agyPath.trim() : "";
        const agyPath = configuredPath === "" ? undefined : configuredPath;
        const cacheKey = `${resourceId}\u0000${agyPath ?? ""}`;
        const cached = cache.get(cacheKey);
        if (
          !refresh &&
          cached !== undefined &&
          Date.now() - cached.measuredAt < CACHE_TTL_MS
        ) {
          return cached.measurement;
        }

        const state = await host.call(
          "usage.readAntigravity",
          agyPath === undefined ? {} : { agyPath },
          {
            hostId: resourceId,
            timeoutMs: 20_000,
          },
        );
        const measurement = toMeasurement(
          state,
          cached?.measurement.observedAt ?? null,
        );
        cache.set(cacheKey, {
          measuredAt: Date.now(),
          measurement,
        });
        return measurement;
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Antigravity quota windows reported by the agy CLI on each host.",
    },
  );
}

export function toMeasurement(
  state: HostUsageState,
  previousObservedAt: number | null,
): UsageMeasurement {
  const base = {
    accountKey: null,
    observedAt: state.status === "ok" ? Date.now() : previousObservedAt,
  };

  if (state.status === "ok") {
    return {
      ...base,
      usage: {
        status: "ok",
        plan: null,
        accountEmail: null,
        planLabel: "Antigravity",
        // BB rewrites five-hour/weekly labels from kind and model. Keeping the
        // short label (`5h - Claude`, `7d - Gemini`) means emitting it as a
        // custom window so BB passes it through unchanged.
        windows: state.windows.map((window) => ({
          ...window,
          kind: "custom",
          model: null,
          cost: null,
        })),
      },
    };
  }

  if (state.status === "unauthenticated") {
    return {
      ...base,
      usage: errorUsage(
        "Sign in to Antigravity in agy on this machine, then reload.",
      ),
    };
  }

  if (state.status === "expired") {
    return {
      ...base,
      usage: errorUsage(
        "Your Antigravity session in agy expired. Sign in again, then reload.",
      ),
    };
  }

  if (state.status === "error") {
    return { ...base, usage: errorUsage(state.message) };
  }

  return {
    ...base,
    usage: {
      status: state.status,
      plan: null,
      accountEmail: null,
      planLabel: null,
    },
  };
}

function errorUsage(message: string) {
  return {
    status: "error" as const,
    plan: null,
    accountEmail: null,
    planLabel: null,
    message,
  };
}
