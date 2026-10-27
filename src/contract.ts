import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const usageWindowKindSchema = z.enum([
  "five-hour",
  "daily",
  "weekly",
  "custom",
]);

export const usageWindowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: usageWindowKindSchema,
  model: z.string().nullable(),
  usedPercent: z.number().nonnegative(),
  resetsAt: z.string().nullable(),
});

export type UsageWindow = z.infer<typeof usageWindowSchema>;

export const hostUsageStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    windows: z.array(usageWindowSchema),
  }),
  z.object({ status: z.literal("not_installed") }),
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

export type HostUsageState = z.infer<typeof hostUsageStateSchema>;

export const usageHostContract = defineRpcContract({
  "usage.readAntigravity": {
    input: z.object({
      agyPath: z.string().min(1).optional(),
    }),
    output: hostUsageStateSchema,
  },
});
