-- Direct Hire Formation Initiation Source
-- Adds 'direct_hire_onboarding' to formation_initiation_source enum
-- Committed first to ensure safe use in subsequent migrations

ALTER TYPE public.formation_initiation_source
ADD VALUE IF NOT EXISTS 'direct_hire_onboarding';
