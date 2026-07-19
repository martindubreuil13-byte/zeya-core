import assert from "node:assert/strict";

process.env.PUBLIC_EXPERIENCE_LIVE_LEARNING_TEST = "true";
process.env.ZEYA_VOICE_LEARNING_ENABLED = "true";
process.env.PUBLIC_EXPERIENCE_TEST_ELEMENT_KEY = "offer";

import("./public-experience-completion-deployed.test").catch((error: unknown) => {
  assert.fail(error instanceof Error ? error.message : "Phase 5B-C deployed vertical slice failed");
});
