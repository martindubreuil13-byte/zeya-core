# persistOutcome() Returns False — Quick Diagnosis Guide

**Where to look**: Vercel logs  
**What you're searching for**: `[outcome-repo]` error messages  
**Time to diagnose**: 2 minutes  

---

## Three Possible Failure Points

Run through these IN ORDER:

### 1. Check: Supabase Client Configured? (10% likely)

**Look in Vercel logs for**:
```
[outcome-repo] 🔴 Supabase not configured, skipping persistence
```

**If found**:
- Missing env var: `NEXT_PUBLIC_SUPABASE_URL`
- Missing env var: `SUPABASE_SERVICE_ROLE_KEY`
- **Fix**: Add both to Vercel environment variables

**If NOT found**: Continue to #2

---

### 2. Check: Supabase INSERT Error? (80% likely) ⭐ MOST PROBABLE

**Look in Vercel logs for**:
```
[outcome-repo] 🔴 Supabase INSERT failed
```

**If found, look at the error details**:
```
error: "..."
code: "..."
details: "..."
```

**Error code meanings**:
- `42P01` → Table doesn't exist (create `call_outcomes` table)
- `42703` → Column doesn't exist or type mismatch
- `23502` → NOT NULL constraint failed (outcome_type is null)
- `23503` → Foreign key violation
- `23505` → Unique constraint violated
- `22P02` → Invalid JSON in transcript or raw_provider_payload
- `42501` → Permission denied on table

**If found**: This is the cause. Fix the specific error (see code above).

**If NOT found**: Continue to #3

---

### 3. Check: Unexpected Exception? (10% likely)

**Look in Vercel logs for**:
```
[outcome-repo] 🔴 Unexpected error saving outcome
```

**If found, look at**:
```
message: "..."
stack: "..."
```

**Common issues**:
- TypeError: outcome.outcome is null
- JSON serialization error in extractedData
- Invalid timestamp format

---

## Before Calling saveOutcome()

These succeed:
- ✅ Signature verification
- ✅ Payload validation
- ✅ Outcome building
- ✅ persistOutcome() is called

**Therefore**: The failure is ONLY in saveOutcome() trying to INSERT to Supabase.

---

## Three Return False Points (in order)

1. **Line 44**: `if (!supabase) return false;`
   - Log: `Supabase not configured`
   - Probability: 10%

2. **Line 73**: `if (error) return false;`
   - Log: `Supabase INSERT failed` + error details
   - Probability: **80%** ⭐

3. **Line 89**: `catch (error) { return false; }`
   - Log: `Unexpected error saving outcome` + stack
   - Probability: 10%

---

## Exact Diagnosis Procedure

```bash
# 1. Get Vercel logs
vercel logs

# 2. Search for outcome-repo error
# Look for line with: [outcome-repo] 🔴

# 3. Read the error message
# If "Supabase INSERT failed":
#   - Check error.code (see code meanings above)
#   - Check error.details
#   - That's your root cause

# 4. If no error visible:
#   - The failure might not have logged
#   - Try triggering webhook again
#   - Check logs again
```

---

## Most Likely Root Cause

80% chance: Supabase INSERT error (code 42P01)

**Most probable**: `call_outcomes` table doesn't exist

**Verify**:
```sql
-- In Supabase SQL Editor
SELECT COUNT(*) FROM call_outcomes;
-- If error: relation "call_outcomes" does not exist
-- Then table needs to be created
```

---

## Summary

| Scenario | Evidence | Solution |
|----------|----------|----------|
| Supabase not configured | Log: `Supabase not configured` | Add env vars |
| Table missing | Log: `Supabase INSERT failed` + code 42P01 | Create table |
| Column missing | Log: `Supabase INSERT failed` + code 42703 | Check schema |
| outcome_type null | Log: `Supabase INSERT failed` + code 23502 | Verify outcome.outcome |
| Other error | Log: `Supabase INSERT failed` + code + details | See error.code meanings |
| Exception | Log: `Unexpected error saving outcome` + stack | Check stack trace |

