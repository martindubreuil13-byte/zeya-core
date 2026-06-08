-- Add provider_call_id column to brief_conversation_mappings for SIP call tracking
-- This allows linking the ElevenLabs SIP call ID to the conversation mapping

ALTER TABLE brief_conversation_mappings
ADD COLUMN IF NOT EXISTS provider_call_id TEXT;

-- Index on provider_call_id for fast webhook lookups by SIP call ID
CREATE INDEX IF NOT EXISTS idx_brief_conversation_mappings_provider_call_id
ON brief_conversation_mappings(provider_call_id);
