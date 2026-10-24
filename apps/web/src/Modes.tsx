import { useEffect, useState } from 'react';
import {
  api,
  LANGUAGE_PAIRS,
  languageLabel,
  LANGUAGES,
  MODES,
  modeHint,
  modeLabel,
  stageLabel,
  type ChecklistItem,
  type Language,
  type ProfilesOverview,
  type Stage,
  type TranslationMode,
  type TranslationRules,
} from './api';
import { dateTime, Feedback, message, Segmented, useLoad } from './ui';

/** Modalidades de tradução, etapas e regras (ADR-015). */

export function PairSelect({
  value,
  onChange,
  any,
  label = 'Idiomas',
}: {
  value: string;
  onChange: (value: string) => void;
  /** Texto da opção "qualquer par" nos filtros. */
  any?: string;
  label?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {any !== undefined && <option value="">{any}</option>}
      {LANGUAGE_PAIRS.map((pair) => (
        <option key={pair.value} value={pair.value}>
          {pair.label}
        </option>
      ))}
    </select>
  );
}

export function ModeSelect({ value, onChange }: { value: TranslationMode; onChange: (mode: TranslationMode) => void }) {
  return (
    <div className="mode-options" role="radiogroup" aria-label="Modalidade da tradução">
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className={`mode-option ${value === mode ? 'on' : ''}`}
          onClick={() => onChange(mode)}
        >
          <strong>{modeLabel[mode]}</strong>
          <span className="muted small-text">{modeHint[mode]}</span>
        </button>
      ))}
    </div>
  );
}

export function ModeBadge({ mode }: { mode: TranslationMode }) {
  return <span className={`badge mode-${mode}`}>{modeLabel[mode]}</span>;
}

/**
 * Etapas da modalidade e o checklist de cada etapa manual (correção, diagramação, revisão). "Pronta" só passa com
 * todos os itens confirmados.
 */
export function StagesPanel({
  translationId,
  stages,
  checklist,
  editable,
  completed = false,
  onChange,
}: {
  translationId: string;
  stages: Stage[];
  checklist: ChecklistItem[];
  editable: boolean;
  completed?: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(keys: string[], checked: boolean) {
    if (
      completed &&
      !window.confirm(
        'Este documento está pronto para aprovação. Tem certeza de que deseja alterar o checklist? A mudança ficará registrada.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api('PUT', `/translations/${translationId}/checks`, { keys, checked, ...(completed ? { confirmCompleted: true } : {}) });
      onChange();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stages">
      <ol className="stage-track">
        {stages.map((stage) => {
          const items = checklist.filter((item) => item.stage === stage);
          const done = stage === 'translation' || (items.length > 0 && items.every((item) => item.checked));
          return (
            <li key={stage} className={done ? 'done' : ''}>
              <strong>{stageLabel[stage]}</strong>
              <span className="muted small-text">
                {stage === 'translation'
                  ? 'Automática, no layout do original'
                  : `${items.filter((item) => item.checked).length}/${items.length} conferidos`}
              </span>
            </li>
          );
        })}
      </ol>
      {stages
        .filter((stage): stage is Exclude<Stage, 'translation'> => stage !== 'translation')
        .map((stage) => {
          const items = checklist.filter((item) => item.stage === stage);
          if (!items.length) return null;
          const pending = items.filter((item) => !item.checked);
          return (
            <details key={stage} className="checklist" open={pending.length > 0}>
              <summary>
                {stageLabel[stage]}: {pending.length ? `${pending.length} item(ns) a conferir` : 'tudo conferido'}
              </summary>
              <ul>
                {items.map((item) => (
                  <li key={item.key}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!item.checked}
                        disabled={!editable || busy}
                        onChange={(e) => void toggle([item.key], e.target.checked)}
                      />
                      <span>
                        {item.label}
                        {item.checked && (
                          <span className="muted small-text block-line">
                            {item.checked.name}, {dateTime(item.checked.at)}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {editable && pending.length > 1 && (
                <button
                  className="small ghost"
                  disabled={busy}
                  onClick={() =>
                    void toggle(
                      pending.map((item) => item.key),
                      true,
                    )
                  }
                >
                  Confirmar os {pending.length} itens de {stageLabel[stage].toLowerCase()}
                </button>
              )}
            </details>
          );
        })}
      <Feedback error={error} />
    </div>
  );
}

const DATES: Array<[TranslationRules['dates'], string]> = [
  ['long', 'Por extenso no idioma de destino'],
  ['as_original', 'Como no original (só o nome do mês muda)'],
];
const NUMBERS: Array<[TranslationRules['numbers'], string]> = [
  ['keep', 'Exatamente como no original'],
  ['convert', 'Separador decimal do idioma de destino'],
];
const VISUAL: Array<[TranslationRules['visualElements'], string]> = [
  ['markers', 'Só marcador entre colchetes ([Carimbo], [Assinatura])'],
  ['translator_notes', 'Nota do tradutor descritiva'],
];

/** Regras de cada modalidade por idioma de destino: o padrão das skills, que o Supervisor ou o Diretor ajusta. */
export function TranslationRulesEditor() {
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => api<ProfilesOverview>('GET', '/translation-profiles'), [version]);
  const [mode, setMode] = useState<TranslationMode>('sworn');
  const [target, setTarget] = useState<Language>('en');
  const entry = data?.modes.find((item) => item.mode === mode)?.languages.find((item) => item.target === target);
  const stages = data?.modes.find((item) => item.mode === mode)?.stages ?? [];
  const [rules, setRules] = useState<TranslationRules | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  useEffect(() => setRules(entry?.rules ?? null), [entry]);
  const canEdit = data?.canEdit ?? false;
  const set = <K extends keyof TranslationRules>(key: K, value: TranslationRules[K]) =>
    setRules((current) => (current ? { ...current, [key]: value } : current));

  async function save(reset = false) {
    try {
      await api('PUT', `/translation-profiles/${mode}/${target}`, { rules: reset ? null : rules });
      setFeedback({ ok: reset ? 'Regra voltou ao padrão das skills.' : 'Regra salva: vale para as próximas traduções.' });
      setVersion((value) => value + 1);
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  const select = <K extends 'dates' | 'numbers' | 'visualElements'>(
    key: K,
    label: string,
    options: Array<[TranslationRules[K], string]>,
  ) => (
    <label>
      {label}
      <select value={rules?.[key] as string} disabled={!canEdit} onChange={(e) => set(key, e.target.value as TranslationRules[K])}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="stack">
      <p className="muted small-text">
        O padrão vem das skills de tradução da organização (ENG, FRA, ITA, ESP) e da regra de bordas. Ajustes valem para as traduções
        processadas depois.
      </p>
      <Segmented label="Modalidade" value={mode} options={MODES.map((value) => [value, modeLabel[value]])} onChange={setMode} />
      <div className="filters">
        <select aria-label="Idioma de destino" value={target} onChange={(e) => setTarget(e.target.value as Language)}>
          {LANGUAGES.map((value) => (
            <option key={value} value={value}>
              Para {languageLabel[value].toLowerCase()}
            </option>
          ))}
        </select>
        <span className="muted small-text">Etapas: {stages.map((stage) => stage.label).join(' → ')}</span>
        {entry?.customized && (
          <span className="badge info">
            Ajustada por {entry.updatedBy} em {entry.updatedAt ? dateTime(entry.updatedAt) : ''}
          </span>
        )}
      </div>
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      {rules && (
        <div className="card stack">
          <div className="field-row">
            <label>
              Fonte
              <input value={rules.font} disabled={!canEdit} onChange={(e) => set('font', e.target.value)} />
            </label>
            <label>
              Tamanho (pt)
              <input
                inputMode="decimal"
                value={rules.fontSize}
                disabled={!canEdit}
                onChange={(e) => set('fontSize', Number(e.target.value) || 10)}
              />
            </label>
            <label>
              Sufixo do arquivo
              <input value={rules.fileSuffix} disabled={!canEdit} onChange={(e) => set('fileSuffix', e.target.value)} />
              <small className="muted">certidao.pdf → certidao{rules.fileSuffix}.docx</small>
            </label>
          </div>
          <div className="field-row">
            {select('dates', 'Datas', DATES)}
            {select('numbers', 'Números e códigos', NUMBERS)}
            {select('visualElements', 'Elementos visuais', VISUAL)}
          </div>
          <div className="field-row">
            <label className="check">
              <input
                type="checkbox"
                checked={rules.institutions === 'translate'}
                disabled={!canEdit}
                onChange={(e) => set('institutions', e.target.checked ? 'translate' : 'keep')}
              />
              Traduzir nomes de instituições (nomes próprios ficam)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={rules.otherLanguages === 'transcribe'}
                disabled={!canEdit}
                onChange={(e) => set('otherLanguages', e.target.checked ? 'transcribe' : 'translate')}
              />
              Trechos em outro idioma: transcrever sem traduzir
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={rules.bordersOnlyInTables}
                disabled={!canEdit}
                onChange={(e) => set('bordersOnlyInTables', e.target.checked)}
              />
              Bordas só nas tabelas do original
            </label>
          </div>
          {mode === 'certified' && (
            <label>
              Declaração do tradutor
              <textarea
                rows={2}
                value={rules.statement ?? ''}
                disabled={!canEdit}
                onChange={(e) => set('statement', e.target.value || null)}
              />
            </label>
          )}
          {(['correction', 'layout', 'review'] as const)
            .filter((stage) => stages.some((item) => item.stage === stage))
            .map((stage) => (
              <label key={stage}>
                Checklist de {stageLabel[stage].toLowerCase()} (um item por linha)
                <textarea
                  rows={Math.max(3, rules.checklist[stage].length + 1)}
                  value={rules.checklist[stage].join('\n')}
                  disabled={!canEdit}
                  onChange={(e) =>
                    set('checklist', {
                      ...rules.checklist,
                      [stage]: e.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            ))}
          {canEdit && (
            <div className="actions">
              <button className="primary" onClick={() => void save()}>
                Salvar regra
              </button>
              {entry?.customized && (
                <button className="ghost" onClick={() => void save(true)}>
                  Voltar ao padrão das skills
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
