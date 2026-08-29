BEGIN;

-- P2.12C Prepared Opening Acknowledgement Tracking
--
-- Add durable tracking of owner acknowledgement of Prepared Opening
-- so that restoration logic can distinguish:
-- - "owner never saw Prepared Opening" (show it on reload)
-- - "owner acknowledged Prepared Opening" (continue Formation flow)
--
-- This field is set to true when owner clicks "Got it, let's dig deeper"
-- and prevents re-showing Prepared Opening on subsequent reloads.

ALTER TABLE public.representation_formation_sessions
ADD COLUMN preparation_opening_acknowledged boolean DEFAULT false;

-- Add index for efficient queries during restoration
CREATE INDEX idx_formation_sessions_prep_opening_ack
  ON public.representation_formation_sessions(preparation_opening_acknowledged)
  WHERE preparation_opening_acknowledged = false;

NOTIFY pgrst, 'reload schema';
COMMIT;
