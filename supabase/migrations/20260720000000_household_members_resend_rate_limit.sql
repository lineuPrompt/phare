-- Tracks the last time an owner resent a pending member's set-password
-- invite, so the resend endpoint can enforce a light per-member rate limit
-- (one resend per minute) without an in-memory store, which would not
-- survive across serverless function instances.
ALTER TABLE household_members
  ADD COLUMN IF NOT EXISTS last_resend_at timestamptz;
