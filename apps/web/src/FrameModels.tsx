import { useMemo, useState } from 'react';
import { api, LANGUAGES, languageLabel, type Language, type SwornTranslator } from './api';
import { Feedback, message, useLoad, useDebounced } from './ui';

interface FrameModelInfo {
  id: 'classico' | 'quadro' | 'bilingue' | 'compacto';
  label: string;
  description: string;
}

/**
 * Modelos de moldura do sistema (ADR-019): o Supervisor escolhe um modelo, completa cidade, estado e contato, confere
 * a prévia e gera a máscara do tradutor. A moldura sai no idioma de cada tradução.
 */
export function FrameModelPicker({ translator, onCreated }: { translator: SwornTranslator; onCreated: (message: string) => void }) {
  const models = useLoad(() => api<{ items: FrameModelInfo[] }>('GET', '/frame-models'), []);
  const current = translator.mask?.frame ?? null;
  const [model, setModel] = useState<FrameModelInfo['id']>(current?.model ?? 'classico');
  const [form, setForm] = useState({
    city: current?.city ?? '',
    state: current?.state ?? '',
    contact: current?.contact ?? '',
    title: current?.title ?? '',
  });
  const [target, setTarget] = useState<Language>('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settled = useDebounced(JSON.stringify(form), 600);

  const preview = useMemo(() => {
    const values = JSON.parse(settled) as typeof form;
    const query = new URLSearchParams({
      name: translator.name,
      registration: translator.registration ?? 'Matrícula a informar',
      city: values.city || 'Cidade',
      state: values.state || 'UF',
      target,
      format: 'pdf',
      ...(values.contact ? { contact: values.contact } : {}),
    });
    return `/api/v1/frame-models/${model}/preview?${query}`;
  }, [model, settled, target, translator.name, translator.registration]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/sworn-translators/${translator.id}/masks/model`, {
        model,
        city: form.city.trim(),
        state: form.state.trim(),
        contact: form.contact.trim() || null,
        title: form.title.trim() || null,
      });
      onCreated(
        `Máscara gerada do modelo "${models.data?.items.find((item) => item.id === model)?.label}": as próximas conclusões usam essa edição.`,
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="frame-models" open={!translator.mask}>
      <summary>Usar um modelo de moldura do sistema</summary>
      <p className="muted small-text">
        Sem máscara própria, escolha um modelo: o timbre, a abertura, o encerramento, a numeração e o rodapé saem prontos, no idioma de cada
        tradução, com os dados deste tradutor.
      </p>
      <div className="mode-options" role="radiogroup" aria-label="Modelo de moldura">
        {models.data?.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={model === item.id}
            className={`mode-option ${model === item.id ? 'on' : ''}`}
            onClick={() => setModel(item.id)}
          >
            <strong>{item.label}</strong>
            <span className="muted small-text">{item.description}</span>
          </button>
        ))}
      </div>
      <div className="field-row top-gap frame-model-fields">
        <label>
          Cidade
          <input
            id={`frame-city-${translator.id}`}
            value={form.city}
            maxLength={80}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </label>
        <label>
          Estado
          <input
            id={`frame-state-${translator.id}`}
            value={form.state}
            maxLength={40}
            placeholder="SP, Paraná…"
            onChange={(e) => setForm({ ...form, state: e.target.value })}
          />
        </label>
        <label>
          Contato no timbre (opcional)
          <input
            id={`frame-contact-${translator.id}`}
            value={form.contact}
            maxLength={200}
            placeholder="Endereço, telefone, e-mail"
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
          />
        </label>
        <label>
          Título (opcional)
          <input
            id={`frame-title-${translator.id}`}
            value={form.title}
            maxLength={120}
            placeholder="Tradutor(a) Público(a) e Intérprete Comercial"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
      </div>
      <div className="word-head top-gap">
        <label className="inline">
          Prévia em
          <select value={target} onChange={(e) => setTarget(e.target.value as Language)}>
            {LANGUAGES.filter((language) => language !== 'pt').map((language) => (
              <option key={language} value={language}>
                {languageLabel[language]}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <a className="button small" href={preview.replace('format=pdf', 'format=docx')}>
            Baixar exemplo (Word)
          </a>
          <button
            className="primary small"
            disabled={busy || form.city.trim().length < 2 || form.state.trim().length < 2}
            onClick={() => void create()}
          >
            {busy ? 'Gerando…' : 'Gerar máscara com este modelo'}
          </button>
        </div>
      </div>
      <Feedback error={error} />
      <iframe key={preview} className="word-frame frame-preview" title="Prévia do modelo" src={preview} />
    </details>
  );
}
