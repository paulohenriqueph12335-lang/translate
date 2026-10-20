import type { CSSProperties } from 'react';
import type { DraftBlock, DraftContent, PreviewFrame, TableRowData } from './api';

/**
 * Prévia do conteúdo da tradução como ele entra na máscara do tradutor (tabelas, alinhamentos e negritos). Timbre,
 * abertura, encerramento e numeração vêm da máscara escolhida na conclusão (ADR-012); a prévia completa sai em DOCX.
 * Com `onChange`, o texto de cada bloco e célula é editado direto na página; o original aparece ao passar o mouse.
 */
export function DocumentPreview({
  frame,
  draft,
  onChange,
  highlightUntranslated = false,
}: {
  frame: PreviewFrame;
  draft: DraftContent;
  onChange?: (draft: DraftContent) => void;
  highlightUntranslated?: boolean;
}) {
  const editable = !!onChange;
  const setBlock = (index: number, block: DraftBlock) =>
    onChange?.({ ...draft, blocks: draft.blocks.map((current, i) => (i === index ? block : current)) });
  const removeBlock = (index: number) => onChange?.({ ...draft, blocks: draft.blocks.filter((_, i) => i !== index) });

  return (
    <div className={`paper ${editable ? 'editing' : ''}`}>
      <p className="paper-mask-note">
        {frame.draftMark && <strong>{frame.draftMark}</strong>}
        <span>Timbre, abertura, encerramento, número e data entram pela máscara do tradutor escolhido na conclusão.</span>
      </p>
      <p className="gap">
        <strong>{frame.documentTypeLabel}:</strong>{' '}
        <Editable
          text={draft.documentType}
          placeholder="tipo do documento"
          editable={editable}
          onCommit={(documentType) => onChange?.({ ...draft, documentType: documentType.toUpperCase() })}
        />
      </p>

      {draft.blocks.map((block, index) => (
        <BlockView
          key={index}
          block={block}
          frame={frame}
          editable={editable}
          highlight={highlightUntranslated}
          onChange={(next) => setBlock(index, next)}
          onRemove={() => removeBlock(index)}
        />
      ))}
    </div>
  );
}

/** "texto **negrito** texto" em trechos, como no DOCX. */
function Runs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, index) =>
          part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
        )}
    </>
  );
}

/**
 * Texto editável no lugar. Na edição o negrito aparece como **marcação**, para não se perder;
 * a alteração vale ao sair do campo.
 */
function Editable({
  text,
  editable,
  onCommit,
  placeholder,
  source,
  highlight = false,
}: {
  text: string;
  editable: boolean;
  onCommit: (text: string) => void;
  placeholder?: string | undefined;
  source?: string | null;
  highlight?: boolean;
}) {
  const untranslated =
    highlight && !!source && /\p{L}{2}/u.test(source) && source.replace(/\s+/g, ' ').trim() === text.replace(/\s+/g, ' ').trim();
  const title = source && source !== text ? `Original: ${source}` : undefined;
  if (!editable) {
    return (
      <span className={untranslated ? 'untranslated' : undefined} title={untranslated ? 'Igual ao original: ainda não traduzido' : title}>
        {text ? <Runs text={text} /> : <span className="placeholder">{placeholder ?? '—'}</span>}
      </span>
    );
  }
  return (
    <span
      className={`editable ${untranslated ? 'untranslated' : ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={placeholder ?? 'Texto'}
      data-placeholder={placeholder}
      title={title}
      onBlur={(event) => {
        const next = event.currentTarget.innerText.replace(/\n+$/, '');
        if (next !== text) onCommit(next);
      }}
      onKeyDown={(event) => {
        // Enter confirma; Shift+Enter quebra a linha.
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >
      {text}
    </span>
  );
}

function BlockView({
  block,
  frame,
  editable,
  highlight,
  onChange,
  onRemove,
}: {
  block: DraftBlock;
  frame: PreviewFrame;
  editable: boolean;
  highlight: boolean;
  onChange: (block: DraftBlock) => void;
  onRemove: () => void;
}) {
  const remove = editable && (
    <button type="button" className="block-remove" title="Remover este trecho" aria-label="Remover este trecho" onClick={onRemove}>
      ×
    </button>
  );
  const text = (value: string, commit: (text: string) => void, placeholder?: string) => (
    <Editable
      text={value}
      editable={editable}
      onCommit={commit}
      source={block.sourceText}
      highlight={highlight}
      placeholder={placeholder}
    />
  );

  switch (block.kind) {
    case 'heading':
      return (
        <p className={`block bold ${block.align} ${block.level === 'title' ? 'large' : ''}`}>
          {text(block.text, (value) => onChange({ ...block, text: value, origin: 'human' }))}
          {remove}
        </p>
      );
    case 'paragraph':
      return (
        <p className={`block ${block.align} ${block.bold ? 'bold' : ''} ${block.size} ${block.align === 'center' ? '' : 'gap-sm'}`}>
          {text(block.text, (value) => onChange({ ...block, text: value, origin: 'human' }))}
          {remove}
        </p>
      );
    case 'section':
      return (
        <p className="block bold section">
          {text(block.text, (value) => onChange({ ...block, text: value, origin: 'human' }))}
          {remove}
        </p>
      );
    case 'translator_note':
      return (
        <p className="block justify italic gap-sm">
          {frame.translatorNote.prefix}
          {text(block.text, (value) => onChange({ ...block, text: value, origin: 'human' }), 'nota do tradutor')}
          {frame.translatorNote.suffix}
          {remove}
        </p>
      );
    case 'signature':
      return (
        <div className="block gap-sm">
          <p>{block.illegible ? frame.signatureMark.illegible : frame.signatureMark.legible}</p>
          <p>
            {text(block.name, (value) => onChange({ ...block, name: value, origin: 'human' }), 'nome')} –{' '}
            {text(block.role, (value) => onChange({ ...block, role: value, origin: 'human' }), 'cargo')}
          </p>
          {remove}
        </div>
      );
    case 'table':
      return (
        <div className="block table-block">
          <PreviewTable
            columns={block.columns}
            rows={block.rows}
            editable={editable}
            highlight={highlight}
            onChange={(rows) => onChange({ ...block, rows, origin: 'human' })}
          />
          {remove}
        </div>
      );
  }
}

function PreviewTable({
  columns,
  rows,
  editable,
  highlight,
  onChange,
}: {
  columns: number[];
  rows: TableRowData[];
  editable: boolean;
  highlight: boolean;
  onChange: (rows: TableRowData[]) => void;
}) {
  const total = columns.reduce((sum, width) => sum + width, 0) || 1;
  return (
    <table className="paper-table">
      <colgroup>
        {columns.map((width, index) => (
          <col key={index} style={{ width: `${(width / total) * 100}%` }} />
        ))}
      </colgroup>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className={row.style}>
            {row.cells.map((cell, cellIndex) => (
              <td
                key={cellIndex}
                colSpan={cell.colSpan}
                rowSpan={cell.rowSpan}
                style={{ textAlign: cell.align === 'justify' ? 'left' : cell.align } as CSSProperties}
                className={cell.bold || row.style !== 'normal' ? 'bold' : undefined}
              >
                <Editable
                  text={cell.text}
                  editable={editable}
                  highlight={highlight}
                  source={cell.sourceText ?? null}
                  onCommit={(value) =>
                    onChange(
                      rows.map((current, r) =>
                        r === rowIndex
                          ? { ...current, cells: current.cells.map((c, i) => (i === cellIndex ? { ...c, text: value } : c)) }
                          : current,
                      ),
                    )
                  }
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
