import { useEffect, useMemo, useRef, useState } from 'react';
import { api, queryString, translationStatusLabel, type Page, type TranslationSummary } from './api';
import { Icon, type IconName } from './icons';
import {
  displayTitle,
  searchGroupNames,
  useSmartSearch,
  type DocumentsSearchTarget,
  type SearchGroup,
  type SmartSearchResult,
} from './SmartSearch';
import { LoadingHint, normalize } from './ui';

export interface PaletteEntry {
  label: string;
  hint: string;
  icon: IconName;
  /** Aparece antes de digitar; as demais telas só aparecem na pesquisa. */
  primary?: boolean;
  run: () => void;
}

interface Item extends PaletteEntry {
  key: string;
}

/**
 * Pesquisa global (Ctrl+K): telas do sistema, documentos e, para quem lidera, a pesquisa inteligente por protocolos,
 * fases, auditoria, relatórios e equipes. Setas navegam, Enter abre, Esc fecha.
 */
export function CommandPalette({
  open,
  onClose,
  entries,
  smart,
  onOpenTranslation,
  onOpenAudit,
  onOpenDocuments,
  onOpenTeam,
  onOpenReports,
}: {
  open: boolean;
  onClose: () => void;
  entries: PaletteEntry[];
  smart: boolean;
  onOpenTranslation: (id: string) => void;
  onOpenAudit: (q: string) => void;
  onOpenDocuments: (target: DocumentsSearchTarget) => void;
  onOpenTeam: (id: string) => void;
  onOpenReports: (q: string) => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const search = useSmartSearch(open ? q : '', smart);
  const [own, setOwn] = useState<TranslationSummary[]>([]);
  const [ownLoading, setOwnLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    const timer = setTimeout(() => input.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  // Quem não lidera pesquisa as próprias traduções pela lista.
  useEffect(() => {
    if (!open || smart || q.trim().length < 2) {
      setOwn([]);
      return;
    }
    let alive = true;
    setOwnLoading(true);
    const timer = setTimeout(() => {
      void api<Page<TranslationSummary>>('GET', `/translations${queryString({ q: q.trim(), limit: 6 })}`)
        .then((page) => alive && setOwn(page.items))
        .catch(() => alive && setOwn([]))
        .finally(() => alive && setOwnLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, smart, q]);

  const close = () => onClose();
  const go = (run: () => void) => () => {
    close();
    run();
  };

  const openResult = (item: SmartSearchResult) => {
    if (item.type === 'audit') onOpenAudit(item.id);
    else if (item.type === 'teams' && item.teamId) onOpenTeam(item.teamId);
    else if (item.type === 'reports') onOpenReports(item.title.replace(/^Relatório\s*·\s*/, ''));
    else if (item.type === 'protocols' || item.type === 'documents')
      onOpenDocuments(item.batchId ? { batchId: item.batchId } : { q: item.title });
    else if (item.translationId) onOpenTranslation(item.translationId);
  };

  const groups = useMemo(() => {
    const term = normalize(q.trim());
    const screens = term
      ? entries.filter((entry) => normalize(`${entry.label} ${entry.hint}`).includes(term))
      : entries.filter((entry) => entry.primary);
    const out: Array<{ label: string; items: Item[] }> = [];
    if (screens.length) out.push({ label: term ? 'Telas' : 'Ir para', items: screens.map((entry, i) => ({ ...entry, key: `nav-${i}` })) });
    if (smart && search.data) {
      for (const group of Object.keys(searchGroupNames) as SearchGroup[]) {
        const results = search.data.groups[group] ?? [];
        if (!results.length) continue;
        out.push({
          label: searchGroupNames[group],
          items: results.map((item) => ({
            key: `${group}-${item.id}`,
            label: displayTitle(item),
            hint: item.snippet,
            icon: group === 'audit' ? 'list' : group === 'teams' ? 'users' : group === 'reports' ? 'home' : 'doc',
            run: () => openResult(item),
          })),
        });
      }
    }
    if (!smart && own.length)
      out.push({
        label: 'Suas traduções',
        items: own.map((item) => ({
          key: `own-${item.id}`,
          label: `${item.batch.protocol ? `${item.batch.protocol} – ` : ''}${item.document.name}`,
          hint: translationStatusLabel[item.status],
          icon: 'doc',
          run: () => onOpenTranslation(item.id),
        })),
      });
    return out;
  }, [q, entries, smart, search.data, own]);

  const flat = groups.flatMap((group) => group.items);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const loading = smart ? search.loading : ownLoading;

  if (!open) return null;
  return (
    <>
      <div className="cmdk-backdrop" onClick={close} />
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Pesquisar">
        <div className="cmdk-input">
          <Icon name="search" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={flat.length ? `cmdk-${current}` : undefined}
            aria-label="Pesquisar documentos, protocolos e telas"
            placeholder={smart ? 'Pesquisar protocolos, documentos, pessoas, equipes e telas' : 'Pesquisar suas traduções e telas'}
            autoComplete="off"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive(flat.length ? (current + 1) % flat.length : 0);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(flat.length ? (current - 1 + flat.length) % flat.length : 0);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const item = flat[current];
                if (item) go(item.run)();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
          />
          {loading ? <LoadingHint text="Pesquisando" /> : <kbd>Esc</kbd>}
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Resultados">
          {groups.map((group) => (
            <div key={group.label} role="presentation">
              <span className="cmdk-group-label">{group.label}</span>
              {group.items.map((item) => {
                const index = flat.indexOf(item);
                return (
                  <button
                    key={item.key}
                    id={`cmdk-${index}`}
                    type="button"
                    role="option"
                    className="cmdk-item"
                    aria-selected={index === current}
                    onMouseMove={() => index !== current && setActive(index)}
                    onClick={go(item.run)}
                  >
                    <Icon name={item.icon} />
                    <span className="label">{item.label}</span>
                    <span className="hint">{item.hint}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {search.error && <p className="cmdk-empty error-text">{search.error}</p>}
          {!flat.length && !loading && (
            <p className="cmdk-empty">
              {q.trim().length === 1
                ? 'Digite pelo menos 2 caracteres.'
                : `Nada encontrado para “${q.trim()}”. Tente menos palavras ou outro protocolo.`}
            </p>
          )}
        </div>
        <div className="cmdk-foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>navegar
          </span>
          <span>
            <kbd>Enter</kbd>abrir
          </span>
          <span>
            <kbd>Esc</kbd>fechar
          </span>
          {smart && <span>Acentos e maiúsculas não alteram a busca</span>}
        </div>
      </div>
    </>
  );
}
