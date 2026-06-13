# Phase 2: End-to-End Test Guide

## Objective
Validate that a visitor completes the Zeya experience and produces a fully operational dispatch package connected to the existing workforce architecture, ready for Telnyx execution.

## Prerequisites
- User authenticated (signed up / logged in)
- Supabase migrations applied (20260613_create_dispatches.sql, 20260613_dispatch_lifecycle.sql)
- Dev server running on localhost:3000

## Test Scenario

### Test 1: Experience → Dispatch Creation

**Steps:**
1. Go to http://localhost:3000/experience
2. Click "See how" (Start button)
3. Wait for voice connection
4. Respond to Zeya's opening: "Hi, I'm Zeya..." by saying your name (e.g., "Alice")
5. Respond to "What does your business sell?" (e.g., "Lead generation platform")
6. Respond to "Who usually buys it?" (e.g., "Software agencies")
7. Wait for Zeya to ask "Would you like to try it?"
8. Say "Yes"
9. Voice conversation should end
10. Phone input screen should appear
11. Enter phone number with country code (e.g., "+1 555 1234567")
12. Click "Confirm"

**Expected Outcomes:**
- ✅ Phone collection screen appears
- ✅ Dispatch record created in `dispatches` table
- ✅ Status is "draft"
- ✅ dispatch_event ("created") recorded
- ✅ User sees "DISPATCH MONITOR" section showing dispatch details
- ✅ Dispatch ID displayed
- ✅ Visitor name, phone, status all visible

**Verify in Database:**
```sql
select dispatch_id, status, visitor_name, phone_number, created_at 
from dispatches 
where user_id = current_user_id
order by created_at desc limit 1;
```

Expected: One row with status "draft"

### Test 2: Worker Brief Generation

**Steps:**
1. After dispatch created, check database for worker brief

**Expected Outcomes:**
- ✅ worker_briefs record created
- ✅ worker_brief_id matches in dispatches.worker_brief_id
- ✅ Brief contains key_questions array
- ✅ Brief contains objection_guidance array
- ✅ Brief contains escalation_rules array

**Verify in Database:**
```sql
select wb.id, wb.objective, wb.key_questions, wb.objection_guidance
from worker_briefs wb
inner join dispatches d on d.worker_brief_id = wb.id
where d.dispatch_id = 'dispatch_xxx'
limit 1;
```

Expected: Brief record with populated arrays

### Test 3: Dispatch Linkage

**Steps:**
1. Check dispatch record

**Expected Outcomes:**
- ✅ dispatches.worker_brief_id is populated
- ✅ Foreign key relationship valid
- ✅ Dispatch context can be retrieved

**Verify in Database:**
```sql
select d.dispatch_id, d.status, d.worker_brief_id, 
       wb.objective, wb.target_name
from dispatches d
left join worker_briefs wb on d.worker_brief_id = wb.id
where d.dispatch_id = 'dispatch_xxx';
```

Expected: All fields populated

### Test 4: Execution Package Generation

**Steps:**
1. Check browser console for logged execution package

**Expected Outcomes:**
- ✅ Console logs "[Experience] Execution package ready"
- ✅ Package contains dispatch_id, visitor_name, phone_number
- ✅ Package contains execution_status: "ready"
- ✅ Package contains ready_for_execution: true
- ✅ Package metadata contains worker_brief_id

**Sample Log Output:**
```javascript
[Experience] Execution package ready {
  dispatch_id: "dispatch_1718368000_abc123",
  visitor_name: "Alice",
  phone_number: "+1 555 1234567",
  business_offer: "Lead generation platform",
  target_buyer: "Software agencies",
  execution_status: "ready",
  ready_for_execution: true,
  metadata: {
    created_at: "2026-06-13T...",
    source: "experience_conversation",
    worker_brief_id: "brief_1718368000_xyz789"
  }
}
```

### Test 5: Dispatch Audit Trail

**Steps:**
1. Query dispatch_events for the created dispatch

**Expected Outcomes:**
- ✅ dispatch_event created for initial dispatch creation
- ✅ event_type is "created"
- ✅ created_at timestamp valid

**Verify in Database:**
```sql
select event_type, message, metadata, created_at
from dispatch_events
where dispatch_id = 'dispatch_xxx'
order by created_at asc;
```

Expected: One or more rows with event_type: "created"

### Test 6: Dispatch Monitor Page

**Steps:**
1. Navigate to http://localhost:3000/monitor
2. Wait for page to load
3. Check if dispatch appears in list

**Expected Outcomes:**
- ✅ Monitor page loads without auth errors
- ✅ Dispatch appears in table
- ✅ Shows dispatch_id (truncated)
- ✅ Shows visitor_name ("Alice")
- ✅ Shows phone_number
- ✅ Shows status ("DRAFT")
- ✅ Shows created and updated timestamps
- ✅ Status color is correct (taupe for draft)

**Filter Test:**
1. Click "DRAFT" filter
2. Verify only draft dispatches shown
3. Click "ALL" to reset

**Expected Outcomes:**
- ✅ Filter works correctly
- ✅ Draft dispatches visible/hidden
- ✅ "ALL" shows all dispatches

### Test 7: Dispatch Lifecycle (Manual Testing)

**Prerequisites:**
- Have a dispatch in "draft" status

**Steps:**
1. In database, manually call lifecycle function:
```sql
select * from update_dispatch_with_event(
  'dispatch_xxx',
  'queued',
  'queued',
  'user_uuid',
  'Dispatch queued for execution',
  null
);
```

**Expected Outcomes:**
- ✅ Dispatch status updated to "queued"
- ✅ dispatch_event created with event_type "queued"
- ✅ updated_at timestamp updated
- ✅ Monitor page reflects new status in real-time (after ~5 sec)

**Verify:**
```sql
select status from dispatches where dispatch_id = 'dispatch_xxx';
-- Expected: 'queued'

select event_type from dispatch_events 
where dispatch_id = 'dispatch_xxx' 
order by created_at desc limit 1;
-- Expected: 'queued'
```

### Test 8: Full Status Transition Flow

**Steps:**
1. Create test dispatch (from Test 1-3)
2. Transition through all states:

```sql
-- Start: draft → queued
select * from update_dispatch_with_event(
  'dispatch_xxx', 'queued', 'queued', 'user_uuid', 'Testing', null
);

-- Next: queued → calling
select * from update_dispatch_with_event(
  'dispatch_xxx', 'calling', 'calling', 'user_uuid', 'Call initiated', 
  '{"call_control_id": "call_test_123"}'::jsonb
);

-- Next: calling → answered
select * from update_dispatch_with_event(
  'dispatch_xxx', 'answered', 'answered', 'user_uuid', 'Call answered', null
);

-- Final: answered → completed
select * from update_dispatch_with_event(
  'dispatch_xxx', 'completed', 'completed', 'user_uuid', 'Call completed',
  '{"call_duration": 287, "sentiment": "positive"}'::jsonb
);
```

**Expected Outcomes:**
- ✅ Each transition succeeds
- ✅ Status reflects current state
- ✅ Each transition creates a dispatch_event
- ✅ Audit trail shows all transitions in order
- ✅ Monitor page shows latest status ("COMPLETED")
- ✅ Monitor page shows updated_at timestamp

### Test 9: Telnyx Configuration Validation

**Steps:**
1. Check that Telnyx adapter validates configuration properly

```javascript
// In browser console or server log
import { validateTelnyxConfiguration } from '@/lib/dispatch/adapters/telnyx';
const config = validateTelnyxConfiguration();
console.log(config);
```

**Expected Outcomes:**
- ✅ If env vars not set: valid: false, lists missing vars
- ✅ If env vars set: valid: true, missing: []
- ✅ Logs warning if not configured

**Sample Output (without env vars):**
```
{
  valid: false,
  missing: ["TELNYX_API_KEY", "TELNYX_CONNECTION_ID", "TELNYX_FROM_NUMBER"]
}
```

### Test 10: Mock Outbound Call (Without Real Telnyx)

**Steps:**
1. Create dispatch (Test 1)
2. In server code, call:

```typescript
import { createOutboundCall } from '@/lib/dispatch/adapters/telnyx';
const result = await createOutboundCall(executionPackage);
console.log(result);
```

**Expected Outcomes:**
- ✅ Returns mock response even without Telnyx configured
- ✅ Mock response has proper structure:
  - call_control_id (string)
  - call_session_id (string)
  - call_leg_id (string)
  - status: "initiated"
  - to: phone_number
  - from: TELNYX_FROM_NUMBER or "+1000000000"

**Sample Mock Response:**
```json
{
  "call_control_id": "call_1718368000_abc123",
  "call_session_id": "session_1718368000",
  "call_leg_id": "leg_1718368000",
  "status": "initiated",
  "to": "+1 555 1234567",
  "from": "+1000000000"
}
```

## Checklist

Use this as your verification checklist:

### Phase 2A: Dispatch Integration
- [ ] Dispatch record created with status "draft"
- [ ] dispatch_event ("created") recorded
- [ ] Dispatch visible in database with all fields

### Phase 2B: Worker Brief Generation
- [ ] Worker brief record created
- [ ] Brief contains key_questions array
- [ ] Brief contains objection_guidance array
- [ ] Dispatch linked to brief via worker_brief_id

### Phase 2C: Execution Package
- [ ] Execution package logged with correct structure
- [ ] execution_status: "ready"
- [ ] ready_for_execution: true
- [ ] All required fields present

### Phase 2D: Telnyx Adapter
- [ ] Configuration validation works
- [ ] Mock call creation returns proper response
- [ ] Webhook endpoint reachable (POST /api/webhooks/telnyx)

### Phase 2E: Dispatch Lifecycle
- [ ] Status transitions work (draft → queued → calling → completed)
- [ ] Each transition creates dispatch_event
- [ ] Event audit trail shows all transitions
- [ ] Atomic updates work (status + event together)

### Phase 2F: Call Outcome Integration
- [ ] Dispatch.call_outcome_id field exists
- [ ] Can link call_outcomes to dispatch

### Phase 2G: Memory Foundation
- [ ] memory_events.worker_brief_id linkage exists
- [ ] memory_events.conversation_id linkage exists

### Phase 2H: Dispatch Monitor
- [ ] Monitor page loads (/monitor)
- [ ] Dispatches display with correct data
- [ ] Status filtering works
- [ ] Real-time updates (polling every 5 sec)
- [ ] Status color coding correct

### Phase 2I: End-to-End
- [ ] Complete flow works: Experience → Dispatch → Brief → Package
- [ ] All pieces connected and linked
- [ ] Monitor shows complete pipeline state
- [ ] Audit trail shows full lifecycle

## Troubleshooting

**"Dispatch not appearing in monitor"**
- Check user_id matches (auth.uid() in RLS policy)
- Check Supabase RLS policies enabled
- Refresh page to force reload

**"Worker brief not created"**
- Check Supabase connection string
- Verify worker_briefs table exists
- Check browser console for errors

**"Execution package not logged"**
- Check browser developer console (F12)
- Verify experience/page.tsx has console.log
- Check phone submission completes without errors

**"Dispatch lifecycle transitions failing"**
- Verify RPC function exists in Supabase
- Check dispatch_id is correctly formatted
- Verify user_id is valid

**"Monitor page not loading"**
- Check user is authenticated
- Check /monitor route exists
- Verify DispatchMonitor component mounts
- Check browser console for errors

## Performance Notes

- Monitor page polls every 5 seconds
- For testing, can manually refresh browser
- In production, increase polling interval or use real-time subscriptions
- Current setup suitable for operators monitoring < 100 active dispatches

## Next Steps

After Phase 2 testing:
1. Implement operator controls (queue, cancel, override)
2. Integrate real Telnyx API calls
3. Implement webhook handlers with real status updates
4. Add call outcome attachment UI
5. Build learning loop analyzer
