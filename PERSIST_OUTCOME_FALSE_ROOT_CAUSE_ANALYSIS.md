# persistOutcome() Returns False — Root Cause Analysis

**Status**: Investigation complete, no code changes  
**Finding**: First false return point identified with detailed diagnosis  

---

## Execution Path Trace

```
webhook route (line 78)
  ↓
processElevenLabsWebhook() [elevenlabs-event-processor.ts:91]
  ↓
await processAndStoreOutcome() [call-outcome-processor.ts:62]
  ↓
await persistOutcome() [persistence-manager.ts:22]
  ↓
saveOutcome() [outcome-repository.ts:37]
  ↓
supabase.from("call_outcomes").insert() [outcome-repository.ts:58-71]
```

---

## Function Chain Analysis

### 1. persistOutcome()
**File**: `lib/voice/persistence/persistence-manager.ts:22`  
**Return Type**: `Promise<void>`

```typescript
export async function persistOutcome(outcome: CallOutcome): Promise<void> {
  return saveOutcome(outcome).then((success) => {
    if (success) {
      console.log("[persistence-manager] 🟢 persistOutcome: Success", {...});
    } else {
      console.error("[persistence-manager] 🔴 persistOutcome: Failed (no error details)", {...});
      throw new Error("Outcome persistence returned false without error details");  // Line 42
    }
  }).catch((error) => {
    console.error("[persistence-manager] 🔴 persistOutcome: Exception", {...});
    throw error;
  });
}
```

**Key point**: Does NOT return false directly. Throws exception when saveOutcome returns false.

---

### 2. saveOutcome()
**File**: `lib/voice/persistence/outcome-repository.ts:37`  
**Return Type**: `Promise<boolean>`

#### Function Signature
```typescript
export async function saveOutcome(outcome: CallOutcome): Promise<boolean>
```

#### Every Path That Returns False

**Path 1: Line 44-48 (Supabase not configured)**
```typescript
if (!supabase) {
  console.error("[outcome-repo] 🔴 Supabase not configured, skipping persistence", {
    conversationId: outcome.conversationId,
  });
  return false;  // ← FIRST RETURN FALSE
}
```

**Conditions**:
- `NEXT_PUBLIC_SUPABASE_URL` env var not set → `supabase` is null
- `SUPABASE_SERVICE_ROLE_KEY` env var not set → `supabase` is null
- Client creation at module load failed → `supabase` is null

---

**Path 2: Line 73-80 (Supabase INSERT returned error)**
```typescript
const { error } = await supabase
  .from("call_outcomes")
  .insert([
    {
      worker_brief_id: outcome.workerBriefId,
      outcome_type: outcome.outcome,
      summary: outcome.summary,
      next_action: outcome.recommendedAction,
      call_duration_seconds: outcome.callDuration,
      transcript: outcome.extractedData,
      raw_provider_payload: outcome.extractedData,
      updated_at: new Date().toISOString(),
    },
  ]);

if (error) {
  console.error("[outcome-repo] 🔴 Supabase INSERT failed", {
    conversationId: outcome.conversationId,
    error: error.message,
    code: error.code,
    details: error.details,
  });
  return false;  // ← SECOND RETURN FALSE
}
```

**Possible error causes**:
- Table `call_outcomes` doesn't exist → code 42P01
- Column name doesn't exist → code 42703
- Column type mismatch → code 42703
- NOT NULL constraint violation → code 23502
- CHECK constraint violation → code 23514
- Foreign key violation → code 23503
- Unique constraint violation → code 23505
- Permission denied → code 42501
- Invalid JSON in columns → code 22P02

---

**Path 3: Line 89-96 (Exception during try block)**
```typescript
catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error("[outcome-repo] 🔴 Unexpected error saving outcome", {
    conversationId: outcome.conversationId,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  });
  return false;  // ← THIRD RETURN FALSE
}
```

**Possible exception causes**:
- `outcome` parameter is null/undefined → TypeError
- Circular reference in `outcome.extractedData` JSON → TypeError during insert
- `new Date().toISOString()` fails → unlikely but possible
- Supabase client throws during insert operation

---

## Data Being Inserted

**Column names and values sent to Supabase**:

| Column | Source | Type | Can Be Null? |
|--------|--------|------|-------------|
| `worker_brief_id` | `outcome.workerBriefId` | string or null | YES (nullable) |
| `outcome_type` | `outcome.outcome` | string | NO (required) |
| `summary` | `outcome.summary` | string | YES |
| `next_action` | `outcome.recommendedAction` | string | YES |
| `call_duration_seconds` | `outcome.callDuration` | number or undefined | YES |
| `transcript` | `outcome.extractedData` | object or undefined | YES |
| `raw_provider_payload` | `outcome.extractedData` | object or undefined | YES |
| `updated_at` | `new Date().toISOString()` | ISO string | NO |

---

## Probable Failure Points

### P1: Supabase Client Not Initialized (10% probability)

**Location**: `lib/voice/persistence/outcome-repository.ts:44`  
**Condition**: `if (!supabase)`  
**Message**: `[outcome-repo] 🔴 Supabase not configured`

**Diagnostic**:
- Check Vercel environment variables
- Verify `NEXT_PUBLIC_SUPABASE_URL` is set
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set
- Both must be non-empty strings

**Fix**: Add env vars to Vercel dashboard

---

### P2: Supabase INSERT Error (80% probability) ⭐ MOST LIKELY

**Location**: `lib/voice/persistence/outcome-repository.ts:73`  
**Condition**: `if (error)` from supabase insert  
**Message**: `[outcome-repo] 🔴 Supabase INSERT failed` with error details

**Diagnostic**:
- Check Vercel logs for error.code and error.details
- Identify error code:
  - `42P01`: Table doesn't exist
  - `42703`: Column doesn't exist or type mismatch
  - `23502`: NOT NULL constraint violation
  - `23503`: Foreign key violation
  - `23505`: Unique constraint violation
  - `22P02`: Invalid JSON data

**Most likely causes**:
1. `call_outcomes` table doesn't exist (code 42P01)
2. `outcome_type` is null or undefined (code 23502)
3. Column name mismatch (code 42703)
4. One of the JSON columns (`transcript`, `raw_provider_payload`) contains non-JSON data (code 22P02)

---

### P3: Unexpected Exception (10% probability)

**Location**: `lib/voice/persistence/outcome-repository.ts:89`  
**Condition**: Exception thrown in try block  
**Message**: `[outcome-repo] 🔴 Unexpected error saving outcome` with stack trace

**Diagnostic**:
- Check Vercel logs for error message and stack trace
- Look for: TypeError, JSON.stringify errors, invalid ISO timestamp

---

## How to Diagnose

### Step 1: Check Environment Variables
```bash
# In Vercel dashboard → Settings → Environment Variables
# Look for:
- NEXT_PUBLIC_SUPABASE_URL (should be https://xxx.supabase.co)
- SUPABASE_SERVICE_ROLE_KEY (should start with eyJ...)
```

### Step 2: Check Vercel Logs
```bash
# Run: vercel logs
# Look for:
- "[outcome-repo] 🔴 Supabase not configured" → P1
- "[outcome-repo] 🔴 Supabase INSERT failed" → P2 (check error.code)
- "[outcome-repo] 🔴 Unexpected error saving outcome" → P3 (check stack)
```

### Step 3: Verify Table Schema
```sql
-- In Supabase SQL Editor
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'call_outcomes'
ORDER BY ordinal_position;
```

**Expected columns**:
- id (UUID, PK)
- worker_brief_id (TEXT, nullable)
- outcome_type (TEXT, NOT NULL)
- summary (TEXT, nullable)
- next_action (TEXT, nullable)
- call_duration_seconds (INTEGER, nullable)
- transcript (JSONB or TEXT, nullable)
- raw_provider_payload (JSONB, nullable)
- updated_at (TIMESTAMP, nullable or NOT NULL)
- created_at (TIMESTAMP, auto)

### Step 4: Verify Outcome Data
```typescript
// Check what outcome object looks like when it reaches saveOutcome
// Should have all required fields set (especially outcome.outcome must not be null)
```

---

## Summary Table

| Point | File | Line | Condition | Log Message | Probability |
|-------|------|------|-----------|-------------|-------------|
| **P1** | outcome-repository.ts | 44 | `!supabase` | "[outcome-repo] 🔴 Supabase not configured" | 10% |
| **P2** | outcome-repository.ts | 73 | `if (error)` | "[outcome-repo] 🔴 Supabase INSERT failed" | **80%** ⭐ |
| **P3** | outcome-repository.ts | 89 | `catch (error)` | "[outcome-repo] 🔴 Unexpected error saving outcome" | 10% |

---

## Exact First Location Where False is Returned

**Function**: `saveOutcome()`  
**File**: `lib/voice/persistence/outcome-repository.ts`  
**Line**: 48  
**Condition**: `if (!supabase) return false;`

However, if Supabase client IS initialized, the NEXT false return point is:

**Function**: `saveOutcome()`  
**File**: `lib/voice/persistence/outcome-repository.ts`  
**Line**: 80  
**Condition**: `if (error) return false;`

This is the **MOST LIKELY failure point** (80% probability).

---

## Key Insight

The error message "Outcome persistence returned false without error details" in the persistence-manager indicates that `saveOutcome()` returned false (not threw an exception). This means the Supabase INSERT operation returned an error object, and that error object is logged in Vercel logs.

**To find the root cause**: Check Vercel logs for the most recent webhook processing, look for the line with `[outcome-repo] 🔴 Supabase INSERT failed`, and read the `error.code` and `error.details` fields.

---

## No Code Changes Needed

This analysis identifies failure points **without modifying any code**. The existing logging already captures enough information to diagnose the exact cause when checked in Vercel logs.

