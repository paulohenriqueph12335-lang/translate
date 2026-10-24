-- Preferências dos avisos são independentes do histórico do centro de notificações.
CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  delivery_mode text NOT NULL DEFAULT 'digest' CHECK (delivery_mode IN ('digest', 'individual')),
  category_channels jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(category_channels) = 'object'),
  last_operational_scan_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Um cursor por conta/canal evita avisos repetidos entre abas ou sessões.
CREATE TABLE notification_delivery_state (
  user_id uuid NOT NULL REFERENCES users(id),
  channel text NOT NULL CHECK (channel IN ('inApp', 'browser')),
  cursor_id bigint NOT NULL DEFAULT 0 CHECK (cursor_id >= 0),
  initialized_at timestamptz NOT NULL DEFAULT now(),
  last_delivered_at timestamptz,
  PRIMARY KEY (user_id, channel)
);

-- Lembretes operacionais permanecem únicos enquanto a mesma condição/revisão persistir.
ALTER TABLE notifications ADD COLUMN dedupe_key text CHECK (char_length(dedupe_key) <= 240);
ALTER TABLE notifications ADD COLUMN in_app_claimed_at timestamptz, ADD COLUMN browser_claimed_at timestamptz;
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_pending_in_app_idx ON notifications(user_id,id) WHERE in_app_claimed_at IS NULL AND read_at IS NULL;
CREATE INDEX notifications_pending_browser_idx ON notifications(user_id,id) WHERE browser_claimed_at IS NULL AND read_at IS NULL;
