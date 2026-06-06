# ElevenLabs Webhook Schema Gap Analysis

**Date**: 2026-06-06  
**Status**: Analysis of expected schema vs. requirements  
**Scope**: Compare webhook payload schema against our validator and type definitions  

---

## Executive Summary

Our webhook validator expects a specific schema from ElevenLabs post-call webhooks. This analysis identifies:

1. **Required fields** (must be present for validation to pass)
2. **Optional fields** (may be present)
3. **Potential mismatches** between our expectations and ElevenLabs implementation
4. **Recommendations** for robustness

---

## Webhook Schema Expected by Zeya

### Top-Level Structure

**File**: `lib/voice/events/elevenlabs-event-types.ts`

```typescript
{
  type: "post_call_transcription",           // REQUIRED
  event_timestamp: number,                   // REQUIRED (milliseconds or seconds?)
  data: {
    conversation_id: string,                 // REQUIRED
    agent_id: string,                        // REQUIRED
    status: "done" | "failed",               // REQUIRED
    user_id?: string,                        // OPTIONAL
    agent_name?: string,                     // OPTIONAL
    transcript: Array<{                      // REQUIRED (must be array)
      role: "user" | "agent",                // Required in each segment
      message: string,                       // Required in each segment
      timestamp?: number                     // Optional in each segment
    }>,
    summary?: string,                        // OPTIONAL
    call_duration?: number,                  // OPTIONAL (seconds?)
    extracted_data?: Record<string, unknown>,// OPTIONAL
    has_audio?: boolean,                     // OPTIONAL
    has_user_audio?: boolean,                // OPTIONAL
    has_response_audio?: boolean,            // OPTIONAL
    metadata?: Record<string, unknown>       // OPTIONAL
  }
}
```

---

## Validation Requirements (elevenlabs-event-validator.ts)

### isPostCallTranscriptionWebhook() Checks

**Line 14-22**: These must all pass:

| Check | Field | Type | Required |
|-------|-------|------|----------|
| ✅ | `e.type` | string (must equal "post_call_transcription") | YES |
| ✅ | `e.event_timestamp` | number | YES |
| ✅ | `e.data` | object | YES |
| ✅ | `e.data.conversation_id` | string | YES |
| ✅ | `e.data.agent_id` | string | YES |
| ✅ | `e.data.status` | string (any value) | YES |
| ✅ | `e.data.transcript` | array (any content) | YES |

**Note**: The validator checks type but not value for `status`. It accepts any string, though code expects "done" or "failed".

---

## Identified Gaps & Potential Issues

### Gap 1: Timestamp Format Unknown

**Our Code Expects**: `event_timestamp: number`  
**Unclear**: Is this seconds or milliseconds since epoch?

**Evidence**: No type specification in code

**Risk**: If ElevenLabs sends timestamp in different unit, we won't catch it

**Recommendation**: Clarify with ElevenLabs documentation

---

### Gap 2: Status String Validation

**Our Type Definition**:
```typescript
status: "done" | "failed"
```

**Our Validator**:
```typescript
if (typeof data.status !== "string") return false;
```

**Problem**: Validator checks type but accepts ANY string value  
**Risk**: Webhook with status="pending" would pass validation but fail in outcome detection

**Fix Needed**:
```typescript
// Add in validator
if (!["done", "failed"].includes(data.status)) return false;
```

---

### Gap 3: Call Duration Units Unknown

**Our Type Definition**:
```typescript
call_duration?: number
```

**Unclear**: Is this seconds or milliseconds?

**Evidence**: No comment specifying units

**Risk**: Outcome logic might use it wrong (e.g., duration < 10 to detect voicemail)

**Recommendation**: Standardize on seconds and add comment

---

### Gap 4: Transcript Array Requirements

**Our Type Definition**:
```typescript
transcript: ElevenLabsTranscriptSegment[]
```

**Our Validator**:
```typescript
if (!Array.isArray(data.transcript)) return false;
```

**Problem**: Validator accepts EMPTY array  
**Risk**: Webhook with `transcript: []` passes validation

**Fix Needed**:
```typescript
// Add in validator
if (!Array.isArray(data.transcript) || data.transcript.length === 0) return false;
```

---

### Gap 5: Transcript Segment Validation Missing

**Our Type Definition**:
```typescript
role: "user" | "agent"
message: string
timestamp?: number
```

**Our Validator**:
```typescript
// NO VALIDATION of transcript segments
if (!Array.isArray(data.transcript)) return false;
// ^ Just checks array exists, not contents
```

**Problem**: Could have malformed segments  
**Risk**: Code that iterates transcript expects `role` and `message` fields

**Fix Needed**:
```typescript
// Validate each segment
for (const segment of data.transcript) {
  if (typeof segment.message !== "string") return false;
  if (!["user", "agent"].includes(segment.role)) return false;
}
```

---

### Gap 6: Extracted Data Type

**Our Type Definition**:
```typescript
extracted_data?: Record<string, unknown>
```

**Our Validator**:
```typescript
// NO VALIDATION - completely unvalidated
```

**Problem**: Could be any type  
**Risk**: Code depending on structure will break silently

**Recommendation**: Define expected structure or validate it exists if present

---

### Gap 7: Summary Field Handling

**Our Code**:
```typescript
summary: conversation.summary || "No summary provided"
```

**Issue**: If ElevenLabs sends null or empty string instead of undefined, this still uses it

**Risk**: Could create misleading outcomes based on empty summary

---

## Schema Comparison vs ElevenLabs API

Since conversation retrieval via API failed, here's what we know from standard webhook practices:

| Field | ElevenLabs Likely | Our Expectation | Status |
|-------|------------------|-----------------|--------|
| type | "post_call_transcription" | Same | ✅ Matches |
| event_timestamp | Unix timestamp (seconds) | number | ✅ Matches |
| conversation_id | UUID string | string | ✅ Matches |
| agent_id | UUID string | string | ✅ Matches |
| status | "done", "failed", "in_progress" | "done" \| "failed" | ⚠️ Partial |
| transcript | Array of {role, message, timestamp} | Same structure | ✅ Likely matches |
| summary | String or null | string (optional) | ✅ Matches |
| call_duration | Seconds (integer) | number | ✅ Likely matches |
| extracted_data | Object | Record<string, unknown> | ✅ Matches |
| Additional fields | May exist | Ignored | ✅ OK |

---

## Risks if ElevenLabs Schema Differs

### Risk 1: Missing Required Field
If ElevenLabs doesn't send a required field:
- Webhook validation fails (HTTP 400)
- Callback webhook returns error
- ElevenLabs may retry, eventually give up
- Result: Webhook never processed

**Currently Vulnerable**: conversation_id, agent_id, status, transcript

---

### Risk 2: Wrong Data Type
If ElevenLabs sends wrong type for a field:
- Webhook validation fails
- Same result as missing field

**Currently Vulnerable**: 
- event_timestamp (number?)
- call_duration (number?)
- status (string, but only "done"/"failed"?)

---

### Risk 3: Extra Fields Present
If ElevenLabs sends fields we don't expect:
- No impact - our validator ignores them ✅

---

### Risk 4: Validation Passes But Processing Fails
If webhook passes validation but our processing code doesn't handle the value:
- Processing breaks silently
- Outcome never generated
- No error to webhook

**Currently Vulnerable**:
- status with unexpected value ("in_progress", "pending")
- Empty transcript array
- Missing transcript segments
- Empty summary string

---

## Recommended Validator Improvements

### Before Deploying to Production

**File**: `lib/voice/events/elevenlabs-event-validator.ts`

Add these checks to `isPostCallTranscriptionWebhook()`:

```typescript
// Validate status value (not just type)
const validStatuses = ["done", "failed"];
if (!validStatuses.includes(data.status)) return false;

// Validate transcript is non-empty
if (data.transcript.length === 0) return false;

// Validate transcript segments
for (const segment of data.transcript) {
  if (typeof segment.message !== "string") return false;
  if (!["user", "agent"].includes(segment.role)) return false;
}

// Validate summary if present
if (data.summary !== undefined && typeof data.summary !== "string") return false;

// Validate call_duration if present
if (data.call_duration !== undefined && typeof data.call_duration !== "number") return false;
```

---

## Summary Table

| Gap | Severity | Current | Impact | Fix |
|-----|----------|---------|--------|-----|
| Status validation | HIGH | Type-only | Unexpected status values pass | Add value check |
| Transcript validation | HIGH | Array-only | Empty array passes | Add length + segment checks |
| Call duration units | MEDIUM | Unknown | Wrong calculations | Add documentation |
| Timestamp units | MEDIUM | Unknown | Timing logic off | Clarify units |
| Summary handling | LOW | Truthy-only | Empty string used | Add null check |
| Extracted data validation | LOW | None | Unexpected structure | Consider validation |

---

## Verification Next Steps

To definitively close these gaps:

1. **Get real webhook**: Trigger a call and inspect actual ElevenLabs payload
2. **Compare against schema**: Check all fields, types, and values
3. **Update validators**: Add stricter validation based on actual data
4. **Test edge cases**: Empty array, null values, unexpected strings
5. **Document assumptions**: Add comments about units and ranges

---

## Conclusion

The webhook validator is **permissive** but **incomplete**:

- ✅ Catches completely missing fields
- ✅ Catches wrong types for major fields
- ❌ Doesn't validate field VALUES (status, transcript content)
- ❌ Doesn't require non-empty transcript
- ❌ Doesn't validate transcript segments
- ❌ Makes assumptions about units (seconds vs milliseconds)

**Result**: Webhook might pass validation but fail processing if ElevenLabs data structure differs slightly from our assumptions.

**Recommendation**: Deploy current fix for signature verification, then tighten validator based on actual webhook payloads once calls start flowing.

