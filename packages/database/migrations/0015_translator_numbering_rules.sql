-- Regras de numeração por tradutor juramentado (ADR-014): o Supervisor configura a regra e envia os números por
-- planilha (CSV); o usuário preenche a numeração da tradução e o sistema confere; o número é emitido na conclusão.

-- Regra do tradutor: esquema e parâmetros (limite, avisos, valores, folhas por livro, usos por número…).
ALTER TABLE sworn_translators ADD COLUMN numbering_scheme text NOT NULL DEFAULT 'free_text'
  CHECK (numbering_scheme IN ('free_text', 'prefixed', 'book_sheet', 'stock', 'reusable_stock'));
ALTER TABLE sworn_translators ADD COLUMN numbering_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Planilhas enviadas pelo Supervisor.
CREATE TABLE numbering_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translator_id uuid NOT NULL REFERENCES sworn_translators (id),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  rows_read integer NOT NULL CHECK (rows_read >= 0),
  rows_imported integer NOT NULL CHECK (rows_imported >= 0),
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- Estoque de números de cada tradutor (Carla: por idioma, pagos e gratuitos, até 2 usos).
CREATE TABLE numbering_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translator_id uuid NOT NULL REFERENCES sworn_translators (id),
  language text NOT NULL DEFAULT '' CHECK (char_length(language) <= 40),
  number text NOT NULL CHECK (char_length(number) BETWEEN 1 AND 40),
  book text CHECK (char_length(book) <= 40),
  free boolean NOT NULL DEFAULT false,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 10),
  -- Disponível, reservado para uso exclusivo de uma pessoa, ou bloqueado pelo Supervisor.
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'blocked')),
  reserved_for uuid REFERENCES users (id),
  -- O Supervisor pede para ser avisado quando este número for usado.
  notify_on_use boolean NOT NULL DEFAULT false,
  note text CHECK (char_length(note) <= 500),
  import_id uuid REFERENCES numbering_imports (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT numbering_stock_reserved CHECK (status <> 'reserved' OR reserved_for IS NOT NULL),
  UNIQUE (translator_id, language, number)
);
CREATE INDEX numbering_stock_translator_idx ON numbering_stock (translator_id, status, number);

-- Livros com limite de folhas (Patricia, Jeferson): o atual e os próximos, cadastrados com antecedência.
CREATE TABLE numbering_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  translator_id uuid NOT NULL REFERENCES sworn_translators (id),
  position integer NOT NULL CHECK (position > 0),
  book text NOT NULL CHECK (char_length(book) BETWEEN 1 AND 40),
  -- Próximo número de tradução e próxima folha deste livro.
  next_number integer NOT NULL CHECK (next_number > 0),
  next_sheet integer NOT NULL DEFAULT 1 CHECK (next_sheet > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'current', 'closed')),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  closed_at timestamptz,
  UNIQUE (translator_id, position),
  UNIQUE (translator_id, book)
);
CREATE UNIQUE INDEX numbering_books_current_idx ON numbering_books (translator_id) WHERE status = 'current';

-- Numeração preenchida pelo usuário em cada tradução; vira "emitida" na conclusão.
CREATE TABLE numbering_entries (
  job_id uuid PRIMARY KEY REFERENCES translation_jobs (id),
  translator_id uuid NOT NULL REFERENCES sworn_translators (id),
  number text CHECK (char_length(number) BETWEEN 1 AND 40),
  book text CHECK (char_length(book) <= 40),
  sheet_start integer CHECK (sheet_start > 0),
  sheet_end integer CHECK (sheet_end > 0),
  pages integer CHECK (pages BETWEEN 1 AND 10000),
  protocol text CHECK (char_length(protocol) <= 60),
  medium text CHECK (medium IN ('digital', 'impresso')),
  language text NOT NULL DEFAULT '' CHECK (char_length(language) <= 40),
  -- Número de lote gratuito (Carla) ou assinatura gratuita (Walter).
  free boolean NOT NULL DEFAULT false,
  protocol_value numeric(12, 2) CHECK (protocol_value >= 0),
  translator_fee numeric(12, 2) CHECK (translator_fee >= 0),
  page_charge numeric(12, 2) CHECK (page_charge >= 0),
  zero_protocol_authorized_by uuid REFERENCES users (id),
  stock_id uuid REFERENCES numbering_stock (id),
  book_id uuid REFERENCES numbering_books (id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'void')),
  -- Problemas encontrados na última conferência (duplicado, fora do estoque, fora da sequência…).
  anomalies jsonb NOT NULL DEFAULT '[]'::jsonb,
  entered_by uuid NOT NULL REFERENCES users (id),
  issued_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX numbering_entries_translator_idx ON numbering_entries (translator_id, status);
CREATE INDEX numbering_entries_stock_idx ON numbering_entries (stock_id) WHERE status <> 'void';

-- Traduções já concluídas entram como emitidas, para os painéis e a conferência de duplicados.
INSERT INTO numbering_entries (job_id, translator_id, number, book, status, entered_by, issued_at, updated_at)
SELECT j.id, j.translator_id, j.number_label, j.book_label, 'issued', coalesce(j.approved_by, j.requested_by), j.approved_at, coalesce(j.approved_at, now())
  FROM translation_jobs j
 WHERE j.translator_id IS NOT NULL AND j.number_label IS NOT NULL;

-- O mesmo número pode valer duas vezes para a Carla (em protocolos diferentes): a unicidade passa a ser da regra.
DROP INDEX translation_jobs_translator_number_idx;
