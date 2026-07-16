import assert from "node:assert/strict";
import { validateEvidenceTurnIndexes } from "../../lib/voice/conversation-review/source-reference";

const transcript = [{ role: "customer", text: "Customer statement" }, { role: "agent", text: "Agent reply" }] as const;
assert.deepEqual(validateEvidenceTurnIndexes({ turnIndexes: [0] }, transcript, "customer"), [0]);
for (const [name, reference, expected] of [
  ["empty", { turnIndexes: [] }, /valid source references/],
  ["string", { turnIndexes: ["0"] }, /index is invalid/],
  ["null", { turnIndexes: [null] }, /index is invalid/],
  ["fractional", { turnIndexes: [0.5] }, /index is invalid/],
  ["negative", { turnIndexes: [-1] }, /index is invalid/],
  ["int4 overflow", { turnIndexes: [2147483648] }, /index is invalid/],
  ["extremely large", { turnIndexes: [1e100] }, /index is invalid/],
  ["int4 maximum outside transcript", { turnIndexes: [2147483647] }, /out of range/],
  ["out of range", { turnIndexes: [2] }, /out of range/],
  ["duplicate", { turnIndexes: [0, 0] }, /must be unique/],
] as const) assert.throws(() => validateEvidenceTurnIndexes(reference, transcript, "customer"), expected, name);
assert.throws(() => validateEvidenceTurnIndexes({ turnIndexes: [0] }, [null], "customer"), /transcript turn is invalid/);
assert.throws(() => validateEvidenceTurnIndexes({ turnIndexes: [1] }, transcript, "customer"), /speaker does not match/);
console.log("Conversation Review source-reference contract — PASS");
