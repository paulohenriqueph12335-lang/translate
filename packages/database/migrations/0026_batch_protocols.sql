-- Protocolos identificam remessas novas. Lotes históricos preservam os campos nulos.
ALTER TABLE batches
  ADD COLUMN protocol text CHECK (char_length(protocol) BETWEEN 3 AND 80),
  ADD COLUMN no_protocol_reason text CHECK (char_length(no_protocol_reason) BETWEEN 10 AND 1000),
  ADD COLUMN inspection_mode text NOT NULL DEFAULT 'all' CHECK (inspection_mode IN ('all', 'sample')),
  ADD COLUMN inspection_sample_size integer CHECK (inspection_sample_size BETWEEN 1 AND 10),
  ADD CONSTRAINT batch_protocol_choice CHECK (protocol IS NULL OR no_protocol_reason IS NULL),
  ADD CONSTRAINT batch_inspection_choice CHECK ((inspection_mode = 'sample') = (inspection_sample_size IS NOT NULL));

CREATE INDEX batches_protocol_idx ON batches (lower(protocol)) WHERE protocol IS NOT NULL;
