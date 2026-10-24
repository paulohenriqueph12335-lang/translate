import { useState } from 'react';
import { api, type DocumentCategory, type DocumentCategoryOption, type TranslationSummary } from './api';
import { useConfirm } from './ConfirmDialog';
import { dateTime, Feedback, message, useLoad } from './ui';

export function useDocumentCategories() {
  return useLoad(() => api<{ categories: DocumentCategoryOption[] }>('GET', '/document-categories'), []);
}

export function DocumentCategorySelect({
  value,
  onChange,
  categories,
}: {
  value: DocumentCategory | '';
  onChange: (category: DocumentCategory | '') => void;
  categories: DocumentCategoryOption[];
}) {
  const selected = categories.find((item) => item.value === value);
  return (
    <label>
      Tipo documental e modelo
      <select
        aria-label="Tipo documental e modelo"
        value={value}
        onChange={(event) => onChange(event.target.value as DocumentCategory | '')}
      >
        <option value="">Automático — identificar pelo documento</option>
        {categories.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <small className="muted">
        {selected?.description ??
          (selected
            ? 'O tipo escolhido orienta o modelo da tradução. A estrutura do original continua disponível para conferência.'
            : 'O sistema sugere o tipo pelo título e início do texto. Para documentos de tipos diferentes, mantenha Automático.')}
      </small>
    </label>
  );
}

export function DocumentClassificationPanel({ translation: t, onSaved }: { translation: TranslationSummary; onSaved: () => void }) {
  const confirm = useConfirm();
  const catalog = useDocumentCategories();
  const classification = t.classification;
  const [category, setCategory] = useState<DocumentCategory>(classification?.category ?? 'generic');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!classification) return null;
  const suggestion = catalog.data?.categories.find((item) => item.value === classification.suggestedCategory)?.label;
  async function save() {
    const completed = t.status === 'approved' || t.status === 'awaiting_approval';
    if (
      completed &&
      !(await confirm(
        'Este documento já está pronto. Deseja corrigir o tipo documental? A mudança será auditada e orientará o modelo na próxima geração, sem substituir o Word atual.',
      ))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api('PUT', `/translations/${t.id}/classification`, {
        category,
        reason: reason.trim(),
        ...(completed ? { confirmCompleted: true } : {}),
      });
      setReason('');
      onSaved();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card document-classification">
      <h3>Tipo documental e modelo</h3>
      <p>
        <strong>{classification.label}</strong> ·{' '}
        {classification.source === 'human' ? 'Escolha registrada pela equipe' : 'Identificado automaticamente'}
      </p>
      <p className="muted small-text">
        Sugestão do sistema:{' '}
        {suggestion ?? (classification.suggestedCategory === classification.category ? classification.label : 'aguardando catálogo')}.{' '}
        {classification.basis === 'unrecognized'
          ? 'Evidência insuficiente; confira e escolha o tipo adequado.'
          : `Evidência pelo ${classification.basis === 'title' ? 'título' : 'início do texto'}: ${classification.confidence}/100.`}{' '}
        Este indicador expressa a força das regras de identificação.
        {classification.correctedAt ? ` Atualizado em ${dateTime(classification.correctedAt)}.` : ''}
      </p>
      {t.permissions.classify && (
        <details>
          <summary>Corrigir tipo documental</summary>
          <fieldset className="classification-fields" disabled={busy}>
            <label>
              Tipo documental
              <select value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)}>
                {catalog.data?.categories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motivo da correção
              <textarea rows={2} minLength={5} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <p className="muted small-text">
              A classificação será aplicada ao modelo na próxima geração. O arquivo atual continua disponível para conferência.
            </p>
            <button
              className="primary"
              type="button"
              disabled={busy || category === classification.category || reason.trim().length < 5}
              onClick={() => void save()}
            >
              {busy ? 'Salvando…' : 'Salvar classificação'}
            </button>
          </fieldset>
        </details>
      )}
      <Feedback error={error ?? catalog.error} />
    </section>
  );
}
