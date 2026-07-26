import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/manual/20260726_formation_constraint_bootstrap.sql",
  ),
  "utf8",
);

assert.match(sql, /^BEGIN;/m);
assert.match(sql, /COMMIT;\s*$/);
assert.match(
  sql,
  /LOCK TABLE public\.representation_formation_sessions\s+IN SHARE ROW EXCLUSIVE MODE;/,
);
assert.match(
  sql,
  /GROUP BY business_representation_id\s+HAVING count\(\*\) > 1/,
);
assert.match(sql, /bootstrap refused: duplicate Formation sessions exist/);
assert.match(sql, /con\.contype = 'u'/);
assert.match(sql, /ind\.indisunique/);
assert.match(sql, /ind\.indisvalid/);
assert.match(sql, /ind\.indisready/);
assert.match(sql, /ind\.indpred IS NULL/);
assert.match(sql, /ind\.indexprs IS NULL/);
assert.match(sql, /ind\.indnkeyatts = 1/);
assert.match(sql, /ind\.indnatts = 1/);
assert.match(
  sql,
  /RENAME CONSTRAINT %I TO formation_session_representation_uniq/,
);
assert.doesNotMatch(sql, /\bDROP\s+(?:CONSTRAINT|INDEX|TABLE)\b/i);
assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
assert.doesNotMatch(sql, /supabase_migrations/i);

console.log("Formation constraint bootstrap static contract: PASS");
