import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readScenario } from "./public-experience-governed-learning-cli";

const entrypoint = readFileSync(resolve(process.cwd(), "tests/integration/public-experience-governed-learning-deployed.test.ts"), "utf8");
assert.match(entrypoint, /process\.argv\.slice\(2\)/u, "CLI entrypoint must slice process.argv");
for (const scenario of ["provenance", "frozen", "authority", "isolation"] as const) {
  assert.equal(readScenario(["--scenario", scenario]), scenario);
}
assert.throws(() => readScenario(["--scenario", "invalid"]), /unknown governed-learning scenario: invalid/);
assert.throws(() => readScenario(["--scenario"]), /missing governed-learning scenario/);
assert.throws(() => readScenario(["/opt/homebrew/bin/node", "tests/example.ts"]), /missing governed-learning scenario/);
console.log("Public Experience governed-learning CLI static contract — PASS");
