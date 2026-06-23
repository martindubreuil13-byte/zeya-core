# Anonymous Experience dispatch

Anonymous `/experience` call requests are persisted under the business configured by
`ZEYA_EXPERIENCE_BUSINESS_ID`. This must be a real, pre-existing `businesses.id`
reserved for demo traffic. Authenticated requests continue to use the signed-in
user's business and client-created dispatch record.

The route validates E.164 phone numbers, limits request bodies to 8 KiB, allows at
most three anonymous requests per IP every 15 minutes, and applies a 10-minute
cooldown per normalized phone number.

The limiter is intentionally dependency-free and stores counters in process memory.
It is suitable for local development and basic single-instance protection only.
Serverless instances do not share memory and lose counters when recycled. Before
scaling anonymous calling in production, replace the maps with a shared atomic store
such as Redis and add a provider-spend ceiling or CAPTCHA. Server-side provider and
Supabase credentials protect secrets, but they do not prevent paid-call abuse.
The IP key assumes the deployment proxy overwrites `x-forwarded-for`; do not trust
a client-controlled forwarding header at an unproxied origin.
