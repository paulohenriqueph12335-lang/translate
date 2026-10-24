import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { api, ApiError, formatBytes, MASK_MARKERS, type MaskInspection, type SwornTranslator } from './api';
import { FrameModelPicker } from './FrameModels';
import { dateTime, Feedback, message, Section, useLoad } from './ui';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A máscara é sempre um Word (.docx); o servidor confere o conteúdo de novo. */
function wordFileError(name: string): string | null {
  if (/\.docx$/i.test(name)) return null;
  return /\.doc$/i.test(name)
    ? 'Arquivo .doc (Word antigo): abra no Word e use "Salvar como" → Documento do Word (.docx).'
    : 'A máscara precisa ser um arquivo Word (.docx).';
}

const uploadedMessage = (inspection: MaskInspection, edition: number) =>
  inspection.ok
    ? `Edição ${edition} guardada e em uso nas próximas conclusões.`
    : `Edição ${edition} guardada. Ela ainda aguarda configuração (marcadores) para ser usada nas conclusões.`;

/** Envia um arquivo binário (máscara em Word ou PDF de referência) com o nome e a observação nos cabeçalhos. */
async function sendFile(method: 'POST' | 'PUT', path: string, file: File, contentType: string, notes?: string) {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'X-CSRF-Protection': '1',
      'Content-Type': contentType,
      'X-File-Name': encodeURIComponent(file.name),
      ...(notes ? { 'X-Notes': encodeURIComponent(notes) } : {}),
    },
    credentials: 'same-origin',
    body: file,
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = data?.error;
    throw Object.assign(new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? 'Falha no envio'), {
      inspection: error?.details?.inspection as MaskInspection | undefined,
    });
  }
  return data;
}

type Draft = { name: string; registration: string; languages: string; notes: string };
const EMPTY: Draft = { name: '', registration: '', languages: '', notes: '' };
const toBody = (draft: Draft) => ({
  name: draft.name.trim(),
  registration: draft.registration.trim() || null,
  languages: draft.languages.trim() || null,
  notes: draft.notes.trim() || null,
});

/**
 * Tradutores juramentados (ADR-012): cada um com o seu armazenamento de máscaras em Word, enviadas pelo Supervisor e
 * guardadas em edições numeradas. A numeração de cada tradutor segue as regras programadas para ele no sistema.
 */
export function Translators({ canManage }: { canManage: boolean }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => api<{ items: SwornTranslator[] }>('GET', '/sworn-translators'), [version]);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const reload = () => setVersion((current) => current + 1);

  return (
    <div className="administration-view translators-view">
      <Section
        title="Tradutores juramentados"
        subtitle="Cada tradutor tem o seu armazenamento de máscaras em Word, enviadas pelo Supervisor em edições numeradas. Na conclusão, escolhe-se o tradutor."
      >
        {canManage && !creating && (
          <div className="filters">
            <button className="primary" onClick={() => setCreating(true)}>
              Cadastrar tradutor
            </button>
          </div>
        )}
        <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
        {creating && (
          <TranslatorForm
            initial={EMPTY}
            submitLabel="Cadastrar"
            withMask
            onCancel={() => setCreating(false)}
            onSubmit={async (draft, mask) => {
              const name = draft.name.trim();
              const { translator } = await api<{ translator: SwornTranslator }>('POST', '/sworn-translators', toBody(draft));
              setCreating(false);
              reload();
              if (!mask) {
                setFeedback({ ok: `${name} cadastrado. Agora envie a máscara em Word no cartão dele.` });
                return;
              }
              // O tradutor já existe; se a máscara falhar, ela pode ser reenviada no cartão dele.
              try {
                const result = await sendFile('POST', `/sworn-translators/${translator.id}/masks`, mask, DOCX_TYPE, 'Máscara inicial');
                setFeedback({ ok: `${name} cadastrado. ${uploadedMessage(result.inspection, result.edition)}` });
              } catch (caught) {
                setFeedback({
                  error: `${name} foi cadastrado, mas a máscara não foi enviada: ${message(caught)} Envie de novo no cartão dele.`,
                });
              } finally {
                reload();
              }
            }}
          />
        )}
        <MarkerGuide />
        <div className="translator-list">
          {data?.items.map((translator) => (
            <TranslatorCard key={translator.id} translator={translator} onChange={reload} />
          ))}
        </div>
        {data && data.items.length === 0 && (
          <p className="empty">
            Nenhum tradutor cadastrado. {canManage ? 'Cadastre o primeiro e envie a máscara dele.' : 'Peça a um Supervisor para cadastrar.'}
          </p>
        )}
      </Section>
    </div>
  );
}

function MarkerGuide() {
  return (
    <details className="card marker-guide">
      <summary>Como a máscara em Word é preenchida</summary>
      <p className="muted small-text">
        A máscara é o Word do tradutor (timbre, abertura, encerramento, assinatura e rodapé) com os marcadores abaixo, entre chaves duplas,
        onde cada informação deve entrar. O sistema troca só os marcadores: fontes, espaços, margens e diagramação ficam exatamente como
        estão. O documento traduzido entra no lugar de <code>{'{{texto}}'}</code>, com a fonte e o tamanho daquele parágrafo. Um marcador em
        maiúsculas, como <code>{'{{TRADUTOR}}'}</code>, sai em maiúsculas.
      </p>
      <table className="marker-table">
        <tbody>
          {MASK_MARKERS.map(([name, description]) => (
            <tr key={name}>
              <td>
                <code>{`{{${name}}}`}</code>
              </td>
              <td className="muted">{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function TranslatorCard({ translator, onChange }: { translator: SwornTranslator; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const [inspection, setInspection] = useState<MaskInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [dragging, setDragging] = useState(false);
  const maskInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const canEdit = translator.permissions.edit;

  async function uploadMask(file: File) {
    setFeedback({});
    setInspection(null);
    const invalid = wordFileError(file.name);
    if (invalid) {
      setFeedback({ error: invalid });
      return;
    }
    setBusy(true);
    try {
      const result = await sendFile('POST', `/sworn-translators/${translator.id}/masks`, file, DOCX_TYPE, notes.trim());
      setInspection(result.inspection);
      setNotes('');
      setFeedback({ ok: uploadedMessage(result.inspection, result.edition) });
      onChange();
    } catch (caught) {
      setInspection((caught as { inspection?: MaskInspection }).inspection ?? null);
      setFeedback({ error: message(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf(file: File) {
    setBusy(true);
    setFeedback({});
    try {
      await sendFile('PUT', `/sworn-translators/${translator.id}/reference-pdf`, file, 'application/pdf');
      setFeedback({ ok: 'PDF de referência guardado.' });
      onChange();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    } finally {
      setBusy(false);
    }
  }

  async function use(maskId: string, edition: number) {
    try {
      await api('POST', `/sworn-translators/${translator.id}/masks/${maskId}/use`);
      setFeedback({ ok: `As próximas conclusões usam a edição ${edition}.` });
      onChange();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && canEdit && !busy) void uploadMask(file);
  };

  return (
    <article className={`card translator-card ${translator.active ? '' : 'inactive'}`}>
      <header className="translator-heading">
        <div>
          <h3 className="translator-status">
            <span className="translator-name">{translator.name}</span> {!translator.active && <span className="badge soft">Inativo</span>}
            {translator.active &&
              (translator.ready ? (
                <span className="badge">Pronto para concluir</span>
              ) : (
                <span className="badge warn">{translator.mask ? 'Máscara aguardando configuração' : 'Falta a máscara'}</span>
              ))}
          </h3>
          <p className="muted small-text">
            {[translator.registration, translator.languages].filter(Boolean).join(' · ') || 'Sem matrícula informada'} ·{' '}
            {translator.translations} tradução(ões) concluída(s) · alterado por {translator.updatedBy} em {dateTime(translator.updatedAt)}
          </p>
          {translator.notes && <p className="muted small-text">{translator.notes}</p>}
        </div>
        {canEdit && !editing && (
          <div className="actions">
            <button className="small" onClick={() => setEditing(true)}>
              Editar
            </button>
            <button
              className="small"
              onClick={() =>
                api('PATCH', `/sworn-translators/${translator.id}`, { active: !translator.active })
                  .then(onChange)
                  .catch((caught: unknown) => setFeedback({ error: message(caught) }))
              }
            >
              {translator.active ? 'Desativar' : 'Reativar'}
            </button>
          </div>
        )}
      </header>

      {editing && (
        <TranslatorForm
          initial={{
            name: translator.name,
            registration: translator.registration ?? '',
            languages: translator.languages ?? '',
            notes: translator.notes ?? '',
          }}
          submitLabel="Salvar"
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            await api('PATCH', `/sworn-translators/${translator.id}`, toBody(draft));
            setEditing(false);
            onChange();
          }}
        />
      )}

      <section className="mask-storage">
        <div className="mask-storage-head">
          <strong>Máscaras</strong>
          <span className="muted small-text">
            {translator.masks.length ? `${translator.masks.length} edição(ões) guardada(s)` : 'Nenhuma máscara enviada'}
          </span>
        </div>
        {canEdit && (
          <div
            className={`dropzone mask-drop ${dragging ? 'over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <strong>{busy ? 'Enviando…' : 'Arraste o Word da máscara aqui'}</strong>
            <span className="muted small-text">
              Somente Word (.docx). Cada envio vira uma nova edição numerada e passa a valer nas próximas conclusões; sem os marcadores,
              fica guardada aguardando configuração.
            </span>
            <div className="mask-drop-actions">
              <input
                placeholder="O que mudou nesta edição (opcional)"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button className="small primary" disabled={busy} onClick={() => maskInput.current?.click()}>
                Escolher arquivo .docx
              </button>
            </div>
          </div>
        )}
        {canEdit && (
          <FrameModelPicker
            translator={translator}
            onCreated={(text) => {
              setFeedback({ ok: text });
              onChange();
            }}
          />
        )}
        {translator.masks.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Edição</th>
                  <th>Arquivo</th>
                  <th>Enviada</th>
                  <th>Traduções</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {translator.masks.map((mask) => (
                  <tr key={mask.id} className={mask.current ? 'current-row' : ''}>
                    <td className="nowrap">
                      <strong>{mask.edition}</strong> {mask.current && <span className="badge">Em uso</span>}
                      <span className={`badge ${mask.configured ? 'soft' : 'warn'} block-line`}>
                        {mask.configured ? 'Configurada' : 'Aguardando configuração'}
                      </span>
                    </td>
                    <td className="name-cell">
                      {mask.name} <span className="muted small-text">· {formatBytes(mask.size)}</span>
                      {mask.notes && <span className="muted small-text block-line">{mask.notes}</span>}
                      {!mask.configured &&
                        mask.issues.map((issue) => (
                          <span key={issue} className="warn-text small-text block-line">
                            {issue}
                          </span>
                        ))}
                      <span className="marker-chips">
                        {mask.markers.map((marker) => (
                          <code key={marker}>{`{{${marker}}}`}</code>
                        ))}
                      </span>
                    </td>
                    <td className="nowrap">
                      {dateTime(mask.uploadedAt)}
                      <span className="muted small-text block-line">{mask.uploadedBy}</span>
                    </td>
                    <td>{mask.translations}</td>
                    <td className="actions">
                      {translator.permissions.download && (
                        <a className="button small" href={`/api/v1/sworn-translators/${translator.id}/masks/${mask.id}`}>
                          Baixar
                        </a>
                      )}
                      {canEdit && !mask.current && (
                        <button className="small" onClick={() => void use(mask.id, mask.edition)}>
                          Usar esta
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="reference-pdf">
        <strong className="small-text">PDF do tradutor (referência)</strong>{' '}
        {translator.referencePdf ? (
          <span className="small-text">
            {translator.permissions.download ? (
              <a href={`/api/v1/sworn-translators/${translator.id}/reference-pdf`} target="_blank" rel="noreferrer">
                {translator.referencePdf.name}
              </a>
            ) : (
              translator.referencePdf.name
            )}{' '}
            <span className="muted">· {formatBytes(translator.referencePdf.size)}</span>
          </span>
        ) : (
          <span className="muted small-text">opcional, para conferir a máscara</span>
        )}{' '}
        {canEdit && (
          <button className="small ghost" disabled={busy} onClick={() => pdfInput.current?.click()}>
            {translator.referencePdf ? 'Trocar PDF' : 'Enviar PDF'}
          </button>
        )}
      </div>

      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
      {/* Os erros já vêm na mensagem acima; aqui ficam os avisos da conferência da máscara. */}
      {inspection && inspection.warnings.length > 0 && (
        <ul className="inspection">
          {inspection.warnings.map((text) => (
            <li key={text} className="muted">
              {text}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={maskInput}
        type="file"
        hidden
        accept={`.docx,${DOCX_TYPE}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadMask(file);
          e.target.value = '';
        }}
      />
      <input
        ref={pdfInput}
        type="file"
        hidden
        accept=".pdf,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadPdf(file);
          e.target.value = '';
        }}
      />
    </article>
  );
}

function TranslatorForm({
  initial,
  submitLabel,
  withMask = false,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  /** Mostra o campo de upload da máscara em Word (no cadastro; depois, as edições ficam no cartão do tradutor). */
  withMask?: boolean;
  onSubmit: (draft: Draft, mask: File | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [mask, setMask] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(draft, mask);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card translator-form" onSubmit={submit}>
      <label>
        Nome completo
        <input required minLength={3} maxLength={160} {...field('name')} />
      </label>
      <div className="field-row">
        <label>
          Matrícula
          <input maxLength={240} placeholder="Ex.: JUCESP nº 0000" {...field('registration')} />
        </label>
        <label>
          Idiomas
          <input maxLength={120} placeholder="Ex.: Inglês" {...field('languages')} />
        </label>
      </div>
      <label>
        Observações
        <textarea rows={2} maxLength={2000} {...field('notes')} />
      </label>
      {withMask && (
        <label>
          Máscara em Word (.docx)
          <input
            type="file"
            accept={`.docx,${DOCX_TYPE}`}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              const invalid = file && wordFileError(file.name);
              setError(invalid || null);
              setMask(invalid ? null : file);
              if (invalid) e.target.value = '';
            }}
          />
          <span className="muted small-text">
            Vira a edição 1 da máscara deste tradutor. Pode ficar para depois: as próximas edições são enviadas no cartão dele.
          </span>
        </label>
      )}
      <Feedback error={error} />
      <div className="actions">
        <button className="primary" disabled={busy}>
          {busy ? 'Salvando…' : submitLabel}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
