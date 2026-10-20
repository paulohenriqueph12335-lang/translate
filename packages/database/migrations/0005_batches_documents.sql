-- Fase 2: lotes, documentos com estado individual e versões imutáveis (ADR-006).

CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams (id),
  owner_id uuid NOT NULL REFERENCES users (id),
  name text CHECK (char_length(name) BETWEEN 1 AND 120),
  idempotency_key text CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  declared_bytes bigint NOT NULL CHECK (declared_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX batches_team_created_idx ON batches (team_id, created_at DESC, id DESC);
CREATE INDEX batches_owner_created_idx ON batches (owner_id, created_at DESC, id DESC);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches (id),
  position integer NOT NULL CHECK (position >= 0),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 255),
  -- Extensão e tamanho declarados ficam registrados mesmo quando o item é recusado na criação.
  declared_extension text NOT NULL CHECK (char_length(declared_extension) <= 16),
  declared_size bigint NOT NULL CHECK (declared_size >= 0),
  status text NOT NULL DEFAULT 'awaiting_upload'
    CHECK (status IN ('awaiting_upload', 'uploading', 'stored', 'rejected', 'upload_failed', 'cancelled')),
  detected_format text CHECK (detected_format IN ('docx', 'pdf', 'jpeg', 'png', 'pptx')),
  sha256 bytea CHECK (octet_length(sha256) = 32),
  error_code text,
  upload_started_at timestamptz,
  stored_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, position),
  CONSTRAINT stored_has_metadata CHECK (status <> 'stored' OR (detected_format IS NOT NULL AND sha256 IS NOT NULL AND stored_at IS NOT NULL)),
  CONSTRAINT failure_has_code CHECK (status NOT IN ('rejected', 'upload_failed') OR error_code IS NOT NULL)
);
CREATE INDEX documents_batch_idx ON documents (batch_id, position);
-- Duplicados no mesmo lote só entre itens armazenados.
CREATE UNIQUE INDEX documents_batch_sha_stored_idx ON documents (batch_id, sha256) WHERE status = 'stored';

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents (id),
  kind text NOT NULL CHECK (kind IN ('original')),
  object_key text NOT NULL UNIQUE,
  format text NOT NULL CHECK (format IN ('docx', 'pdf', 'jpeg', 'png', 'pptx')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, kind)
);

-- Versões são imutáveis: o binário no S3 corresponde ao checksum registrado.
CREATE FUNCTION document_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'document_versions é imutável';
END;
$$;
CREATE TRIGGER document_versions_no_update
  BEFORE UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION document_versions_immutable();
