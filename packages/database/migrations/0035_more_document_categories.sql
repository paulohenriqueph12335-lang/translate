-- Tipos documentais novos: CNN, antecedentes criminais, atestado médico, atestados e declarações, divórcio,
-- procuração e ementa. As listas acompanham BODY_MODELS (packages/core/src/translation/body-models.ts).
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_document_category_check;
ALTER TABLE translation_jobs
  DROP CONSTRAINT IF EXISTS translation_jobs_document_category_check,
  DROP CONSTRAINT IF EXISTS translation_jobs_suggested_document_category_check;

ALTER TABLE batches ADD CONSTRAINT batches_document_category_check CHECK (document_category IN ('birth_certificate','marriage_certificate',
  'death_certificate','identity','driver_license','school_record','diploma','apostille','professional_certificate',
  'naturalization_certificate','criminal_record','medical_certificate','attestation','divorce','power_of_attorney','syllabus',
  'contract','invoice','generic'));
ALTER TABLE translation_jobs
  ADD CONSTRAINT translation_jobs_document_category_check CHECK (document_category IN ('birth_certificate','marriage_certificate',
    'death_certificate','identity','driver_license','school_record','diploma','apostille','professional_certificate',
    'naturalization_certificate','criminal_record','medical_certificate','attestation','divorce','power_of_attorney','syllabus',
    'contract','invoice','generic')),
  ADD CONSTRAINT translation_jobs_suggested_document_category_check CHECK (suggested_document_category IN ('birth_certificate',
    'marriage_certificate','death_certificate','identity','driver_license','school_record','diploma','apostille',
    'professional_certificate','naturalization_certificate','criminal_record','medical_certificate','attestation','divorce',
    'power_of_attorney','syllabus','contract','invoice','generic'));

-- Legado: só traduções classificadas automaticamente como gerais, e só pelo título explícito.
WITH titles AS (
  SELECT id,upper(unaccent(coalesce(source_title,''))) AS title FROM translation_jobs
   WHERE classification_source='automatic' AND document_category='generic'
), classified AS (
  SELECT id,CASE
    WHEN title ~ 'NEGATIVA DE NATURALIZACAO|NATURALIZACAO BRASILEIRA|CERTIFICATE OF (NON.?)?NATURALI[SZ]ATION|NATURALISATION|NATURALIZZAZIONE|NATURALIZACION' THEN 'naturalization_certificate'
    WHEN title ~ 'ANTECEDENTES (CRIMINAIS|PENAIS|PENALES)|CRIMINAL (RECORD|BACKGROUND)|POLICE (CERTIFICATE|CLEARANCE)|IDENTITY HISTORY SUMMARY|CASIER JUDICIAIRE|CASELLARIO GIUDIZIALE|PRECEDENTI PENALI' THEN 'criminal_record'
    WHEN title ~ 'ATESTADO MEDICO|MEDICAL CERTIFICATE|CERTIFICAT MEDICAL|CERTIFICATO MEDICO|CERTIFICADO MEDICO' THEN 'medical_certificate'
    WHEN title ~ 'PROCURACAO|SUBSTABELECIMENTO|POWER OF ATTORNEY|\yPROCURATION\y|\yPROCURA (SPECIALE|GENERALE)\y|PODER (NOTARIAL|GENERAL|ESPECIAL)' THEN 'power_of_attorney'
    WHEN title ~ 'DIVORCIO|\yDIVORCE\y|\yDIVORZIO\y|DISSOLUTION OF MARRIAGE|CESSAZIONE DEGLI EFFETTI CIVILI' THEN 'divorce'
    WHEN title ~ '\yEMENTA\y|PLANO DE ENSINO|CONTEUDO PROGRAMATICO|\ySYLLABUS\y|PROGRAMME D.ENSEIGNEMENT|PROGRAMMA DEL CORSO|PROGRAMA DE (LA )?ASIGNATURA' THEN 'syllabus'
    WHEN title ~ '\yATESTADO\y|\yDECLARACAO\y|\yAFFIDAVIT\y|\yATTESTATION\y|\yATTESTATO\y|\yDICHIARAZIONE\y|\yCONSTANCIA\y' THEN 'attestation'
    END AS category FROM titles
)
UPDATE translation_jobs j SET document_category=c.category,suggested_document_category=c.category,
  classification_confidence=95,classification_basis='title'
FROM classified c WHERE c.id=j.id AND c.category IS NOT NULL;
