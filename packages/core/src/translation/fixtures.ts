import type { Draft, DraftBlock, TableCell, TableRow } from './draft.js';
import type { TranslatorProfile } from './sworn-template.js';

/**
 * Referências fictícias do modelo em `fixtures/historico-escolar/` (documento de simulação, sem dados reais).
 * Usadas pelos testes de fidelidade e como exemplo de rascunho aprovado.
 */
export const fictitiousTranslator: TranslatorProfile = {
  name: 'Ana Beatriz Moreira Lima',
  titlePt: 'Tradutora Pública e Intérprete Comercial',
  languagePt: 'Inglês',
  registration: 'Matrícula JUCESP nº 0000 (fictícia)',
  registrationEn: 'the Commercial Registry of the State of São Paulo (JUCESP) under No. 0000 (fictitious)',
  registrationPt: 'na Junta Comercial do Estado de São Paulo (JUCESP) sob o nº 0000 (fictícia)',
  city: 'São Paulo',
  statePt: 'Estado de São Paulo',
  stateEn: 'State of São Paulo',
  letterheadNote: 'SIMULAÇÃO PARA FINS DE TREINAMENTO – SEM VALOR LEGAL',
  feeNote: 'Emolumentos: R$ 000,00 – Recibo nº 0000/2026 (fictícios)',
};

const r = { sourceText: null, origin: 'human' } as const;
const cell = (text: string, options: Partial<TableCell> = {}): TableCell => ({
  text,
  colSpan: 1,
  rowSpan: 1,
  bold: false,
  align: 'center',
  ...options,
});
const row = (style: TableRow['style'], cells: TableCell[]): TableRow => ({ style, cells });
const left = { align: 'left' } as const;

const grades: Array<[string | null, number, string, string[]]> = [
  ['Languages and their Technologies', 4, 'Portuguese Language', ['8.5', '160', '8.0', '160', '8.7', '160']],
  [null, 0, 'Arts', ['9.0', '40', '9.2', '40', '9.4', '40']],
  [null, 0, 'Physical Education', ['9.5', '80', '9.0', '80', '9.3', '80']],
  [null, 0, 'English Language', ['7.8', '80', '8.2', '80', '8.5', '80']],
  ['Mathematics and its Technologies', 1, 'Mathematics', ['7.5', '160', '7.9', '160', '8.1', '160']],
  ['Natural Sciences and their Technologies', 3, 'Biology', ['8.0', '80', '8.4', '80', '8.8', '80']],
  [null, 0, 'Physics', ['7.2', '80', '7.6', '80', '7.9', '80']],
  [null, 0, 'Chemistry', ['7.4', '80', '7.8', '80', '8.0', '80']],
  ['Human and Applied Social Sciences', 4, 'History', ['8.6', '80', '8.9', '80', '9.1', '80']],
  [null, 0, 'Geography', ['8.3', '80', '8.5', '80', '8.7', '80']],
  [null, 0, 'Philosophy', ['9.0', '40', '8.8', '40', '9.2', '40']],
  [null, 0, 'Sociology', ['8.7', '40', '9.0', '40', '9.1', '40']],
];

const blocks: DraftBlock[] = [
  { kind: 'translator_note', text: 'The document bears, at the top left, an emblem in the form of a shield.', ...r },
  { kind: 'heading', text: 'SECRETARIAT OF EDUCATION OF THE MUNICIPALITY OF VILA ESPERANÇA', align: 'center', level: 'normal', ...r },
  { kind: 'heading', text: 'HORIZONTE AZUL SCHOOL [Colégio Horizonte Azul]', align: 'center', level: 'normal', ...r },
  {
    kind: 'paragraph',
    text: 'Rua das Acácias, 1.250 – Centro – Vila Esperança, State of São Paulo – Zip Code 00000-000 – Phone (00) 0000-0000',
    align: 'center',
    bold: false,
    size: 'small',
    ...r,
  },
  {
    kind: 'paragraph',
    text: 'Authorization to operate: Ordinance SME No. 000/2010 – INEP Code 00000000 (fictitious)',
    align: 'center',
    bold: false,
    size: 'small',
    ...r,
  },
  { kind: 'heading', text: 'SCHOOL TRANSCRIPT [Histórico Escolar]', align: 'center', level: 'title', ...r },
  {
    kind: 'paragraph',
    text: 'HIGH SCHOOL [Ensino Médio] – Federal Law No. 9,394/1996',
    align: 'center',
    bold: false,
    size: 'normal',
    ...r,
  },
  {
    kind: 'table',
    columns: [2600, 2600, 1500, 2938],
    rows: [
      row('normal', [
        cell("Student's name: MARIANA ALVES TEIXEIRA", { colSpan: 3, ...left }),
        cell('RA [Student Registration No.]: 000.123.456-7', left),
      ]),
      row('normal', [
        cell('Date of birth: 03/14/2006', left),
        cell('Place of birth: Vila Esperança', left),
        cell('State: SP', left),
        cell('Nationality: Brazilian', left),
      ]),
      row('normal', [
        cell('RG [Identity Card]: 12.345.678-9 SSP/SP', { colSpan: 2, ...left }),
        cell('Sex: Female', { colSpan: 2, ...left }),
      ]),
      row('normal', [
        cell('Mother: Cláudia Alves Teixeira', { colSpan: 2, ...left }),
        cell('Father: Roberto Carlos Teixeira', { colSpan: 2, ...left }),
      ]),
    ],
    ...r,
  },
  {
    kind: 'translator_note',
    text: 'In the original document, grades are written with a decimal comma; they are rendered below with a decimal point.',
    ...r,
  },
  {
    kind: 'table',
    columns: [1900, 2002, 956, 956, 956, 956, 956, 956],
    rows: [
      row('header', [
        cell('Field of Knowledge', { rowSpan: 2 }),
        cell('Subject', { rowSpan: 2 }),
        cell('1st Year – 2021', { colSpan: 2 }),
        cell('2nd Year – 2022', { colSpan: 2 }),
        cell('3rd Year – 2023', { colSpan: 2 }),
      ]),
      row(
        'header',
        ['Grade', 'Hours', 'Grade', 'Hours', 'Grade', 'Hours'].map((text) => cell(text)),
      ),
      ...grades.map(([area, span, subject, values]) =>
        row('normal', [...(area ? [cell(area, { rowSpan: span })] : []), cell(subject, left), ...values.map((value) => cell(value))]),
      ),
      ...(
        [
          ['Annual workload', '1,000 h', '1,000 h', '1,000 h'],
          ['Attendance', '96%', '97%', '98%'],
          ['Final result', 'Passed', 'Passed', 'Passed'],
        ] as const
      ).map(([label, ...values]) =>
        row('summary', [
          cell(label, { colSpan: 2, bold: true, ...left }),
          ...values.map((value) => cell(value, { colSpan: 2, bold: true })),
        ]),
      ),
    ],
    ...r,
  },
  {
    kind: 'paragraph',
    text: 'Grading scale: 0.0 (zero) to 10.0 (ten). Minimum passing grade: 5.0 (five). Minimum attendance: 75%. Hours = workload in 60-minute class hours. Total course workload: 3,000 hours.',
    align: 'justify',
    bold: false,
    size: 'tiny',
    ...r,
  },
  { kind: 'section', text: 'STUDIES COMPLETED', ...r },
  {
    kind: 'table',
    columns: [1800, 1800, 6038],
    rows: [
      row('header', [cell('Year'), cell('School year'), cell('School')]),
      ...(['1st Year', '2nd Year', '3rd Year'] as const).map((year, index) =>
        row('normal', [
          cell(year, left),
          cell(String(2021 + index)),
          cell('Horizonte Azul School – Vila Esperança, State of São Paulo', left),
        ]),
      ),
    ],
    ...r,
  },
  { kind: 'section', text: 'CERTIFICATE OF COMPLETION', ...r },
  {
    kind: 'paragraph',
    text: 'The Principal of Horizonte Azul School, in the exercise of the legal duties of the office, hereby certifies that **MARIANA ALVES TEIXEIRA** completed **HIGH SCHOOL** in the school year of **2023**, being qualified to pursue higher education studies, pursuant to article 44, item II, of Federal Law No. 9,394/1996.',
    align: 'justify',
    bold: false,
    size: 'normal',
    ...r,
  },
  {
    kind: 'paragraph',
    text: '**Notes:** Document issued without amendments or erasures. Record No. 0458, Book 03, page 112.',
    align: 'justify',
    bold: false,
    size: 'normal',
    ...r,
  },
  { kind: 'paragraph', text: 'Vila Esperança, December 15, 2023.', align: 'right', bold: false, size: 'normal', ...r },
  { kind: 'signature', illegible: true, name: 'Juliana Ferreira Costa', role: 'School Secretary – Reg. 00.000', ...r },
  { kind: 'signature', illegible: true, name: 'Ricardo Mendes Duarte', role: 'Principal – Reg. 00.000', ...r },
  {
    kind: 'translator_note',
    text: "Rectangular stamp in blue ink reading: “COLÉGIO HORIZONTE AZUL – SECRETARIA – VILA ESPERANÇA – SP” [Horizonte Azul School – Registrar's Office – Vila Esperança – SP].",
    ...r,
  },
  {
    kind: 'translator_note',
    text: 'The document bears a diagonal watermark reading “DOCUMENTO SIMULADO – SEM VALIDADE” [SIMULATED DOCUMENT – NOT VALID].',
    ...r,
  },
  {
    kind: 'translator_note',
    text: 'Footer: “Fictitious document generated for simulation and training purposes. Institution, people and numbers are invented.”',
    ...r,
  },
];

/** Rascunho equivalente à tradução juramentada esperada do histórico escolar fictício. */
export const approvedTranscriptDraft: Draft = {
  sourceLanguage: 'pt',
  targetLanguage: 'en',
  documentType: 'SCHOOL TRANSCRIPT',
  sourceTitle: 'HISTÓRICO ESCOLAR',
  blocks,
};
