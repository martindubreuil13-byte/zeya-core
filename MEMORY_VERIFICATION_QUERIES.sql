-- MEMORY PERSISTENCE VERIFICATION QUERIES
-- Run these in Supabase SQL editor to verify the complete pipeline

-- ============================================================================
-- FORENSIC QUERIES FOR: conv_8301ktkha9pve7d81e4r9aspabg4
-- ============================================================================

-- QUERY 1: Check if Call Outcome was persisted
-- Expected: 1 row with conversation_id matching
SELECT
  'call_outcomes' as source,
  id,
  worker_brief_id,
  conversation_id,
  outcome_type,
  summary,
  call_duration_seconds,
  created_at
FROM call_outcomes
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;

-- ============================================================================
-- QUERY 2: Check if Memory Event was persisted
-- Expected: 1 row with conversation_id in outcome_data
SELECT
  'memory_events' as source,
  id,
  worker_brief_id,
  business_id,
  mission_id,
  event_type,
  summary,
  outcome_data,
  created_at
FROM memory_events
WHERE outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;

-- ============================================================================
-- QUERY 3: Check brief_conversation_mappings for this conversation
-- Expected: 1 row linking worker_brief_id to conversation_id
SELECT
  worker_brief_id,
  conversation_id,
  mission_id,
  business_id,
  provider_call_id,
  created_at
FROM brief_conversation_mappings
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;

-- ============================================================================
-- QUERY 4: Full chain - find by conversation_id
-- Shows all three tables linked together
SELECT
  'call_outcomes' as table_name,
  co.id,
  co.worker_brief_id,
  co.conversation_id,
  co.summary,
  co.created_at,
  NULL as memory_event_id,
  NULL as event_type
FROM call_outcomes co
WHERE co.conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'

UNION ALL

SELECT
  'memory_events' as table_name,
  me.id,
  me.worker_brief_id,
  me.outcome_data->>'conversationId' as conversation_id,
  me.summary,
  me.created_at,
  me.id,
  me.event_type
FROM memory_events me
WHERE me.outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'

UNION ALL

SELECT
  'brief_conversation_mappings',
  bcm.worker_brief_id,
  bcm.worker_brief_id,
  bcm.conversation_id,
  NULL,
  bcm.created_at,
  NULL,
  NULL
FROM brief_conversation_mappings bcm
WHERE bcm.conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'

ORDER BY created_at DESC;

-- ============================================================================
-- QUERY 5: Check if conversation summary contains Martin's feedback
-- Look in call_outcomes for mentions of voice, persona, latency
SELECT
  id,
  conversation_id,
  summary,
  -- Extract key phrases that would indicate feedback was captured
  CASE
    WHEN LOWER(summary) LIKE '%voice%' THEN 'voice_mentioned'
    ELSE 'voice_not_mentioned'
  END as has_voice_feedback,
  CASE
    WHEN LOWER(summary) LIKE '%latency%' THEN 'latency_mentioned'
    ELSE 'latency_not_mentioned'
  END as has_latency_feedback,
  CASE
    WHEN LOWER(summary) LIKE '%persona%' THEN 'persona_mentioned'
    ELSE 'persona_not_mentioned'
  END as has_persona_feedback
FROM call_outcomes
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;

-- ============================================================================
-- QUERY 6: Check transcript content (if stored)
-- May contain actual conversation exchange
SELECT
  id,
  conversation_id,
  transcript,
  OCTET_LENGTH(transcript::text) as transcript_size_bytes
FROM call_outcomes
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;

-- ============================================================================
-- QUERY 7: Check memory event outcome_data structure
-- Shows what was actually captured
SELECT
  id,
  event_type,
  outcome_data,
  CASE
    WHEN outcome_data ? 'summary' THEN 'has_summary'
    ELSE 'no_summary'
  END as summary_status,
  CASE
    WHEN outcome_data ? 'transcript' THEN 'has_transcript'
    ELSE 'no_transcript'
  END as transcript_status,
  CASE
    WHEN outcome_data ? 'duration' THEN 'has_duration'
    ELSE 'no_duration'
  END as duration_status
FROM memory_events
WHERE outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'
LIMIT 1;

-- ============================================================================
-- QUERY 8: Timeline - all related records in chronological order
-- Shows when each stage completed
SELECT
  'worker_brief' as record_type,
  wb.id as record_id,
  wb.created_at as timestamp,
  'Created worker brief for call' as event,
  wb.objective as context
FROM worker_briefs wb
WHERE wb.dynamic_variables->>'missionId' LIKE '%martin%'
  OR LOWER(wb.objective) LIKE '%martin%'

UNION ALL

SELECT
  'brief_conversation_mapping',
  bcm.worker_brief_id,
  bcm.created_at,
  'Mapped worker brief to conversation',
  bcm.conversation_id
FROM brief_conversation_mappings bcm
WHERE bcm.conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'

UNION ALL

SELECT
  'call_outcome',
  co.id,
  co.created_at,
  'Call outcome created and persisted',
  'outcome_type: ' || co.outcome_type
FROM call_outcomes co
WHERE co.conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'

UNION ALL

SELECT
  'memory_event',
  me.id,
  me.created_at,
  'Memory event created and persisted',
  'event_type: ' || me.event_type
FROM memory_events me
WHERE me.outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'

ORDER BY timestamp DESC;

-- ============================================================================
-- QUERY 9: Count records by source
-- Summary of how much data was persisted
SELECT
  'Total call outcomes for this conversation' as metric,
  COUNT(*) as count
FROM call_outcomes
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'

UNION ALL

SELECT
  'Total memory events for this conversation',
  COUNT(*)
FROM memory_events
WHERE outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'

UNION ALL

SELECT
  'Total brief_conversation_mappings for this conversation',
  COUNT(*)
FROM brief_conversation_mappings
WHERE conversation_id = 'conv_8301ktkha9pve7d81e4r9aspabg4'

UNION ALL

SELECT
  'Total worker_briefs linked to Martin',
  COUNT(*)
FROM worker_briefs
WHERE LOWER(dynamic_variables::text) LIKE '%martin%'
   OR LOWER(objective) LIKE '%martin%'
   OR LOWER(lead_context) LIKE '%martin%';

-- ============================================================================
-- QUERY 10: Verification - Can we retrieve the conversation?
-- This simulates what Zeya would do when asked about the call
WITH conversation_data AS (
  SELECT
    me.id as memory_event_id,
    me.outcome_data->>'conversationId' as conv_id,
    me.summary,
    me.outcome_data::jsonb as full_outcome_data,
    co.summary as call_summary,
    co.transcript as call_transcript,
    co.call_duration_seconds,
    wb.objective,
    wb.worker_name,
    wb.dynamic_variables->>'target' as target_name
  FROM memory_events me
  LEFT JOIN call_outcomes co ON me.outcome_data->>'conversationId' = co.conversation_id
  LEFT JOIN brief_conversation_mappings bcm ON bcm.conversation_id = co.conversation_id
  LEFT JOIN worker_briefs wb ON wb.id = bcm.worker_brief_id
  WHERE me.outcome_data->>'conversationId' = 'conv_8301ktkha9pve7d81e4r9aspabg4'
)
SELECT
  conv_id,
  memory_event_id,
  target_name,
  worker_name,
  objective,
  call_duration_seconds,
  summary,
  call_summary,
  full_outcome_data,
  CASE
    WHEN call_transcript IS NOT NULL THEN 'TRANSCRIPT_AVAILABLE'
    ELSE 'NO_TRANSCRIPT'
  END as transcript_status
FROM conversation_data;

-- ============================================================================
-- INTERPRETATION GUIDE
-- ============================================================================
-- If Query 1 returns a row:
--   ✅ Call outcome was persisted
--   ✅ Summary field contains what we can tell about the call
--
-- If Query 2 returns a row:
--   ✅ Memory event was created
--   ✅ outcome_data contains the call details
--
-- If Query 3 returns a row:
--   ✅ Mapping exists linking brief to conversation
--
-- If Query 5 shows voice_mentioned, latency_mentioned, persona_mentioned = yes:
--   ✅ Martin's feedback was captured in summary
--
-- If Query 10 returns full record:
--   ✅ Complete chain is intact and retrievable
--   ✅ System can answer "What happened during the call?"
--
-- If any query returns 0 rows:
--   ❌ That stage did not complete successfully
--   ❌ Need to check server logs for error
