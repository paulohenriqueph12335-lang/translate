import { useRef, useState } from 'react';
import { Icon } from './icons';
import { saveFile } from './save-file';
import { Feedback } from './ui';

export function ArchiveDownloadButtons({
  translationIds,
  batchId,
  disabled = false,
  preferNative = true,
  heading = false,
}: {
  translationIds?: string[];
  batchId?: string;
  disabled?: boolean;
  preferNative?: boolean;
  /** Nas listas: título e instrução de marcar os documentos antes de baixar. */
  heading?: boolean;
}) {
  const empty = !batchId && !translationIds?.length;
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const [lastFormat, setLastFormat] = useState<'docx' | 'pdf'>('docx');
  async function download(format: 'docx' | 'pdf', chooseLocation = preferNative) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback({});
    setLastFormat(format);
    try {
      const result = await saveFile({
        url: '/api/v1/translation-archives',
        suggestedName: `Traduções-${format === 'docx' ? 'Word' : 'PDF'}.zip`,
        mimeType: 'application/zip',
        extension: '.zip',
        preferNative: chooseLocation,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
          body: JSON.stringify({ ...(batchId ? { batchId } : { translationIds: [...(translationIds ?? [])] }), format }),
        },
      });
      if (result.status !== 'cancelled')
        setFeedback({ ok: result.status === 'saved' ? `ZIP salvo: ${result.name}` : `Download do ZIP iniciado: ${result.name}` });
    } catch (caught) {
      setFeedback({ error: caught instanceof Error ? caught.message : 'Não foi possível preparar o ZIP.' });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="archive-controls doc-archive-controls">
      {heading && (
        <p className="archive-heading">
          <strong>Baixar em lote (ZIP)</strong>{' '}
          <span className="muted">
            {empty
              ? 'Marque os documentos na lista para liberar o ZIP em Word ou em PDF.'
              : `${translationIds?.length ?? 0} documento(s) marcado(s): escolha o formato.`}
          </span>
        </p>
      )}
      <div className="actions">
        <button className="small" disabled={busy || disabled || empty} onClick={() => void download('docx')}>
          <Icon name="download" />
          {busy && lastFormat === 'docx' ? 'Preparando ZIP…' : 'ZIP em Word'}
        </button>
        <button className="small" disabled={busy || disabled || empty} onClick={() => void download('pdf')}>
          <Icon name="download" />
          {busy && lastFormat === 'pdf' ? 'Preparando ZIP…' : 'ZIP em PDF'}
        </button>
      </div>
      <small className="muted">
        Até 100 documentos, 50 MB por documento e 128 MB por ZIP. Pastas por protocolo, par de idiomas e formato.
      </small>
      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
      {feedback.error && (
        <button className="small ghost" disabled={busy} onClick={() => void download(lastFormat, false)}>
          Usar download padrão
        </button>
      )}
    </div>
  );
}
