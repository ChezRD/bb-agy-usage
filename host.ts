import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { readAgyUsage } from "./src/agy.js";
import {
  hostUsageStateSchema,
  usageHostContract,
} from "./src/contract.js";

export default experimental_defineHostEntry({
  contract: usageHostContract,
  handlers: {
    async "usage.readAntigravity"({ agyPath }) {
      return hostUsageStateSchema.parse(await readAgyUsage({ agyPath }));
    },
  },
});
