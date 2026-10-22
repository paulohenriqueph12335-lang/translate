import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { LANGUAGE_NAMES } from '../conventions.js';
import type { Language } from '../draft.js';
import { renderSwornDocx } from '../render-docx.js';
import { swornFrame, type TranslatorProfile } from '../sworn-template.js';

/**
 * Modelos de moldura da tradução juramentada (ADR-019): timbre, abertura, encerramento, numeração e rodapé prontos,
 * preenchidos com os dados do tradutor. O tradutor sem máscara própria escolhe um modelo; a moldura é gerada no
 * idioma de cada tradução, com os marcadores do sistema ({{numero}}, {{texto}}…) para a conclusão preencher.
 */

export const FRAME_MODELS = ['classico', 'quadro', 'bilingue', 'compacto'] as const;
export type FrameModel = (typeof FRAME_MODELS)[number];

export const FRAME_MODEL_INFO: Record<FrameModel, { label: string; description: string }> = {
  classico: {
    label: 'Clássico',
    description:
      'Timbre centralizado, título "Tradução Pública nº" com livro e folha, abertura e encerramento no idioma da tradução e assinatura ao centro.',
  },
  quadro: {
    label: 'Cabeçalho em quadro',
    description: 'Timbre em duas colunas (tradutor à esquerda, matrícula e contato à direita) e um quadro com número, livro e folha.',
  },
  bilingue: {
    label: 'Bilíngue',
    description: 'Abertura e encerramento em português e no idioma da tradução, um embaixo do outro, como em muitas juntas comerciais.',
  },
  compacto: {
    label: 'Compacto',
    description: 'Uma linha de timbre e uma de numeração, para documentos curtos (identidade, CNH, certidões de uma página).',
  },
};

/** Dados do tradutor que a moldura usa (o resto vem do cadastro). */
export interface FrameProfile {
  name: string;
  registration: string;
  city: string;
  state: string;
  /** Endereço, telefone ou e-mail no timbre (opcional). */
  contact: string | null;
  /** Título no timbre; padrão "Tradutor(a) Público(a) e Intérprete Comercial". */
  title?: string | null;
}

const TITLE = 'Tradutor(a) Público(a) e Intérprete Comercial';
const capitalize = (text: string) => text.replace(/^./, (char) => char.toUpperCase());

function translatorProfile(profile: FrameProfile, source: Language, target: Language): TranslatorProfile {
  const foreign = target === 'pt' ? source : target;
  return {
    name: profile.name,
    titlePt: profile.title?.trim() || TITLE,
    languagePt: capitalize(LANGUAGE_NAMES.pt[foreign]),
    registration: profile.registration,
    registrationEn: `the Commercial Registry (${profile.registration})`,
    registrationPt: `na Junta Comercial (${profile.registration})`,
    city: profile.city,
    statePt: profile.state,
    stateEn: profile.state,
    letterheadNote: profile.contact,
    feeNote: null,
  };
}

interface Look {
  font: string;
  fontSize: number;
}

/** "texto **negrito** texto" em trechos do Word. */
function runs(text: string, look: Look, options: { bold?: boolean; size?: number } = {}) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => {
      const strong = part.startsWith('**') && part.endsWith('**') && part.length > 4;
      return new TextRun({
        text: strong ? part.slice(2, -2) : part,
        font: look.font,
        size: Math.round((options.size ?? look.fontSize) * 2),
        ...(options.bold || strong ? { bold: true } : {}),
      });
    });
}

const para = (
  text: string,
  look: Look,
  options: { align?: 'left' | 'center' | 'right' | 'justify'; bold?: boolean; size?: number; after?: number } = {},
) =>
  new Paragraph({
    alignment:
      options.align === 'center'
        ? AlignmentType.CENTER
        : options.align === 'right'
          ? AlignmentType.RIGHT
          : options.align === 'justify'
            ? AlignmentType.JUSTIFIED
            : AlignmentType.LEFT,
    spacing: { before: 0, after: options.after ?? 120, line: 264 },
    children: runs(text, look, options),
  });

/** Rodapé "Tradução Pública nº {{numero}} – Página X de Y" (campos de página do Word). */
const pageFooter = (look: Look, prefix: string) =>
  new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: prefix, font: look.font, size: Math.round((look.fontSize - 2) * 2) }),
          new TextRun({ children: [PageNumber.CURRENT], font: look.font, size: Math.round((look.fontSize - 2) * 2) }),
          new TextRun({ text: ' / ', font: look.font, size: Math.round((look.fontSize - 2) * 2) }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: look.font, size: Math.round((look.fontSize - 2) * 2) }),
        ],
      }),
    ],
  });

const PAGE = { width: 11906, height: 16838, top: 1134, bottom: 1134, left: 1418, right: 1134, header: 567, footer: 567 };
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE = { style: BorderStyle.SINGLE, size: 6, color: '444444' };

/** Abertura e encerramento em português, para o modelo bilíngue (o português sempre explica de onde para onde). */
function portugueseFrame(profile: TranslatorProfile, source: Language, target: Language) {
  const name = profile.name.toUpperCase();
  return {
    opening: `Eu, abaixo assinado(a), **${name}**, ${profile.titlePt}, devidamente nomeado(a) e matriculado(a) ${profile.registrationPt}, **CERTIFICO** que me foi apresentado um documento redigido em ${LANGUAGE_NAMES.pt[source]}, que fielmente traduzo para o ${LANGUAGE_NAMES.pt[target]} como segue:`,
    closing: `**NADA MAIS** constava do referido documento, que fielmente traduzi, conferi e achei conforme o original, ao qual me reporto. **EM TESTEMUNHO DO QUE**, firmo a presente na cidade de ${profile.city}, ${profile.statePt}, Brasil, em {{data}}.`,
  };
}

/**
 * Word da moldura no idioma da tradução, com os marcadores do sistema. O conteúdo traduzido entra em {{texto}}; a
 * fonte e o tamanho do conteúdo vêm da regra da modalidade (aplicados no preenchimento).
 */
export async function renderFrameModel(
  model: FrameModel,
  input: FrameProfile,
  source: Language,
  target: Language,
  look: Look = { font: 'Times New Roman', fontSize: 10 },
): Promise<Buffer> {
  const profile = translatorProfile(input, source, target);
  const placeholderDraft = {
    sourceLanguage: source,
    targetLanguage: target,
    documentType: '{{tipo}}',
    sourceTitle: '',
    blocks: [
      {
        kind: 'paragraph' as const,
        text: '{{texto}}',
        align: 'justify' as const,
        bold: false,
        size: 'normal' as const,
        sourceText: null,
        origin: 'rules' as const,
      },
    ],
  };
  if (model === 'classico') {
    return renderSwornDocx(placeholderDraft, { profile, issuedAt: new Date(), numbering: null, placeholders: true, look });
  }

  const frame = swornFrame(profile, source, target, new Date(), null, true);
  const name = profile.name.toUpperCase();
  const content = para('{{texto}}', look, { align: 'justify' });
  const typeLine = para(`**${frame.documentTypeLabel}:** {{tipo}}`, look, { after: 200 });
  const signature = [
    para('______________________________________', look, { align: 'center', after: 0 }),
    para(name, look, { align: 'center', bold: true, after: 0 }),
    para(`${profile.titlePt} – ${profile.languagePt}`, look, { align: 'center', size: look.fontSize - 1, after: 0 }),
    para(profile.registration, look, { align: 'center', size: look.fontSize - 1, after: 0 }),
  ];

  let header: Array<Paragraph | Table>;
  let body: Array<Paragraph | Table>;
  if (model === 'quadro') {
    const cell = (children: Paragraph[], align: 'left' | 'right') =>
      new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: { top: NONE, left: NONE, right: NONE, bottom: LINE },
        children: children.length ? children : [para('', look, { align })],
      });
    header = [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              cell(
                [
                  para(name, look, { bold: true, after: 0 }),
                  para(`${profile.titlePt} – ${profile.languagePt}`, look, { size: look.fontSize - 1, after: 60 }),
                ],
                'left',
              ),
              cell(
                [
                  para(profile.registration, look, { align: 'right', size: look.fontSize - 1, after: 0 }),
                  para(`${profile.city} – ${profile.statePt}`, look, { align: 'right', size: look.fontSize - 1, after: 0 }),
                  ...(profile.letterheadNote
                    ? [para(profile.letterheadNote, look, { align: 'right', size: look.fontSize - 1, after: 60 })]
                    : []),
                ],
                'right',
              ),
            ],
          }),
        ],
      }),
    ];
    const box = (text: string) =>
      new TableCell({
        width: { size: 33, type: WidthType.PERCENTAGE },
        borders: { top: LINE, bottom: LINE, left: LINE, right: LINE },
        shading: { fill: 'EEF1F4' },
        children: [para(text, look, { align: 'center', bold: true, after: 0 })],
      });
    body = [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: [box('TRADUÇÃO PÚBLICA Nº {{numero}}'), box('LIVRO Nº {{livro}}'), box('FOLHA Nº {{folha}}')] })],
      }),
      para('', look, { after: 120 }),
      para(frame.opening, look, { align: 'justify', after: 200 }),
      typeLine,
      content,
      para(frame.closing, look, { align: 'justify', after: 360 }),
      ...signature,
    ];
  } else if (model === 'bilingue') {
    const portuguese = portugueseFrame(profile, source, target);
    const second = target === 'pt' ? null : frame;
    header = [
      para(name, look, { align: 'center', bold: true, after: 0 }),
      para(`${profile.titlePt} – ${profile.languagePt} – ${profile.registration}`, look, {
        align: 'center',
        size: look.fontSize - 1,
        after: 120,
      }),
    ];
    body = [
      para('TRADUÇÃO PÚBLICA Nº {{numero}}', look, { align: 'center', bold: true, size: look.fontSize + 1, after: 0 }),
      para('LIVRO Nº {{livro}} – FOLHA Nº {{folha}}', look, { align: 'center', bold: true, after: 200 }),
      para(portuguese.opening, look, { align: 'justify', after: second ? 120 : 200 }),
      ...(second ? [para(second.opening, look, { align: 'justify', after: 200 })] : []),
      typeLine,
      content,
      para(portuguese.closing, look, { align: 'justify', after: second ? 120 : 360 }),
      ...(second ? [para(second.closing, look, { align: 'justify', after: 360 })] : []),
      ...signature,
    ];
  } else {
    // compacto
    header = [
      para(`**${name}** · ${profile.titlePt} – ${profile.languagePt} · ${profile.registration}`, look, {
        align: 'center',
        size: look.fontSize - 1,
        after: 60,
      }),
    ];
    body = [
      para('**TRADUÇÃO PÚBLICA Nº {{numero}}** · Livro {{livro}} · Folha {{folha}} · {{data_curta}}', look, {
        align: 'center',
        after: 160,
      }),
      para(frame.opening, look, { align: 'justify', after: 160 }),
      typeLine,
      content,
      para(frame.closing, look, { align: 'justify', after: 240 }),
      para(`**${name}**`, look, { align: 'right', after: 0 }),
      para(profile.registration, look, { align: 'right', size: look.fontSize - 1, after: 0 }),
    ];
  }
  if (profile.letterheadNote && model !== 'quadro')
    header.push(para(profile.letterheadNote, look, { align: 'center', size: look.fontSize - 2, after: 120 }));

  const document = new Document({
    creator: profile.name,
    title: `Máscara ${FRAME_MODEL_INFO[model].label} – ${profile.name}`,
    styles: { default: { document: { run: { font: look.font, size: Math.round(look.fontSize * 2) } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: { top: PAGE.top, right: PAGE.right, bottom: PAGE.bottom, left: PAGE.left, header: PAGE.header, footer: PAGE.footer },
          },
        },
        headers: { default: new Header({ children: header }) },
        footers: { default: pageFooter(look, 'Tradução Pública nº {{numero}} – Livro nº {{livro}} – Página ') },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(document);
}
