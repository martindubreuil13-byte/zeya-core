#!/bin/bash

# Test webhook signature verification locally
# Usage: ./scripts/test-webhook-signature.sh [BASE_URL] [SECRET]
# Example: ./scripts/test-webhook-signature.sh http://localhost:3000 your-secret-key

set -e

BASE_URL="${1:-http://localhost:3000}"
SECRET="${2:-$ELEVENLABS_WEBHOOK_SECRET}"

if [ -z "$SECRET" ]; then
  echo "❌ Error: ELEVENLABS_WEBHOOK_SECRET not provided"
  echo "Usage: $0 [BASE_URL] [SECRET]"
  echo "Example: $0 http://localhost:3000 your-secret-key"
  exit 1
fi

echo "🔵 Testing webhook signature verification"
echo "Base URL: $BASE_URL"
echo "Secret length: ${#SECRET}"
echo ""

# Test data
CONVERSATION_ID="test_conv_12345"
WORKER_BRIEF_ID="test_brief_67890"
MISSION_ID="test_mission_abcde"
BUSINESS_ID="550e8400-e29b-41d4-a716-446655440000"

echo "========================================"
echo "Step 1: Register test mapping (REQUIRED)"
echo "========================================"
echo ""
echo "Registering mapping with:"
echo "  conversationId: $CONVERSATION_ID"
echo "  workerBriefId: $WORKER_BRIEF_ID"
echo "  missionId: $MISSION_ID"
echo "  businessId: $BUSINESS_ID"
echo ""

MAPPING_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/webhooks/elevenlabs/test-mapping" \
  -H "Content-Type: application/json" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"workerBriefId\": \"$WORKER_BRIEF_ID\",
    \"missionId\": \"$MISSION_ID\",
    \"businessId\": \"$BUSINESS_ID\"
  }")

MAPPING_CODE=$(echo "$MAPPING_RESPONSE" | tail -n 1)
MAPPING_BODY=$(echo "$MAPPING_RESPONSE" | sed '$ d')

if [ "$MAPPING_CODE" = "200" ]; then
  echo "✅ Mapping registered successfully"
  echo "Response: $MAPPING_BODY"
else
  echo "❌ Failed to register mapping (HTTP $MAPPING_CODE)"
  echo "Response: $MAPPING_BODY"
  echo ""
  echo "Cannot continue without mapping. businessId will be null."
  exit 1
fi

echo ""

# Create test payload (must match CONVERSATION_ID from mapping)
TEST_PAYLOAD=$(cat <<EOF
{
  "type": "post_call_transcription",
  "event_timestamp": 1717651200,
  "data": {
    "conversation_id": "$CONVERSATION_ID",
    "agent_id": "test_agent_abc",
    "status": "done",
    "summary": "Test conversation for signature verification",
    "call_duration": 45,
    "transcript": [
      {
        "role": "user",
        "message": "Hello, is this a test webhook?"
      },
      {
        "role": "agent",
        "message": "Yes, this is a test. Thank you for calling."
      }
    ],
    "extracted_data": {
      "interested": true
    }
  }
}
EOF
)

# Compute HMAC-SHA256 signature
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  SIGNATURE=$(echo -n "$TEST_PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
else
  # Linux
  SIGNATURE=$(echo -n "$TEST_PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')
fi

echo "✅ Payload created (conversationId: $CONVERSATION_ID)"
echo "✅ Signature computed: ${SIGNATURE:0:32}..."
echo ""

# Test 1: Valid signature with registered mapping
echo "========================================"
echo "Test 1: Valid signature with registered mapping (should return 200)"
echo "========================================"
echo ""
echo "Now webhook processing will:"
echo "  1. Retrieve businessId from mapping"
echo "  2. Create CallOutcome"
echo "  3. Create MemoryEvent with businessId"
echo "  4. Insert into Supabase (NOT NULL businessId = $BUSINESS_ID)"
echo ""
echo ""
echo "Running: POST $BASE_URL/api/webhooks/elevenlabs"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/webhooks/elevenlabs" \
  -H "Content-Type: application/json" \
  -H "x-elevenlabs-signature: $SIGNATURE" \
  -d "$TEST_PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$ d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ HTTP 200 - Signature verified successfully!"
  echo "Response: $BODY"
else
  echo "❌ HTTP $HTTP_CODE - Signature verification failed"
  echo "Response: $BODY"
  echo ""
  echo "Debugging info:"
  echo "  Signature sent: ${SIGNATURE:0:32}..."
  echo "  Secret length: ${#SECRET}"
  echo "  Payload size: ${#TEST_PAYLOAD} bytes"
fi

echo ""
echo "========================================"
echo "Test 2: Missing signature header (should return 401)"
echo "========================================"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/webhooks/elevenlabs" \
  -H "Content-Type: application/json" \
  -d "$TEST_PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "401" ]; then
  echo "✅ HTTP 401 - Correctly rejected request without signature"
else
  echo "❌ HTTP $HTTP_CODE - Should be 401"
fi

echo ""
echo "========================================"
echo "Test 3: Invalid signature (should return 401)"
echo "========================================"
echo ""

INVALID_SIGNATURE="0000000000000000000000000000000000000000000000000000000000000000"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/webhooks/elevenlabs" \
  -H "Content-Type: application/json" \
  -H "x-elevenlabs-signature: $INVALID_SIGNATURE" \
  -d "$TEST_PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "401" ]; then
  echo "✅ HTTP 401 - Correctly rejected request with bad signature"
else
  echo "❌ HTTP $HTTP_CODE - Should be 401"
fi

echo ""
echo "========================================"
echo "Summary"
echo "========================================"
echo ""
echo "If all tests show ✅, signature verification is working correctly!"
echo ""
echo "To test against production:"
echo "  $0 https://yourdomain.vercel.app \$ELEVENLABS_WEBHOOK_SECRET"
