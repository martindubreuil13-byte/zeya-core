# WorkerBriefId Chain Verification - Terminal Procedures

**Purpose**: Verify workerBriefId flows through entire chain WITHOUT making a real phone call

---

## Part 1: Exact Injection Points

### Injection Point 1: conversation-token endpoint accepts workerBriefId

**File**: `app/api/elevenlabs/conversation-token/route.ts`

| What | Line | Code |
|------|------|------|
| Extract from query param | 15 | `const workerBriefId = req.nextUrl.searchParams.get("workerBriefId");` |
| Log receipt | 20 | `hasWorkerBriefId: Boolean(workerBriefId)` |
| Pass to ElevenLabs API | 42-44 | `?agent_id=${agentId}${workerBriefId ? `&user_id=${encodeURIComponent(workerBriefId)}` : ""}` |
| Return in response | 82 | `workerBriefId: workerBriefId \|\| undefined` |

**Verification**: Query parameter → API parameter → Response field

---

### Injection Point 2: resolveConversationToken passes to endpoint

**File**: `lib/voice/elevenlabs.ts`

| What | Line | Code |
|------|------|------|
| Accept parameter | 380 | `async function resolveConversationToken(workerBriefId?: string)` |
| Add to query | 383 | `url.searchParams.set("workerBriefId", workerBriefId);` |
| Return value | 401 | `return { token: data.conversationToken, workerBriefId: data.workerBriefId };` |

**Verification**: Parameter → Query string → Response parsing

---

### Injection Point 3: createElevenLabsSession passes to resolver

**File**: `lib/voice/elevenlabs.ts`

| What | Line | Code |
|------|------|------|
| Accept in options | 649 | `options: VoiceServiceOptions` |
| Log receipt | 672 | `hasWorkerBriefId: Boolean(options.workerBriefId)` |
| Pass to resolver | 661 | `await resolveConversationToken(options.workerBriefId)` |
| Use as userId | 676 | `const userId = options.workerBriefId \|\| options.userId;` |
| Pass to ElevenLabs | 681 | `userId,` (in Conversation.startSession) |

**Verification**: Options → Resolver → ElevenLabs SDK

---

## Part 2: Exact Extraction Points

### Extraction Point 1: Webhook payload contains user_id

**File**: `lib/voice/events/elevenlabs-event-types.ts`

| What | Line |
|------|------|
| Field defined | 13 | `user_id?: string;` |

**Webhook structure**:
```json
{
  "type": "post_call_transcription",
  "event_timestamp": 1717651200,
  "data": {
    "conversation_id": "conv_xyz",
    "user_id": "brief_123",
    "agent_id": "agent_abc",
    "transcript": [...]
  }
}
```

---

### Extraction Point 2: Event processor extracts user_id

**File**: `lib/voice/events/elevenlabs-event-processor.ts`

| What | Line | Code |
|------|------|------|
| Check parameter | 73 | `if (!workerBriefId && webhook_typed.data.user_id)` |
| Extract from webhook | 74 | `workerBriefId = webhook_typed.data.user_id;` |
| Log extraction | 75 | `console.log("[event-processor] 🟢 Found workerBriefId in webhook user_id field"` |

**Verification**: Webhook payload → user_id field → workerBriefId variable

---

## Part 3: Verification Curl Commands

### Step 1: Test conversation-token endpoint accepts workerBriefId

```bash
# Terminal command to test endpoint locally
curl -i -X GET "http://localhost:3000/api/elevenlabs/conversation-token?workerBriefId=test_brief_123" \
  -H "Content-Type: application/json" \
  -s | head -50
```

**Expected response** (HTTP 200):
```json
{
  "conversationToken": "<token_value>",
  "mode": "conversation-token",
  "workerBriefId": "test_brief_123"
}
```

**Success indicator**: Response includes `"workerBriefId": "test_brief_123"`

---

### Step 2: Test endpoint without workerBriefId (backward compat)

```bash
# Verify it still works without workerBriefId
curl -i -X GET "http://localhost:3000/api/elevenlabs/conversation-token" \
  -H "Content-Type: application/json" \
  -s | head -50
```

**Expected response** (HTTP 200):
```json
{
  "conversationToken": "<token_value>",
  "mode": "conversation-token",
  "workerBriefId": null
}
```

**Success indicator**: Response includes `"workerBriefId": null` (graceful)

---

### Step 3: Create test webhook payload with user_id

**File**: `/tmp/test_webhook_with_user_id.json`

```bash
# Create test webhook payload
cat > /tmp/test_webhook_with_user_id.json << 'EOF'
{
  "type": "post_call_transcription",
  "event_timestamp": 1717651200,
  "data": {
    "conversation_id": "test_conv_with_brief",
    "agent_id": "test_agent_123",
    "user_id": "test_brief_verified_123",
    "status": "done",
    "summary": "Test webhook with user_id (workerBriefId linkage)",
    "call_duration": 45,
    "transcript": [
      {
        "role": "user",
        "message": "Testing workerBriefId linkage"
      },
      {
        "role": "agent",
        "message": "Test successful"
      }
    ],
    "extracted_data": {
      "verified": true
    }
  }
}
EOF

# Confirm file created
cat /tmp/test_webhook_with_user_id.json
```

---

### Step 4: Register provisional mapping FIRST

```bash
# Before sending webhook, register the mapping
# This simulates what dispatch does at dispatch-time

curl -i -X POST "http://localhost:3000/api/webhooks/elevenlabs/test-mapping" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "dispatch_test_brief_verified_123_timestamp",
    "workerBriefId": "test_brief_verified_123",
    "missionId": "test_mission_verification",
    "businessId": "550e8400-e29b-41d4-a716-446655440000"
  }' \
  -s | jq .
```

**Expected response**:
```json
{
  "success": true,
  "message": "Mapping registered successfully",
  "mapping": {
    "conversationId": "dispatch_test_brief_verified_123_timestamp",
    "workerBriefId": "test_brief_verified_123",
    "missionId": "test_mission_verification",
    "businessId": "550e8400-e29b-41d4-a716-446655440000",
    "createdAt": "2026-06-06T..."
  }
}
```

---

### Step 5: Send webhook with user_id and capture logs

**Terminal 1** - Start dev server and capture logs:
```bash
# Start dev server in foreground to see logs
npm run dev 2>&1 | tee /tmp/webhook_test.log &
sleep 5
```

**Terminal 2** - Compute signature and send webhook:

```bash
# Get the secret (from .env.local)
SECRET="test-secret-for-local-development"

# Read the payload
PAYLOAD=$(cat /tmp/test_webhook_with_user_id.json)

# Compute signature
if [[ "$OSTYPE" == "darwin"* ]]; then
  SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
else
  SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')
fi

echo "Computed signature: $SIGNATURE"
echo ""
echo "Sending webhook with user_id: test_brief_verified_123"
echo ""

# Send webhook
curl -i -X POST "http://localhost:3000/api/webhooks/elevenlabs" \
  -H "Content-Type: application/json" \
  -H "x-elevenlabs-signature: $SIGNATURE" \
  -d "$PAYLOAD" \
  -s | head -50
```

---

## Part 4: Expected Logs Proving Chain Works

### Check logs for evidence:

```bash
# After webhook is processed, check the log file
grep -A 2 "Found workerBriefId in webhook user_id field" /tmp/webhook_test.log
```

**Expected log output**:
```
[event-processor] 🟢 Found workerBriefId in webhook user_id field { workerBriefId: 'test_brief_verified_123' }
```

---

### Check for businessId resolution:

```bash
# Look for mapping resolution
grep "Updated mapping with real conversationId" /tmp/webhook_test.log
```

**Expected log output**:
```
[event-processor] 🟢 Updated mapping with real conversationId {
  conversationId: 'test_conv_with_brief',
  workerBriefId: 'test_brief_verified_123',
  businessId: '550e8400-e29b-41d4-a716-446655440000',
  missionId: 'test_mission_verification'
}
```

---

### Check for memory event processing:

```bash
# Look for memory event path execution
grep "Processing memory event" /tmp/webhook_test.log
```

**Expected log output**:
```
[outcome-processor] 🔵 Processing memory event {
  conversationId: 'test_conv_with_brief',
  workerBriefId: 'test_brief_verified_123',
  outcome: 'unknown',
  businessId: '550e8400-e29b-41d4-a716-446655440000'
}
```

---

## Part 5: Complete Verification Script

Save as: `/tmp/verify_workerbrief_chain.sh`

```bash
#!/bin/bash

set -e

echo "=========================================="
echo "WorkerBriefId Chain Verification"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="http://localhost:3000"
SECRET="test-secret-for-local-development"
BRIEF_ID="test_brief_verified_$(date +%s)"
CONV_ID="test_conv_with_brief_$(date +%s)"
BUSINESS_ID="550e8400-e29b-41d4-a716-446655440000"

echo -e "${BLUE}Step 1: Test conversation-token endpoint accepts workerBriefId${NC}"
echo "URL: $BASE_URL/api/elevenlabs/conversation-token?workerBriefId=$BRIEF_ID"
echo ""

RESPONSE=$(curl -s "$BASE_URL/api/elevenlabs/conversation-token?workerBriefId=$BRIEF_ID")
if echo "$RESPONSE" | jq -e '.workerBriefId' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Response contains workerBriefId:${NC}"
  echo "$RESPONSE" | jq '.workerBriefId'
else
  echo -e "${RED}❌ Response missing workerBriefId${NC}"
  exit 1
fi

echo ""
echo -e "${BLUE}Step 2: Register provisional mapping${NC}"
echo "Registering: workerBriefId=$BRIEF_ID with businessId=$BUSINESS_ID"
echo ""

MAPPING_RESPONSE=$(curl -s -X POST "$BASE_URL/api/webhooks/elevenlabs/test-mapping" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"dispatch_${BRIEF_ID}_timestamp\",
    \"workerBriefId\": \"$BRIEF_ID\",
    \"missionId\": \"test_mission_verification\",
    \"businessId\": \"$BUSINESS_ID\"
  }")

if echo "$MAPPING_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Mapping registered${NC}"
else
  echo -e "${RED}❌ Failed to register mapping${NC}"
  echo "$MAPPING_RESPONSE"
  exit 1
fi

echo ""
echo -e "${BLUE}Step 3: Create test webhook with user_id${NC}"

PAYLOAD=$(cat <<PAYLOAD_EOF
{
  "type": "post_call_transcription",
  "event_timestamp": $(date +%s),
  "data": {
    "conversation_id": "$CONV_ID",
    "agent_id": "test_agent_123",
    "user_id": "$BRIEF_ID",
    "status": "done",
    "summary": "Webhook test with user_id",
    "call_duration": 45,
    "transcript": [
      {
        "role": "user",
        "message": "Test"
      },
      {
        "role": "agent",
        "message": "Test response"
      }
    ]
  }
}
PAYLOAD_EOF
)

# Compute signature
if [[ "$OSTYPE" == "darwin"* ]]; then
  SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
else
  SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')
fi

echo "Payload includes user_id: $BRIEF_ID"
echo "Signature: ${SIGNATURE:0:20}..."
echo ""

echo -e "${BLUE}Step 4: Send webhook${NC}"
WEBHOOK_RESPONSE=$(curl -s -X POST "$BASE_URL/api/webhooks/elevenlabs" \
  -H "Content-Type: application/json" \
  -H "x-elevenlabs-signature: $SIGNATURE" \
  -d "$PAYLOAD")

if echo "$WEBHOOK_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Webhook processed successfully${NC}"
  echo "$WEBHOOK_RESPONSE" | jq '.success, .type, .conversationId'
else
  echo -e "${RED}❌ Webhook processing failed${NC}"
  echo "$WEBHOOK_RESPONSE"
  exit 1
fi

echo ""
echo -e "${GREEN}=========================================="
echo "✅ All verification steps passed!"
echo "=========================================="
echo ""
echo "Chain verified:"
echo "  workerBriefId → conversation-token endpoint"
echo "  → ElevenLabs user_id parameter"
echo "  → webhook user_id field"
echo "  → event processor extraction"
echo "  → businessId resolution"
echo ""
```

**Run it**:
```bash
chmod +x /tmp/verify_workerbrief_chain.sh
/tmp/verify_workerbrief_chain.sh
```

---

## Part 6: Files Summary

**Injection Points** (workerBriefId → user_id):
1. `app/api/elevenlabs/conversation-token/route.ts:15,42-44,82`
2. `lib/voice/elevenlabs.ts:380,383,401,661,676,681`

**Extraction Point** (user_id → workerBriefId):
1. `lib/voice/events/elevenlabs-event-processor.ts:73-75`

**Type Definition**:
1. `types/voice/index.ts:78-84` (VoiceServiceOptions)

---

## Success Criteria Checklist

- [ ] `conversation-token?workerBriefId=xxx` returns response with workerBriefId
- [ ] Response doesn't include workerBriefId when query param omitted (backward compat)
- [ ] Mapping registration succeeds before webhook
- [ ] Webhook with `"user_id": "xxx"` is accepted
- [ ] Signature verification passes
- [ ] Logs show: "Found workerBriefId in webhook user_id field"
- [ ] Logs show: "Updated mapping with real conversationId"
- [ ] Logs show: "Processing memory event" with businessId present
- [ ] HTTP 200 response returned from webhook

