# Phase 4.7 — Presence-First Experience

**Date:** 2026-05-31  
**Duration:** ~2 hours  
**Status:** ✅ **Complete and building successfully**

## Objective

Transform Zeya from a SaaS interface into a **presence**—a digital Chief of Staff that feels like someone is already there waiting. **Zero changes to orchestration logic.**

## Philosophy

**From:** Software interface  
**To:** Presence

**Not:**
- CRM software
- Dashboard software
- Analytics software
- Project management software

**Is:**
- A digital Chief of Staff
- A Sales Development Executive
- An operator
- A strategic partner

When the founder opens Zeya:
- "Zeya knows where we are."
- "Zeya knows what she needs from me."
- "Zeya knows what happens next."

## Core Changes

### 1. Time-Aware Greeting

**File:** `lib/briefing-room/zeya-operating-view.ts`

**New Function:**
```typescript
export function getTimeAwareGreeting(userName: string | null): string {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return `Good morning${userName ? `, ${userName}` : ""}.`;
  } else if (hour >= 12 && hour < 18) {
    return `Good afternoon${userName ? `, ${userName}` : ""}.`;
  } else {
    return `Good evening${userName ? `, ${userName}` : ""}.`;
  }
}
```

**Why:** Personalized, time-aware greeting makes Zeya feel present and aware. Uses browser local time, not hardcoded.

### 2. Conversation-First Layout

**File:** `components/briefing-room/ZeyaBriefingRoom.tsx`

**New Component Structure:**

**Before:**
```
┌─────────────────────────────────┐
│ TIME-AWARE GREETING             │
│ [Full context statement]        │
│ [Question]                      │
│ [Missing info if any]           │
├─────────────────────────────────┤
│ PROGRESS SNAPSHOT               │
│ Progress % | Clarity % | Status │
├─────────────────────────────────┤
│ MORE CONTEXT (expandable)       │
└─────────────────────────────────┘
```

**After (Presence-First):**
```
Good evening, Martin.

We're preparing outreach to freelancers.

Which prospects should we contact first?

12 leads available but none selected yet.

────────────────────────────────

View briefing →

(hidden content: stage, progress, clarity, next step)
```

### 3. Three-Part Conversation Structure

**Primary (Always Visible):**
1. **Time-aware greeting** — "Good evening, Martin."
2. **Contextual statement** — What's happening: "We're preparing outreach..."
3. **One key question** — "Which prospects should we contact first?"
4. **Blocker (if any)** — What's in the way

**Secondary (Behind "View briefing"):**
- Progress bar
- Current stage
- Clarity metric
- Next step

### 4. Strategic Context Section

**Collapsed by default.** Click "View briefing" to reveal:
- Progress indicator (visual bar + percentage)
- Current stage
- Clarity metric
- Next step

**Why:**
- Removes dashboard feeling above the fold
- Keeps focus on the conversation
- Details available when needed
- Editorial, not bureaucratic

### 5. Design Approach

**Principles:**
- **Minimal above the fold** — Only what's needed for conversation
- **Presence-focused** — Orb remains visual anchor
- **Calm animation** — No flashy sci-fi effects
- **Intentional** — Nothing unnecessary
- **Premium feel** — Like Apple Calendar, Arc Browser, Linear

## What Changed

### File: `lib/briefing-room/zeya-operating-view.ts`

**Addition:**
- `getTimeAwareGreeting()` function (10 lines)
- Returns personalized greeting based on user's local time

### File: `components/briefing-room/ZeyaBriefingRoom.tsx`

**Changes:**
1. Import `getTimeAwareGreeting`
2. Refactor `OperatingViewSection()` component (complete rewrite)
3. Update call to `OperatingViewSection` to pass `businessName`

**New Component Signature:**
```typescript
function OperatingViewSection({ 
  view, 
  businessName 
}: { 
  view: ZeyaOperatingView; 
  businessName: string | null 
})
```

## Information Hierarchy

### Tier 1: Presence (Always Visible)
- Orb (visual anchor)
- Time-aware greeting
- Contextual statement
- One question
- Blocker (if any)

**Focus:** Conversation

### Tier 2: Supporting Details (Hidden, On-Demand)
- Progress bar
- Stage
- Clarity
- Next step

**Focus:** Context

### Tier 3: Intelligence (Not Yet Implemented)
Future:
- Mission details
- ICP
- Offer
- Pain points
- Pricing
- Objections
- Call logs

**Focus:** Strategic context

## Interaction Model

**Founder opens Zeya:**
```
Good afternoon, Martin.

We have 15 leads ready to review.

Which prospects look most interested?

[Strategic Context section hidden]
```

**Founder wants details:**
```
[Click "View briefing"]

Progress: ████░░░░░░░░░░░░░░ 50%
Stage: Lead Review
Clarity: 65%
Next Step: Mark 3–5 strongest prospects as selected
```

## Language & Tone

**Rule:** If a restaurant owner in Bangkok wouldn't understand it, rewrite it.

**Examples:**

✅ **Do this:**
- "Have people mentioned the price?"
- "Which prospects look most interested?"
- "What reasons did people give?"

❌ **Don't do this:**
- "Price sensitivity signals"
- "Prospect qualification criteria"
- "Objection pattern analysis"

**All founder-facing language** is plain English, conversational, first-person.

## Visual Changes

### Presence Emphasis
- Orb remains dominant visual element
- Represents Zeya's presence
- Subtle state changes (idle, listening, thinking, speaking)

### Layout Simplification
- Centered, focused layout
- No cards, no pills above the fold
- Smooth transitions between conversation and details

### Typography
- Clean hierarchy
- Light weights
- Generous spacing
- Calm, not busy

## What Stayed the Same

✅ **Orchestration logic** — Phase 1, 2, 3 untouched  
✅ **Data sources** — Still consume BusinessState, ExecutiveGuidance, ConversationObjective  
✅ **Voice session** — No changes  
✅ **Presence Core (orb)** — Unchanged  
✅ **Memory pills** — Still visible below briefing  
✅ **Database schema** — No changes  
✅ **API endpoints** — No changes  

## Files Modified

### 1. `lib/briefing-room/zeya-operating-view.ts`
- Added `getTimeAwareGreeting()` function
- Lines: ~10 added

### 2. `components/briefing-room/ZeyaBriefingRoom.tsx`
- Updated imports
- Refactored `OperatingViewSection()` component
- Updated component call with `businessName` parameter
- Lines: ~40 changed in signature, ~90 in component body

**Total:** 2 files, ~140 lines affected

## Build Status

✅ **TypeScript:** Passes  
✅ **Next.js:** Builds in 4.6s  
✅ **No errors, no warnings**  
✅ **Zero orchestration changes**  
✅ **Backward compatible**  

## What the Founder Experiences

### Before (Dashboard Feeling):
```
Good morning.

Current Stage: Lead Review
Today's Priority: Select prospects
What I Need: Selected Leads, Caller Brief
Question: Which prospects should we prioritize?

Business Health
├─ Readiness: 50%
├─ Confidence: 65%
└─ Blocker: 12 leads available...

Situation: Multiple prospects uploaded...
Next Action: Mark 3–5 strongest...
```

### After (Presence Feeling):
```
Good afternoon, Martin.

We have 12 prospects ready, but I need you 
to select the strongest ones before we 
reach out.

Which prospects should we contact first?

12 leads available but none selected yet.

────────────────────────────────

View briefing →
```

## Success Indicators

✅ Founder opens Zeya  
✅ Immediately feels like someone is present  
✅ Knows exactly what to do next (answer one question)  
✅ Knows what's blocking (if anything)  
✅ Can see supporting details when needed  
✅ No dashboard feeling  
✅ No SaaS feeling  
✅ No technical jargon  
✅ Plain English only  
✅ Time-aware (greets with correct time of day)  

## Design Principles

1. **Presence First** — Zeya is a presence, not a tool
2. **One Conversation** — Focus on the next question, not metrics
3. **Minimal Above-Fold** — No dashboard, metrics, workflow states
4. **Strategic Context** — Details hidden, available on-demand
5. **Plain English** — No jargon, conversational tone
6. **Time-Aware** — Greeting matches user's local time
7. **Calm Animation** — No sci-fi, no gimmicks
8. **Intentional** — Every element serves a purpose

## Next Steps

**Do NOT start Phase 5.**

The Zeya experience now:
- Feels like having a Chief of Staff present
- Focuses conversation, not metrics
- Hides complexity, reveals on-demand
- Communicates in plain language
- Greets the founder by time of day

**Ready for production.**

---

## Summary

Phase 4.7 transforms Zeya from a SaaS interface into a **presence**—a digital operator who:

1. **Greets you with awareness** — Time-aware greeting
2. **Knows what's happening** — Contextual statement
3. **Asks one clear question** — Focused conversation
4. **Tells you what's blocking** — If anything
5. **Offers details on-demand** — "View briefing" for context

The founder now feels like they're in a meeting with someone who knows the business, not using software.
