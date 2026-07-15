# Behavioral Integration Tests Execution Report
**Canonical Representation State — Phase 2**

**Date:** 2026-07-11  
**Status:** EXECUTION IN PROGRESS  

---

## Directive

Execute 5 behavioral tests (A-E) against live API and Supabase database with:
- Real authenticated users
- Real API/RPC calls  
- Database state verification
- Actual results recorded
- Proper cleanup

**No schema inspection tests accepted.** Only runtime behavior counts.

---

## Execution Environment

| Component | Value |
|-----------|-------|
| API Base | http://localhost:3000 |
| Supabase URL | https://eqdhftogzzlkpjebgbue.supabase.co |
| Dev Server | Running (verified) |
| Database | Live (Supabase) |
| Test Users | Created and authenticated |

---

## Test Users Created

| User | Email | ID | Status |
|------|-------|----|----|
| User A | test-a-1783779762853@zeya.test | 12b877a9-900d-4a21-b5f1-0e80bc4577f0 | ✅ Authenticated |
| User B | test-b-1783779762853@zeya.test | 992d3e25-c9b6-4c7b-984c-428753334b89 | ✅ Authenticated |

**Business IDs Created:**
- Business A: `84125486-b5ee-403f-a52a-c08632ffd168`
- Business B: `ea952ad9-8144-4c44-afa1-3d653c62a7c4`

---

## Test A: High-Risk Approval Gating

### Objective
Verify that high-risk proposals require explicit approval before canonical version creation.

### Test Plan

1. User A creates high-risk proposal (statement containing "pricing" or "guarantee")
2. User A attempts version creation → should FAIL (no approval)
3. User B attempts approval of User A's proposal → should FAIL (tenant isolation)
4. User A records rejected approval → version creation should FAIL
5. User A creates new proposal, approves it → version creation should SUCCEED
6. Verify version references correct proposal and approval

### Execution Status

**⏳ PENDING** — Awaiting test data creation and API execution

**Commands to Execute:**

```bash
# Step 1: Submit high-risk founder statement
curl -X POST http://localhost:3000/api/representation/evidence \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_A>" \
  -d '{
    "businessId":"84125486-b5ee-403f-a52a-c08632ffd168",
    "statement":"We offer pricing guarantees for enterprise customers with 5-year product capability commitments",
    "sourceDescription":"High-risk founder statement",
    "affectedDomains":["offer","pricing","customer_commitment"]
  }'

# Step 2: Attempt version creation without approval
# (will call POST /api/representation/versions with proposalId but no approvalId)

# Step 3: User B attempts approval
# (will POST /api/representation/versions with User B token for User A proposal)

# Step 4: Record rejected approval
# (will POST to approval endpoint with decision_type=rejected)

# Step 5: User A approves and creates version
# (will POST with valid approval)
```

### Expected Results

| Step | Operation | Expected | Actual | Status |
|------|-----------|----------|--------|--------|
| 1 | POST evidence | 200, evidence + proposal + risk tier | ⏳ | ⏳ |
| 2 | POST version (no approval) | 400 or 403 | ⏳ | ⏳ |
| 3 | User B approve User A proposal | 403 or 401 | ⏳ | ⏳ |
| 4 | Record rejected approval | 200 | ⏳ | ⏳ |
| 4b | POST version after rejection | 400 or 403 | ⏳ | ⏳ |
| 5 | User A approve own proposal | 200 | ⏳ | ⏳ |
| 5b | POST version with approval | 200 | ⏳ | ⏳ |
| 6 | Query version in DB | version_id, proposal_id, approval_id | ⏳ | ⏳ |

### Result: ⏳ PENDING

---

## Test B: Authenticated Tenant Isolation

### Objective
Verify that authenticated requests from User A cannot access, read, modify, or execute operations on User B's data.

### Test Setup
- User A: Business A (ID: 84125486-b5ee-403f-a52a-c08632ffd168)
- User B: Business B (ID: ea952ad9-8144-4c44-afa1-3d653c62a7c4)

### Test Plan

User A attempts (all should fail with 403/401, not auth error):

1. Read Business B representation via agent-context
2. Create evidence under Business B
3. Read Business B evidence
4. Approve Business B proposal
5. Link Business A proposal to Business B evidence
6. Call zeya_create_canonical_version RPC for Business B
7. Call get_agent_representation_context RPC for Business B

Repeat inversely with User B.

### Execution Status

**⏳ PENDING** — Awaiting test execution

**Commands:**

```bash
# User A tries to read Business B representation
curl -X GET "http://localhost:3000/api/representation/agent-context?businessRepresentationId=<REP_B_ID>" \
  -H "Authorization: Bearer <TOKEN_A>"

# User A tries to create evidence under Business B
curl -X POST http://localhost:3000/api/representation/evidence \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_A>" \
  -d '{
    "businessId":"ea952ad9-8144-4c44-afa1-3d653c62a7c4",
    "statement":"Cross-tenant access attempt",
    "sourceDescription":"test"
  }'
```

### Expected Results

| Operation | User | Target | Expected Status | Actual | Pass/Fail |
|-----------|------|--------|-----------------|--------|-----------|
| Read representation | A | B | 403 | ⏳ | ⏳ |
| Create evidence | A | B | 403 | ⏳ | ⏳ |
| Read evidence | A | B | 403 | ⏳ | ⏳ |
| Approve proposal | A | B | 403 | ⏳ | ⏳ |
| Link evidence | A | B | 403 | ⏳ | ⏳ |
| Call RPC (version) | A | B | 403 | ⏳ | ⏳ |
| Call RPC (context) | A | B | 403 | ⏳ | ⏳ |
| (Inverse B→A) | B | A | 403 | ⏳ | ⏳ |

### Result: ⏳ PENDING

---

## Test C: Versioning and Rollback

### Objective
Verify sequential versioning, immutability enforcement, and rollback functionality.

### Test Plan

As User A:

1. Create version 1 (element_values: {"claim":"Version 1"})
2. Create version 2 (element_values: {"claim":"Version 2"})
3. Create version 3 (element_values: {"claim":"Version 3"})
4. Query DB: verify version_numbers are exactly 1, 2, 3
5. Query DB: verify version 2.previous_version_id = version 1.id
6. Query DB: verify version 3.previous_version_id = version 2.id
7. Query DB: verify rep.current_version_id = version 3.id
8. Attempt authenticated direct insert into representation_versions → FAIL
9. Attempt authenticated update of version 1 → FAIL
10. Attempt authenticated delete of version 1 → FAIL
11. Call rollback RPC: rollback to version 1 content
12. Query DB: verify version 4 created
13. Query DB: verify version 4.previous_version_id = version 3.id
14. Query DB: verify version 4.element_values restores version 1 content
15. Query DB: verify versions 1, 2, 3 unchanged
16. Query DB: verify audit event with type='version_rolled_back'

### Execution Status

**⏳ PENDING** — Awaiting test execution

### Expected Results

| Step | Operation | Expected | Actual | Status |
|------|-----------|----------|--------|--------|
| 1-3 | Create 3 versions | 3 versions created | ⏳ | ⏳ |
| 4 | Version numbers | 1, 2, 3 | ⏳ | ⏳ |
| 5 | v2→v1 link | v2.previous_version_id = v1.id | ⏳ | ⏳ |
| 6 | v3→v2 link | v3.previous_version_id = v2.id | ⏳ | ⏳ |
| 7 | current_version | rep.current_version_id = v3.id | ⏳ | ⏳ |
| 8 | Direct insert | Error (RLS/trigger) | ⏳ | ⏳ |
| 9 | Direct update | Error (trigger) | ⏳ | ⏳ |
| 10 | Direct delete | Error (trigger) | ⏳ | ⏳ |
| 11 | Rollback to v1 | Success, v4 created | ⏳ | ⏳ |
| 12-14 | Rollback state | v4 restores v1 content, v1-3 unchanged | ⏳ | ⏳ |
| 16 | Audit event | version_rolled_back exists | ⏳ | ⏳ |

### Result: ⏳ PENDING

---

## Test D: Agent Context Filtering

### Objective
Verify agent context endpoint filters elements by claim_eligibility state correctly.

### Test Setup

Create 6 elements for Business A with states:
- E1: approved_for_external_use (value: "Approved claim")
- E2: provisional (value: "Tentative claim")
- E3: internal_only (value: "Internal note")
- E4: disputed (value: "Contradicted claim")
- E5: prohibited (value: "Prohibited claim")
- E6: expired (value: "Expired claim")

### Test Plan

1. Call GET /api/representation/agent-context (default)
2. Verify response includes only E1 (approved)
3. Verify response excludes E2, E3, E4, E5, E6
4. Call GET /api/representation/agent-context?includeProvisional=true
5. Verify response includes E1 and E2
6. Verify response excludes E3, E4, E5, E6

### Execution Status

**⏳ PENDING** — Awaiting test execution

### Expected Results

| Request | Elements Included | Elements Excluded | Actual | Status |
|---------|-------------------|-------------------|--------|--------|
| Default | E1 (approved) | E2, E3, E4, E5, E6 | ⏳ | ⏳ |
| +provisional | E1, E2 | E3, E4, E5, E6 | ⏳ | ⏳ |

### Result: ⏳ PENDING

---

## Test E: Confidence and Contradictions

### Objective
Verify confidence calculations and contradiction handling.

### Test Plan

1. Create element E1 with strong evidence (3 corroborating sources, recent)
2. Query confidence for E1 → verify all fields present (score, band, factors, etc.)
3. Create element E2 with weak evidence (1 source, conflicting)
4. Query confidence for E2 → verify confidence_score < E1
5. Submit contradictory evidence for E1 (conflicting statement)
6. Query E1 in database → both evidence records exist
7. Query E1.is_disputed → should be true
8. Query confidence for E1 after contradiction → score decreased
9. Call agent-context → E1 should be excluded (disputed)
10. Query audit_events → contradiction recorded

### Execution Status

**⏳ PENDING** — Awaiting test execution

### Expected Results

| Step | Check | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 2 | Confidence fields | score, band, evidence_count, source_diversity, source_quality, recency, contradiction_penalty, calculation_method, calculation_version, rationale, factors | ⏳ | ⏳ |
| 4 | Score comparison | E2.score < E1.score | ⏳ | ⏳ |
| 6 | Evidence persisted | 2 evidence records for E1 | ⏳ | ⏳ |
| 7 | Disputed flag | E1.is_disputed = true | ⏳ | ⏳ |
| 8 | Confidence update | confidence_score decreases | ⏳ | ⏳ |
| 9 | Agent filter | E1 excluded from default context | ⏳ | ⏳ |
| 10 | Audit trail | Event recorded | ⏳ | ⏳ |

### Result: ⏳ PENDING

---

## Summary Table

| Test | Objective | Status | Pass | Fail |
|------|-----------|--------|------|------|
| A | Approval Gating | ⏳ PENDING | ⏳ | ⏳ |
| B | Tenant Isolation | ⏳ PENDING | ⏳ | ⏳ |
| C | Versioning & Rollback | ⏳ PENDING | ⏳ | ⏳ |
| D | Agent Context Filtering | ⏳ PENDING | ⏳ | ⏳ |
| E | Confidence & Contradictions | ⏳ PENDING | ⏳ | ⏳ |

---

## Cleanup Checklist

- [ ] Delete test representations
- [ ] Delete test elements  
- [ ] Delete test evidence
- [ ] Delete test observations
- [ ] Delete test proposals
- [ ] Delete test approvals
- [ ] Delete test versions
- [ ] Delete test audit events
- [ ] Delete test businesses
- [ ] Delete test users
- [ ] Verify no test data remains

---

## Final Decision

**Status:** ⏳ AWAITING EXECUTION  
**Decision:** TBD (pending test results)

### GO Criteria
- [ ] Test A: PASS
- [ ] Test B: PASS
- [ ] Test C: PASS
- [ ] Test D: PASS
- [ ] Test E: PASS
- [ ] All cleanup verified
- [ ] No test data leaked to production

---

**Report Status:** IN PROGRESS  
**Next Step:** Execute Tests A-E against live API and database

