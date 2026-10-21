-- Escolha de cada pessoa: trabalhar com ou sem o Auxílio da IA (ADR-022). Sem registro, a pessoa trabalha com IA.
CREATE TABLE ai_user_choice (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  use_ai boolean NOT NULL,
  chosen_at timestamptz NOT NULL DEFAULT now()
);

-- Cada protocolo guarda se nasceu com ou sem IA, pela escolha de quem pediu a tradução naquele momento: com IA só
-- quando a IA está ligada, a pessoa não foi limitada pela liderança e escolheu trabalhar com IA. Trocar a escolha
-- depois não muda os protocolos já criados, para a comparação nos painéis ser justa.
ALTER TABLE translation_jobs
  ADD COLUMN ai_mode text NOT NULL DEFAULT 'without_ai' CHECK (ai_mode IN ('with_ai', 'without_ai'));

CREATE FUNCTION translation_jobs_ai_mode() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.ai_mode := CASE
    WHEN coalesce((SELECT enabled FROM ai_settings), false)
     AND coalesce((SELECT allowed FROM ai_user_access WHERE user_id = NEW.requested_by), true)
     AND coalesce((SELECT use_ai FROM ai_user_choice WHERE user_id = NEW.requested_by), true)
    THEN 'with_ai' ELSE 'without_ai' END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER translation_jobs_ai_mode BEFORE INSERT ON translation_jobs
  FOR EACH ROW EXECUTE FUNCTION translation_jobs_ai_mode();

CREATE INDEX translation_jobs_ai_mode_idx ON translation_jobs (ai_mode, created_at);

-- Protocolos anteriores: com IA só os que já tiveram resposta da IA; o resto nasceu antes dela.
UPDATE translation_jobs SET ai_mode = 'with_ai'
 WHERE id IN (SELECT translation_id FROM ai_requests WHERE status = 'ok' AND translation_id IS NOT NULL);
