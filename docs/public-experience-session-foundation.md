# Public Experience session foundation

`ZEYA_EXPERIENCE_BUSINESS_ID` is the only Business accepted by the public Experience. The server resolves its owner from `businesses.user_id`, then requires an active Business Representation with a current canonical Version before creating a session. No owner UUID is hard-coded.

Development, staging, and production must use different dedicated Experience Businesses and locked founder/service-owner accounts. Candidates from public Zeya and Veya conversations appear in the Founder Briefing Room belonging to the configured Business owner. Changing the environment variable changes that operational review destination and must be treated as a deployment change.

Public sessions expire after 30 minutes. Expired and abandoned rows, associated voice lineage, outputs, candidates, dispatch records, and provider artifacts require a scheduled retention policy. The controlled Representation purge removes sessions through their lineage/output cascades; routine retention must use a separate service-controlled deletion function before production launch.

The existing process-memory IP and phone throttles are not a production security boundary. A shared durable rate limiter for session creation, transcript finalization, status polling, and phone dispatch is a public-release blocker.

The browser receives only the opaque session token, expiry, public state, and OpenAI ephemeral credential. It never receives the token hash or internal tenant, Business, Representation, Version, Voice Context, output, candidate, dispatch, or provider identifiers.
