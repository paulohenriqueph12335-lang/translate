import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ArchiveDownloadButtons } from './ArchiveDownloadButtons';
import { canChooseSaveLocation, saveFile, type SaveRequest } from './save-file';
import { Feedback, LoadingHint, useLoad } from './ui';

export function SaveDownloadButton({
  url,
  name,
  mimeType,
  label = 'Salvar arquivo',
  className = 'small',
  extension,
  preferNative = true,
}: {
  url: string;
  name: string;
  mimeType: string;
  label?: string;
  className?: string;
  extension?: string;
  preferNative?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  async function save(chooseLocation = preferNative) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFeedback({});
    try {
      const request: SaveRequest = {
        url,
        suggestedName: name,
        mimeType,
        extension: extension ?? name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.docx',
        preferNative: chooseLocation,
      };
      const result = await saveFile(request);
      if (result.status !== 'cancelled')
        setFeedback({ ok: result.status === 'saved' ? `Arquivo salvo: ${result.name}` : `Download iniciado: ${result.name}` });
    } catch (caught) {
      setFeedback({ error: caught instanceof Error ? caught.message : 'Não foi possível salvar o arquivo.' });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="save-download doc-save-download">
      <button type="button" className={className} disabled={busy} onClick={() => void save()}>
        {busy ? 'Preparando…' : label}
      </button>
      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
      {feedback.error && (
        <button type="button" className="small ghost" disabled={busy} onClick={() => void save(false)}>
          Usar download padrão
        </button>
      )}
    </div>
  );
}
interface Manifest {
  version: number;
  revision: number | null;
  versionToken: string;
  formats: Array<{ format: 'docx' | 'pdf'; name: string; mimeType: string; downloadUrl: string }>;
}
export function FinalDelivery({ translationId, version, batchId }: { translationId: string; version?: string; batchId?: string }) {
  const [preferNative, setPreferNative] = useState(true);
  const manifest = useLoad(() => api<Manifest>('GET', `/translations/${translationId}/download-manifest`), [translationId, version]);
  return (
    <section className="card final-delivery doc-domain doc-module doc-final-delivery" aria-label="Arquivos concluídos">
      <h3>Tradução concluída</h3>
      <p className="muted small-text">O arquivo permanece disponível aqui. Escolha salvar agora ou volte quando precisar.</p>
      <Feedback error={manifest.error} />
      {!manifest.data && !manifest.error && (
        <p>
          <LoadingHint text="Carregando arquivos disponíveis" />
        </p>
      )}
      <button className="small ghost doc-delivery-refresh" onClick={manifest.reload}>
        Atualizar arquivos disponíveis
      </button>
      <div className="actions doc-delivery-actions">
        {manifest.data?.formats.map((file) => (
          <SaveDownloadButton
            key={`${file.format}-${manifest.data!.versionToken}`}
            url={file.downloadUrl}
            name={file.name}
            mimeType={file.mimeType}
            label={`Salvar ${file.format === 'docx' ? 'Word' : 'PDF'}`}
            className={`small ${file.format === 'docx' ? 'primary' : ''}`}
            preferNative={preferNative}
          />
        ))}
      </div>
      <details className="doc-delivery-options">
        <summary>Baixar em ZIP e opções de salvamento</summary>
        {canChooseSaveLocation() && (
          <label className="check">
            <input type="checkbox" checked={preferNative} onChange={(event) => setPreferNative(event.target.checked)} />
            Escolher nome e pasta ao salvar (desative para usar o download padrão)
          </label>
        )}
        <ArchiveDownloadButtons translationIds={[translationId]} preferNative={preferNative} />
        {batchId && (
          <>
            <h4>Todos os documentos concluídos deste envio</h4>
            <ArchiveDownloadButtons batchId={batchId} preferNative={preferNative} />
          </>
        )}
        <p className="muted small-text">
          {canChooseSaveLocation()
            ? 'Ao salvar, escolha o nome e a pasta no diálogo do sistema.'
            : 'Este navegador usa o download padrão. No Chrome ou Edge compatível, o botão abre a escolha de nome e pasta; em outros navegadores, ative “Perguntar onde salvar” nas configurações de downloads.'}
        </p>
      </details>
    </section>
  );
}

/** A lightweight entry point; manifests and previews are requested only when the user opens the files. */
export function DeliveryMenu({
  translationId,
  version,
  batchId,
  original,
}: {
  translationId: string;
  version?: string;
  batchId?: string;
  original?: { id: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  return (
    <>
      <button
        className="small primary"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        Salvar arquivos
      </button>
      <dialog
        ref={dialog}
        className="dashboard-dialog doc-delivery-dialog"
        aria-label="Salvar arquivos da tradução"
        onClick={(event) => event.stopPropagation()}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <button
          autoFocus
          className="small doc-dialog-close"
          onClick={() => {
            dialog.current?.close();
            setOpen(false);
          }}
        >
          Fechar arquivos
        </button>
        {open && (
          <>
            <FinalDelivery translationId={translationId} {...(version ? { version } : {})} {...(batchId ? { batchId } : {})} />
            {original && (
              <SaveDownloadButton
                url={`/api/v1/documents/${original.id}/original`}
                name={original.name}
                mimeType={
                  /\.pdf$/i.test(original.name)
                    ? 'application/pdf'
                    : /\.docx$/i.test(original.name)
                      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                      : 'application/octet-stream'
                }
                label="Salvar original"
              />
            )}
          </>
        )}
      </dialog>
    </>
  );
}
