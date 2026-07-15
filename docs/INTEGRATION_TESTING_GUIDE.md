# Canonical Representation State — Integration Testing Guide

**Date:** 2026-07-11  
**Purpose:** Complete validation of backend vertical slice before voice integration  
**Status:** Test framework created; manual testing required with real Supabase auth

---

## TEST EXECUTION STATUS

### ✅ PASSED: Build and TypeScript Validation

```
$ npm run build
✓ Compiled successfully
✓ TypeScript type-checking passed
✓ All 3 API routes built
✓ No build errors
```

**Routes present in build:**
- `POST /api/representation/evidence`
- `POST /api/representation/versions`
- `GET /api/representation/versions`
- `GET /api/representation/agent-context`

### ✅ CREATED: Comprehensive Test Suite

Two test frameworks created:

1. **Full Integration Test** (`tests/integration/representation-state.test.ts`)
   - 10 test phases
   - Real Supabase Auth user creation
   - Complete vertical slice flow
   - Tenant isolation validation
   - Unauthorized access testing

2. **API Structure Test** (`tests/integration/api-structure-test.ts`)
   - Route endpoint verification
   - TypeScript type validation
   - Authentication enforcement
   - API input validation
   - Immutability policy verification
   - Tenant isolation verification

---

## MANUAL TESTING PROTOCOL

The integration tests require real Supabase authentication. Execute these tests manually following this protocol:

### Prerequisites

1. **Environment Setup**
   ```bash
   export NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
   export NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-key"
   export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"  # For admin operations
   export API_BASE_URL="http://localhost:3000"
   ```

2. **Development Server**
   ```bash
   npm run dev
   ```

3. **Database Connection**
   - Verify Supabase project is accessible
   - Verify RLS policies are active on all tables
   - Verify database functions are callable

---

## PHASE 1: AUTHENTICATION & USER SETUP

**Objective:** Create two isolated test tenants with authenticated users

**Steps:**

1. Sign up two users through Supabase Auth:
   - User A: `test-a-[timestamp]@zeya.test`
   - User B: `test-b-[timestamp]@zeya.test`
   - Both with password: `TestPassword123!`

2. Create two businesses:
   - Business A (owned by User A)
   - Business B (owned by User B)

3. Record IDs for subsequent tests

**Expected Outcome:**
- ✓ Two isolated user accounts with separate tokens
- ✓ Two businesses with distinct IDs
- ✓ Ability to authenticate as either user

---

## PHASE 2: FOUNDER STATEMENT SUBMISSION

**Objective:** Test evidence ingestion through the complete flow

**Test Statement:**
```
"Zeya helps small businesses acquire customers by representing their business 
accurately and consistently across conversations and channels."
```

**API Call:**
```bash
POST /api/representation/evidence
Headers: Authorization: Bearer [User A Token]
Body:
{
  "businessId": "[Business A ID]",
  "statement": "[Test Statement Above]",
  "sourceDescription": "Founder statement during integration test",
  "affectedDomains": ["business_identity", "offer"]
}
```

**Expected Response (201):**
```json
{
  "success": true,
  "data": {
    "evidenceId": "[UUID]",
    "observationId": "[UUID]",
    "proposalId": "[UUID]",
    "businessRepresentationId": "[UUID]",
    "riskTier": "low",
    "requiresApproval": false
  }
}
```

**Verify in Database:**
- ✓ evidence table contains raw_statement unchanged
- ✓ statement_hash is populated (SHA256)
- ✓ observations table links to evidence
- ✓ representation_proposals created with status='draft'
- ✓ proposal_evidence join table populated
- ✓ proposal_observations join table populated
- ✓ audit_events created for each entity

**No Changes After Creation:**
- ✓ Try to UPDATE evidence → should fail (immutable)
- ✓ Try to DELETE evidence → should fail (immutable)

---

## PHASE 3: RISK ASSESSMENT & APPROVAL

**Test Case 1: Low Risk**

**Statement:** "Our core offering is B2B SaaS"

**Expected:**
- ✓ risk_tier = 'low'
- ✓ requires_approval = false
- ✓ Can create canonical version without approval

**Test Case 2: High Risk (Pricing)**

**Statement:** "We charge $500/month for our premium tier"

**Expected:**
- ✓ risk_tier = 'high'
- ✓ highest_sensitivity_class = 'pricing'
- ✓ requires_approval = true
- ✓ Cannot create canonical version without approval decision

**Approval Process for High Risk:**

```bash
POST /api/representation/versions (should fail without approval)

INSERT INTO approval_decisions
  business_representation_id: [Business A Rep ID]
  representation_proposal_id: [Proposal ID]
  decision: 'approved'
  approver_user_id: [User A ID]

Then POST /api/representation/versions (should succeed)
```

**Verify:**
- ✓ Version creation blocked before approval
- ✓ Version creation succeeds after approval
- ✓ Approval decision is immutable (UPDATE fails)
- ✓ Rejected approval prevents version creation

---

## PHASE 4: CANONICAL VERSION CREATION

**API Call:**
```bash
POST /api/representation/versions
Headers: Authorization: Bearer [User A Token]
Body:
{
  "businessRepresentationId": "[Rep ID]",
  "proposalId": "[Proposal ID]",
  "elementValues": {
    "founder_statement": {
      "value": "[statement]",
      "confidence": 85
    }
  },
  "confidenceScore": 85
}
```

**Expected Response (201):**
```json
{
  "success": true,
  "data": {
    "versionId": "[UUID]",
    "versionNumber": 1,
    "approvalId": "[UUID if high-risk]",
    "confidenceAssessmentId": "[UUID]",
    "overallConfidenceScore": 85
  }
}
```

**Verify Multiple Versions:**

Create 3 versions sequentially:
1. Version 1: Initial statement
2. Version 2: Add channel detail
3. Version 3: Refine positioning

**Expected:**
- ✓ version_number = 1, 2, 3 (sequential)
- ✓ No duplicate version numbers
- ✓ previous_version_id correctly links 2→1, 3→2
- ✓ current_version_id in business_representations = 3
- ✓ content_hash generated (SHA256 of element_values)
- ✓ source_proposal_id references correct proposal
- ✓ source_approval_id references approval (if required)

**Immutability Tests:**
```bash
# Try to UPDATE version (should fail)
UPDATE representation_versions 
SET overall_confidence_score = 50
WHERE id = [Version ID]
→ ERROR: immutable

# Try to DELETE version (should fail)
DELETE FROM representation_versions WHERE id = [Version ID]
→ ERROR: immutable

# Try to directly INSERT version via user client (should fail RLS)
INSERT INTO representation_versions (...)
→ ERROR: RLS violation (only database function can insert)
```

---

## PHASE 5: CONFIDENCE ASSESSMENT

**Verify Confidence Calculation:**

```bash
GET /api/representation/versions?businessRepresentationId=[Rep ID]
```

**Expected confidence_assessments fields:**
- ✓ confidence_score (0-100)
- ✓ confidence_band (very_low, low, moderate, high, very_high)
- ✓ evidence_count (number of pieces of evidence)
- ✓ source_diversity_score (0-100)
- ✓ source_quality_score (0-100)
- ✓ recency_score (0-100)
- ✓ contradiction_penalty (0-100)
- ✓ calculation_method (algorithm name)
- ✓ calculation_version (version of algorithm)
- ✓ calculation_timestamp (when calculated)
- ✓ rationale (human-readable explanation)
- ✓ factors (JSON object with calculation details)

**Verify Explainability:**

For two proposals with different evidence strength:
- ✓ High-confidence case: direct founder statement, single source → ~85%
- ✓ Low-confidence case: inferred from limited data → ~50%
- ✓ Rationale differs meaningfully
- ✓ Factors show calculation breakdown

---

## PHASE 6: AGENT CONTEXT RETRIEVAL

**API Call:**
```bash
GET /api/representation/agent-context?businessRepresentationId=[Rep ID]
Headers: Authorization: Bearer [User A Token]
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "businessRepresentationId": "[UUID]",
    "elementCount": [N],
    "elements": [
      {
        "elementId": "[UUID]",
        "elementKey": "founder_statement",
        "elementType": "fact",
        "currentValue": {...},
        "confidenceScore": 85,
        "claimEligibility": "approved_for_external_use",
        "fieldSensitivity": "operational"
      }
    ],
    "retrievedAt": "[ISO timestamp]"
  }
}
```

**Filtering Validation:**

Create elements with different eligibilities:
1. `claim_eligibility = 'approved_for_external_use'` → **included** in agent context
2. `claim_eligibility = 'provisional'` → **excluded** by default (include if ?includeProvisional=true)
3. `claim_eligibility = 'internal_only'` → **excluded**
4. `claim_eligibility = 'disputed'` → **excluded**
5. `claim_eligibility = 'prohibited'` → **excluded**
6. `claim_eligibility = 'expired'` → **excluded**

**Verify:**
- ✓ Only eligible elements returned
- ✓ Restricted claims excluded
- ✓ Agent receives structured JSON (not raw database rows)
- ✓ Element values are valid JSON objects

---

## PHASE 7: CONTRADICTION HANDLING

**Create Contradictory Statements:**

1. Statement A: "Our target market is independent consultants"
2. Statement B: "Our target market is mid-sized retail chains"

**Expected:**
- ✓ Both pieces of evidence stored (not overwritten)
- ✓ Affected element marked `is_disputed = true`
- ✓ Claim eligibility becomes 'disputed'
- ✓ Affected element excluded from agent context
- ✓ Confidence score reduced
- ✓ Audit trail shows contradiction

**Resolution Path:**

Create new proposal resolving contradiction:
```
"Our target market is small businesses with 1-50 employees, primarily 
consultants and professional services firms."
```

**Verify:**
- ✓ Contradiction status changes when new evidence clarifies
- ✓ Element eligibility restored to 'approved_for_external_use'
- ✓ is_disputed flag reset to false
- ✓ New version created with resolved statement

---

## PHASE 8: TENANT ISOLATION

**Cross-Tenant Access Attempts:**

### User B accessing User A's business representation:

```bash
# User B tries to read User A's representation
GET /api/representation/versions?businessRepresentationId=[User A Rep ID]
Headers: Authorization: Bearer [User B Token]

→ Expected: 401/403 or empty data
→ NOT: User B's data visible
```

**Database-Level Isolation Tests:**

Using User B's authenticated client:

```sql
-- Try to read User A's representation (should fail RLS)
SELECT * FROM business_representations 
WHERE id = '[User A Rep ID]'
→ ERROR or empty result

-- Try to create element for User A's representation (should fail RLS)
INSERT INTO representation_elements (
  business_representation_id = '[User A Rep ID]',
  ...
)
→ ERROR: RLS violation

-- Try to link User A's evidence to User B's proposal (should fail FK)
INSERT INTO proposal_evidence (
  proposal_id = '[User B Proposal ID]',
  evidence_id = '[User A Evidence ID]',
  business_representation_id = '[User B Rep ID]'
)
→ ERROR: Cross-tenant FK violation
```

**Verify All Entities Isolated:**
- ✓ business_representations
- ✓ representation_domains
- ✓ representation_elements
- ✓ evidence
- ✓ observations
- ✓ representation_proposals
- ✓ approval_decisions
- ✓ representation_versions
- ✓ confidence_assessments
- ✓ audit_events

---

## PHASE 9: ROLLBACK CAPABILITY

**Create Three Versions:**

1. Version 1: "Our offering is AI-powered"
2. Version 2: "Our offering is AI-powered B2B SaaS"
3. Version 3: "Our offering is AI-powered B2B SaaS for customer acquisition"

**Rollback from Version 3 to Version 1:**

```bash
# Call rollback function (or API if implemented)
version_4 = zeya_create_canonical_version(
  businessRepresentationId: [Rep ID],
  sourceProposalId: [Rollback Proposal ID],
  elementValues: [Version 1 content],
  rollbackOfVersionId: [Version 1 ID]
)
```

**Verify:**
- ✓ Version 1 unchanged (not modified)
- ✓ Version 2 unchanged
- ✓ Version 3 unchanged
- ✓ Version 4 created
- ✓ Version 4.version_number = 4
- ✓ Version 4.previous_version_id = Version 3.id
- ✓ Version 4.element_values = Version 1.element_values
- ✓ current_version_id updated to Version 4
- ✓ Audit event records rollback with source = Version 1
- ✓ Lineage: Version 1 → Version 2 → Version 3 → Version 4

---

## PHASE 10: AUDIT LINEAGE

**Complete Audit Trail for One Element:**

```bash
1. GET /api/representation/versions?businessRepresentationId=[Rep ID]
   → captures current version and audit trail

2. SELECT * FROM audit_events 
   WHERE business_representation_id = '[Rep ID]'
   ORDER BY created_at

3. For each audit event, verify linkage:
   - evidence_created → links to evidence.id
   - observation_created → links to observations.id
   - proposal_created → links to representation_proposals.id
   - version_created → links to representation_versions.id
   - confidence_calculated → links to confidence_assessments.id
```

**Verify Complete Chain:**
```
Canonical Element (current)
  ↓ references
Representation Version
  ↓ sourced from
Representation Proposal
  ↓ requires (if high-risk)
Approval Decision
  ↓ based on
Observation(s)
  ↓ interprets
Evidence
  ↓ captured by
Actor (User ID)
  ↓ assessed with
Confidence Assessment
  ↓ traced by
Audit Events (immutable)
```

**Verify:**
- ✓ No broken links in lineage
- ✓ Audit events immutable (UPDATE fails)
- ✓ Timestamps are sequential
- ✓ All actors recorded
- ✓ All transitions captured

---

## PHASE 11: ERROR HANDLING

### Unauthenticated Requests

```bash
POST /api/representation/evidence (no Authorization header)
→ Expected: 401 Unauthorized
→ Expected: Safe error message (no stack trace, no SQL details)
```

### Unauthorized Tenant Access

```bash
POST /api/representation/versions
businessRepresentationId = [User A Rep ID]
Authorization: Bearer [User B Token]
→ Expected: 401/403 or database constraint error
→ Expected: No data leakage
```

### Invalid Input

```bash
POST /api/representation/evidence
statement = "" (empty)
→ Expected: 400 Bad Request
→ Expected: Clear validation error

POST /api/representation/versions
confidenceScore = 150 (out of range)
→ Expected: 400 Bad Request
```

### Constraint Violations

```bash
# Try to approve same proposal twice
INSERT INTO approval_decisions (
  representation_proposal_id = '[Proposal ID]',
  ...
)
(second time)
→ Expected: UNIQUE constraint violation

# Try to create version without valid proposal
INSERT into representation_versions (
  source_proposal_id = '[Invalid ID]',
  ...
)
→ Expected: FK constraint violation
```

**Verify:**
- ✓ No stack traces exposed
- ✓ No SQL details exposed
- ✓ No database structure revealed
- ✓ Clear, actionable error messages
- ✓ Appropriate HTTP status codes

---

## TESTING CHECKLIST

### Build & Types
- [ ] `npm run build` passes
- [ ] TypeScript type-check passes
- [ ] All 3 API routes present in build output
- [ ] No compilation errors

### Phase 1: Authentication
- [ ] User A authenticated
- [ ] User B authenticated
- [ ] Business A created
- [ ] Business B created

### Phase 2: Founder Statement
- [ ] Evidence created
- [ ] Observation created
- [ ] Proposal created
- [ ] Risk assessment returned
- [ ] Evidence immutable (UPDATE fails)
- [ ] Evidence immutable (DELETE fails)
- [ ] Audit events created

### Phase 3: Risk & Approval
- [ ] Low-risk flow works
- [ ] High-risk flow blocks version without approval
- [ ] User A can approve own proposal
- [ ] User B cannot approve User A's proposal

### Phase 4: Versioning
- [ ] Version numbers sequential (1, 2, 3)
- [ ] previous_version_id correct
- [ ] current_version_id updated
- [ ] content_hash generated
- [ ] Version immutable (UPDATE fails)
- [ ] Version immutable (DELETE fails)
- [ ] Direct insertion blocked by RLS

### Phase 5: Confidence
- [ ] confidence_score calculated (0-100)
- [ ] confidence_band assigned
- [ ] rationale provided
- [ ] factors detailed
- [ ] algorithm version tracked
- [ ] timestamp recorded

### Phase 6: Agent Context
- [ ] approved_for_external_use included
- [ ] internal_only excluded
- [ ] disputed excluded
- [ ] prohibited excluded
- [ ] expired excluded
- [ ] provisional excluded by default
- [ ] structured JSON returned

### Phase 7: Contradictions
- [ ] Both pieces of evidence stored
- [ ] Element marked disputed
- [ ] Excluded from agent context
- [ ] Confidence reduced
- [ ] Resolution path works

### Phase 8: Tenant Isolation
- [ ] User B cannot read User A data
- [ ] User A cannot read User B data
- [ ] Cross-tenant FK prevents linking
- [ ] All entities isolated
- [ ] RLS enforced

### Phase 9: Rollback
- [ ] Older versions immutable
- [ ] New version created
- [ ] Lineage preserved
- [ ] current_version_id updated
- [ ] Audit trail complete

### Phase 10: Audit Trail
- [ ] Complete lineage traced
- [ ] All links valid
- [ ] No orphaned records
- [ ] Timestamps sequential
- [ ] Immutable

### Phase 11: Error Handling
- [ ] Unauthenticated → 401
- [ ] Unauthorized → 401/403
- [ ] Invalid input → 400
- [ ] Constraints enforced
- [ ] No data leakage
- [ ] Safe error messages

---

## GO/NO-GO CRITERIA

✅ **GO FOR VOICE INTEGRATION WHEN:**
- All 11 testing phases passed
- All API routes working
- Tenant isolation proven
- High-risk approval gating enforced
- Version immutability confirmed
- Audit trail complete
- Error handling safe

❌ **NO-GO IF:**
- Build fails
- TypeScript errors
- Tenant isolation broken
- API authentication bypassed
- Versions can be modified
- Audit trail incomplete
- Data leakage in errors

---

## IMPLEMENTATION NOTES

### How to Run Automated Tests

```bash
# When manual Supabase auth is available:
npm run test:representation

# Structure validation (no auth needed):
npx tsx tests/integration/api-structure-test.ts
```

### Test Data Cleanup

After testing, remove test users and businesses:
```bash
# Via Supabase admin API
DELETE FROM businesses WHERE name LIKE 'Business A - %'
DELETE FROM businesses WHERE name LIKE 'Business B - %'

# User deletion via Supabase Auth dashboard
```

### Known Testing Constraints

- Integration tests require live Supabase connection
- Service role key needed for admin user operations
- Tests should run against staging Supabase, not production
- Database state persists; clean up between test runs

---

## NEXT STEPS

1. **Execute all 11 phases** using the manual testing protocol
2. **Document results** in testing report
3. **Fix any defects** found during testing
4. **Retest** any changed components
5. **Sign off** on GO/NO-GO decision
6. **Proceed to voice integration** only after GO criteria met

