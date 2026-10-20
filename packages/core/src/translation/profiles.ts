import { z } from 'zod';
import type { Queryable } from '../db/pool.js';
import type { Language } from './draft.js';

/**
 * Modalidades de tradução e as regras de cada uma por idioma de destino (ADR-015). As regras padrão vêm das skills de
 * tradução da organização (ENG, FRA, ITA, ESP) e da regra de bordas; o Supervisor ou o Diretor ajusta por modalidade e
 * idioma, e o ajuste se sobrepõe ao padrão.
 */

export const MODES = ['sworn', 'certified', 'technical', 'simple'] as const;
export type Mode = (typeof MODES)[number];

export const modeLabel: Record<Mode, string> = {
  sworn: 'Juramentada',
  certified: 'Certificada',
  technical: 'Técnica',
  simple: 'Simples',
};

/** Etapas: correção (regras da tradução juramentada), tradução, diagramação (layout) e revisão. */
export const STAGES = ['correction', 'translation', 'layout', 'review'] as const;
export type Stage = (typeof STAGES)[number];

export const stageLabel: Record<Stage, string> = {
  correction: 'Correção',
  translation: 'Tradução',
  layout: 'Diagramação',
  review: 'Revisão',
};

/** Juramentada: correção + tradução; técnica e certificada: tradução + diagramação; todas: revisão. */
export const MODE_STAGES: Record<Mode, Stage[]> = {
  sworn: ['correction', 'translation', 'review'],
  certified: ['translation', 'layout', 'review'],
  technical: ['translation', 'layout', 'review'],
  simple: ['translation', 'review'],
};

/** Marcadores de elementos visuais por idioma (as skills: só entre colchetes, nada além disso). */
export const MARKERS: Record<
  Language,
  {
    coatOfArms: string;
    seal: string;
    stamp: string;
    watermark: string;
    signature: string;
    illegibleSignature: string;
    qrCode: string;
    illegible: string;
    decorativeBand: string;
    footer: string;
    logo: string;
    electronicSignature: string;
    photo: string;
  }
> = {
  pt: {
    coatOfArms: 'Brasão',
    seal: 'Selo',
    stamp: 'Carimbo',
    watermark: "Marca d'água",
    signature: 'Assinatura',
    illegibleSignature: 'Assinatura ilegível',
    qrCode: 'Código QR',
    illegible: 'ilegível',
    decorativeBand: 'Faixa decorativa',
    footer: 'Rodapé',
    logo: 'Logotipo',
    electronicSignature: 'Assinatura eletrônica',
    photo: 'Foto',
  },
  en: {
    coatOfArms: 'Coat of Arms',
    seal: 'Seal',
    stamp: 'Stamp',
    watermark: 'Watermark',
    signature: 'Signature',
    illegibleSignature: 'Illegible signature',
    qrCode: 'QR Code',
    illegible: 'illegible',
    decorativeBand: 'Decorative band',
    footer: 'Footer',
    logo: 'Logo',
    electronicSignature: 'Electronic signature',
    photo: 'Photo',
  },
  fr: {
    coatOfArms: 'Armoiries',
    seal: 'Sceau',
    stamp: 'Cachet',
    watermark: 'Filigrane',
    signature: 'Signature',
    illegibleSignature: 'Signature illisible',
    qrCode: 'Code QR',
    illegible: 'illisible',
    decorativeBand: 'Bandeau décoratif',
    footer: 'Pied de page',
    logo: 'Logo',
    electronicSignature: 'Signature électronique',
    photo: 'Photo',
  },
  it: {
    coatOfArms: 'Stemma',
    seal: 'Sigillo',
    stamp: 'Timbro',
    watermark: 'Filigrana',
    signature: 'Firma',
    illegibleSignature: 'Firma illeggibile',
    qrCode: 'Codice QR',
    illegible: 'illeggibile',
    decorativeBand: 'Fascia decorativa',
    footer: 'Piè di pagina',
    logo: 'Logo',
    electronicSignature: 'Firma elettronica',
    photo: 'Foto',
  },
  es: {
    coatOfArms: 'Escudo',
    seal: 'Sello',
    stamp: 'Sello',
    watermark: 'Marca de agua',
    signature: 'Firma',
    illegibleSignature: 'Firma ilegible',
    qrCode: 'Código QR',
    illegible: 'ilegible',
    decorativeBand: 'Franja decorativa',
    footer: 'Pie de página',
    logo: 'Logotipo',
    electronicSignature: 'Firma electrónica',
    photo: 'Foto',
  },
};

export const TranslationRules = z.strictObject({
  /** Fonte e tamanho de todo o documento traduzido. */
  font: z.string().trim().min(2).max(60),
  fontSize: z.number().min(6).max(24),
  /** Sufixo do nome do arquivo: "certidao.pdf" → "certidao - ENG.docx". */
  fileSuffix: z.string().max(20),
  /** Datas: por extenso no idioma de destino, ou no formato do original (só o nome do mês muda). */
  dates: z.enum(['long', 'as_original']),
  /** Números e códigos: exatamente como no original, ou com o separador decimal do idioma de destino. */
  numbers: z.enum(['keep', 'convert']),
  /** Elementos visuais: só marcadores entre colchetes, ou notas do tradutor descritivas. */
  visualElements: z.enum(['markers', 'translator_notes']),
  /** Nomes de instituições: traduzidos (mantendo nomes próprios) ou como no original. */
  institutions: z.enum(['translate', 'keep']),
  /** Trecho em um terceiro idioma: transcrever sem traduzir, ou traduzir. */
  otherLanguages: z.enum(['transcribe', 'translate']),
  /** Bordas: só em tabelas que existem no original (nada de bordas de parágrafo, linhas ou filetes). */
  bordersOnlyInTables: z.boolean(),
  /** Abertura, encerramento e assinatura do tradutor público (só na juramentada). */
  swornFrame: z.boolean(),
  /** Declaração ao final (certificada): o tradutor atesta a fidelidade, sem fé pública. */
  statement: z.string().max(1000).nullable(),
  /** Itens que a pessoa confirma em cada etapa manual, na ordem. */
  checklist: z.strictObject({
    correction: z.array(z.string().min(2).max(300)).max(30),
    layout: z.array(z.string().min(2).max(300)).max(30),
    review: z.array(z.string().min(2).max(300)).max(30),
  }),
});
export type TranslationRules = z.infer<typeof TranslationRules>;

const SUFFIX: Record<Language, string> = { en: ' - ENG', fr: '-FRA', it: ' - ITA', es: ' - ESP', pt: ' - POR' };

/** Itens comuns das skills de tradução (erros a evitar e checklist final). */
const TRANSLATION_CHECKS = [
  'Ordem do documento idêntica à do original: palavras, parágrafos, tudo na mesma sequência',
  'Nomes próprios, cidades, endereços e códigos (CPF, RG, SSP, SINIC) como no original, sem acentos acrescentados',
  'Números, datas e códigos conferidos com o original',
  'Negrito, itálico, alinhamento e centralização como no original (negrito só onde existe)',
  'Nenhum conteúdo deixado sem tradução e nada acrescentado (sem notas, observações ou legendas)',
  'Elementos visuais indicados só entre colchetes, no idioma de destino',
];

const LAYOUT_CHECKS = [
  'Tabelas com todas as colunas e campos do original, inclusive os vazios',
  'Fonte e tamanho da regra aplicados em todo o documento',
  'Nenhuma borda de parágrafo, linha horizontal ou filete: bordas só nas tabelas do original',
  'Faixas decorativas do original apenas como marcador de texto, em um único parágrafo, sem parágrafos vazios ao redor',
  'Cabeçalho, rodapé, quebras de página e espaçamentos conferidos com o original',
];

const REVIEW_CHECKS = [
  'Tradução comparada com o original do começo ao fim',
  'Glossário aplicado com terminologia consistente',
  'Nome do arquivo de saída: o nome do original com o sufixo do idioma',
  'Problemas encontrados registrados (destaque em amarelo no arquivo revisado), sem alterar a formatação',
];

/** Regras padrão por modalidade e idioma de destino, tiradas das skills (ADR-015). */
export function defaultRules(mode: Mode, target: Language): TranslationRules {
  const base: TranslationRules = {
    // ENG: Calibri Light 10; FRA, ITA, ESP: Times New Roman 10.
    font: target === 'en' ? 'Calibri Light' : 'Times New Roman',
    fontSize: 10,
    fileSuffix: SUFFIX[target],
    // ITA: datas como no original; ENG, FRA, ESP: por extenso.
    dates: target === 'it' ? 'as_original' : 'long',
    numbers: 'keep',
    visualElements: 'markers',
    institutions: 'translate',
    otherLanguages: 'transcribe',
    bordersOnlyInTables: true,
    swornFrame: mode === 'sworn',
    statement: null,
    checklist: { correction: [], layout: [], review: REVIEW_CHECKS },
  };
  switch (mode) {
    case 'sworn':
      return {
        ...base,
        checklist: {
          ...base.checklist,
          correction: [
            ...TRANSLATION_CHECKS,
            ...(target === 'fr' ? ['Apostila de Haia com os textos padrão em francês, sem misturar idiomas'] : []),
            'Trechos em outro idioma transcritos sem tradução e informados na entrega',
          ],
        },
      };
    case 'certified':
      return {
        ...base,
        statement: CERTIFIED_STATEMENT[target],
        checklist: { ...base.checklist, layout: LAYOUT_CHECKS },
      };
    case 'technical':
      return { ...base, checklist: { ...base.checklist, layout: LAYOUT_CHECKS } };
    case 'simple':
      return { ...base, numbers: 'convert', checklist: { ...base.checklist, review: REVIEW_CHECKS.slice(0, 2) } };
  }
}

/** Declaração da tradução certificada (sem fé pública), no idioma de destino. */
const CERTIFIED_STATEMENT: Record<Language, string> = {
  pt: 'Declaro que esta é uma tradução fiel e completa do documento original apresentado.',
  en: 'I hereby certify that this is a true and complete translation of the original document presented.',
  fr: 'Je certifie que la présente est une traduction fidèle et complète du document original présenté.',
  it: 'Si certifica che la presente è una traduzione fedele e completa del documento originale presentato.',
  es: 'Certifico que la presente es una traducción fiel y completa del documento original presentado.',
};

/** Regras efetivas: o padrão com o ajuste do Supervisor por cima. */
export function effectiveRules(mode: Mode, target: Language, override: unknown): TranslationRules {
  const base = defaultRules(mode, target);
  if (!override || typeof override !== 'object') return base;
  const merged = { ...base, ...(override as Partial<TranslationRules>) };
  merged.checklist = { ...base.checklist, ...((override as Partial<TranslationRules>).checklist ?? {}) };
  const parsed = TranslationRules.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

/** Itens de checklist de cada etapa manual da modalidade, com chave estável para registrar quem confirmou. */
export function checklistOf(mode: Mode, rules: TranslationRules) {
  return MODE_STAGES[mode]
    .filter((stage): stage is 'correction' | 'layout' | 'review' => stage !== 'translation')
    .flatMap((stage) => rules.checklist[stage].map((label, index) => ({ key: `${stage}:${index}`, stage, label })));
}

/** Nome do arquivo de saída: o do original com o sufixo da regra (as skills proíbem renomear pelo conteúdo). */
export const outputFileName = (original: string, rules: Pick<TranslationRules, 'fileSuffix'>) =>
  `${original.replace(/\.[^.]+$/, '')}${rules.fileSuffix}.docx`;

/** Regras efetivas lidas do banco (ajuste do Supervisor por cima do padrão das skills). */
export async function loadRules(db: Queryable, mode: Mode, target: Language) {
  const override = (
    await db.query<{ rules: unknown }>('SELECT rules FROM translation_profiles WHERE mode = $1 AND target_language = $2', [mode, target])
  ).rows[0]?.rules;
  return effectiveRules(mode, target, override);
}
