-- Classificação canônica independente do título traduzido e das etiquetas livres.
ALTER TABLE batches ADD COLUMN document_category text
  CHECK (document_category IN ('birth_certificate','marriage_certificate','death_certificate','identity','driver_license',
    'school_record','diploma','apostille','professional_certificate','contract','invoice','generic'));
ALTER TABLE translation_jobs
  ADD COLUMN document_category text CHECK (document_category IN ('birth_certificate','marriage_certificate','death_certificate','identity',
    'driver_license','school_record','diploma','apostille','professional_certificate','contract','invoice','generic')),
  ADD COLUMN suggested_document_category text CHECK (suggested_document_category IN ('birth_certificate','marriage_certificate','death_certificate',
    'identity','driver_license','school_record','diploma','apostille','professional_certificate','contract','invoice','generic')),
  ADD COLUMN classification_confidence integer NOT NULL DEFAULT 0 CHECK (classification_confidence BETWEEN 0 AND 100),
  ADD COLUMN classification_basis text NOT NULL DEFAULT 'unrecognized' CHECK (classification_basis IN ('title','opening_text','unrecognized')),
  ADD COLUMN classification_source text NOT NULL DEFAULT 'automatic' CHECK (classification_source IN ('automatic','human')),
  ADD COLUMN classification_by uuid REFERENCES users(id),
  ADD COLUMN classification_at timestamptz;

-- Legado: reconhece apenas palavras explícitas do título, sem atribuir certeza ao texto ausente.
WITH titles AS (
  SELECT id,upper(unaccent(coalesce(source_title,''))) AS title FROM translation_jobs
), classified AS (
  SELECT id,CASE
    WHEN title ~ 'APOSTIL(A|LA|LE)|CONVENCAO DA HAIA|CONVENTION DE LA HAYE' THEN 'apostille'
    WHEN title ~ 'CONSELHO (REGIONAL|FEDERAL|FICTICIO) DE|CERTIDAO DE (INSCRICAO|REGULARIDADE)|CERTIFICATE OF REGISTRATION|CERTIFICAT D.INSCRIPTION|CERTIFICATO DI ISCRIZIONE|CERTIFICADO DE INSCRIPCION' THEN 'professional_certificate'
    WHEN title ~ 'CARTEIRA NACIONAL DE HABILITACAO|PERMISSAO PARA DIRIGIR|DRIVER.S LICEN[CS]E|DRIVING LICEN[CS]E|PERMIS DE CONDUIRE|PATENTE DI GUIDA|LICENCIA DE CONDUCIR' THEN 'driver_license'
    WHEN title ~ 'CARTEIRA DE IDENTIDADE|REGISTRO GERAL|CEDULA DE IDENTIDADE|IDENTITY CARD|CARTE D.IDENTITE|CARTA D.IDENTITA|DOCUMENTO DE IDENTIDAD' THEN 'identity'
    WHEN title ~ 'CERTIDAO DE NASCIMENTO|REGISTRO DE NASCIMENTO|BIRTH CERTIFICATE|ACTE DE NAISSANCE|(ATTO|CERTIFICATO) DI NASCITA|ACTA DE NACIMIENTO' THEN 'birth_certificate'
    WHEN title ~ 'CERTIDAO DE CASAMENTO|MARRIAGE CERTIFICATE|ACTE DE MARIAGE|(ATTO|CERTIFICATO) DI MATRIMONIO|ACTA DE MATRIMONIO' THEN 'marriage_certificate'
    WHEN title ~ 'CERTIDAO DE OBITO|DEATH CERTIFICATE|ACTE DE DECES|(ATTO|CERTIFICATO) DI MORTE|ACTA DE DEFUNCION' THEN 'death_certificate'
    WHEN title ~ 'HISTORICO ESCOLAR|HISTORICO ACADEMICO|TRANSCRIPT|RELEVE DE NOTES|CERTIFICATO DEGLI ESAMI|CERTIFICADO DE ESTUDIOS' THEN 'school_record'
    WHEN title ~ 'DIPLOM[AE]|CERTIFICADO DE CONCLUSAO' THEN 'diploma'
    WHEN title ~ 'FATURA|EXTRATO|INVOICE|STATEMENT OF ACCOUNT|FACTURE|FATTURA|FACTURA' THEN 'invoice'
    WHEN title ~ 'CONTRATO|CLAUSULA|CONTRATANTE|CONTRACT|CONTRAT|CONTRATTO' THEN 'contract'
    ELSE 'generic' END AS category FROM titles
)
UPDATE translation_jobs j SET document_category=c.category,suggested_document_category=c.category,
  classification_confidence=CASE WHEN c.category='generic' THEN 0 ELSE 95 END,
  classification_basis=CASE WHEN c.category='generic' THEN 'unrecognized' ELSE 'title' END
FROM classified c WHERE c.id=j.id;
CREATE INDEX translation_jobs_category_created_idx ON translation_jobs(document_category,created_at DESC,id DESC);
CREATE INDEX translation_jobs_expired_lease_idx ON translation_jobs(lease_expires_at) WHERE status='processing';
