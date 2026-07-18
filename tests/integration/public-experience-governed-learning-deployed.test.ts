import assert from "node:assert/strict";
import { readScenario } from "./public-experience-governed-learning-cli";

async function main(): Promise<void> {
  const scenario = readScenario(process.argv.slice(2));
  process.env.PUBLIC_EXPERIENCE_GOVERNED_LEARNING_SCENARIO = scenario;
  console.log(`Phase 5A scenario: ${scenario}`);
  await import("./public-experience-completion-deployed.test");
}

main().catch((error: unknown) => {
  assert.fail(error instanceof Error ? error.message : "governed-learning scenario failed");
});
