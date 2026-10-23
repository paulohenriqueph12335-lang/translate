-- Preferências pessoais persistem na conta e são compartilhadas entre as sessões do usuário.
ALTER TABLE users
  ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN notification_frequency text NOT NULL DEFAULT 'immediate'
    CHECK (notification_frequency IN ('immediate', '5m', '15m', '1h')),
  ADD COLUMN theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'system'));

ALTER TABLE sessions DROP CONSTRAINT sessions_revoked_reason_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_revoked_reason_check
  CHECK (revoked_reason IN ('logout', 'user', 'director', 'suspended', 'password_changed'));
