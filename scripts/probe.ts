import { readAgyUsage } from "../src/agy.js";

const state = await readAgyUsage();
console.log(JSON.stringify(state, null, 2));
