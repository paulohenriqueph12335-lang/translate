import { useEffect, useMemo, useState } from 'react';
import { api, queryString, type SwornTranslator, type Team, type TeamMember } from './api';
import { dateTime, Feedback, message, SearchInput, Segmented, useDebounced, useLoad } from './ui';
import { useConfirm } from './ConfirmDialog';

/** Regras de numeração por tradutor (ADR-014): painel e administração do Supervisor, preenchimento do usuário. */

type Scheme = 'free_text' | 'prefixed' | 'book_sheet' | 'stock' | 'reusable_stock';

export interface NumberingConfig {
  limit?: number | null;
  alertRemaining?: number | null;
  prefix?: string | null;
  protocolValue?: number | null;
  translatorFee?: number | null;
  subscriptionCap?: number | null;
  subscriptionSince?: string | null;
  sheetLimit?: number | null;
  recordPages?: boolean;
  maxUses?: number;
  languages?: string[];
  requiresMedium?: boolean;
  reminder?: string | null;
  freePages?: number | null;
  pricePerExtraPage?: number | null;
}

interface Rule {
  translatorId: string;
  translatorName: string;
  scheme: Scheme;
  schemeLabel: string;
  config: NumberingConfig;
}

interface Anomaly {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

interface Check {
  anomalies: Anomaly[];
  computed: {
    number: string | null;
    book: string | null;
    sheetStart: number | null;
    sheetEnd: number | null;
    pages: number | null;
    free: boolean;
    protocolValue: number | null;
    translatorFee: number | null;
    pageCharge: number | null;
  };
}

interface Entry {
  translatorId: string;
  translatorName: string;
  number: string | null;
  book: string | null;
  sheetStart: number | null;
  sheetEnd: number | null;
  pages: number | null;
  protocol: string | null;
  medium: 'digital' | 'impresso' | null;
  language: string | null;
  free: boolean;
  protocolValue: number | null;
  translatorFee: number | null;
  zeroProtocolAuthorizedBy: string | null;
  status: 'draft' | 'issued' | 'void';
  enteredBy: string;
  updatedAt: string;
}

interface DashboardItem {
  id: string;
  name: string;
  active: boolean;
  scheme: Scheme;
  schemeLabel: string;
  limit: number | null;
  issued: number;
  remaining: number | null;
  drafts: number;
  anomalies: number;
  last30: number;
  alertRemaining: number | null;
  low: boolean;
  locked: boolean;
  lots: Array<{
    language: string | null;
    free: boolean;
    numbers: number;
    uses: number;
    capacity: number;
    available: number;
    reserved: number;
    blocked: number;
  }>;
  book: { book: string; nextNumber: number; nextSheet: number; sheetsLeft: number | null; sheetLimit: number | null } | null;
  queuedBooks: Array<{ book: string; nextNumber: number }>;
  subscription: { paid: number; cap: number; free: boolean } | null;
}

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value.replace(',', '.')));

// ---------- Painel do Supervisor ----------

/** Uso de números e gratuitos de cada tradutor; `compact` para o painel da equipe. */
export function TranslatorNumberingDashboard({
  compact = false,
  onManage,
}: {
  compact?: boolean;
  onManage?: ((id: string) => void) | undefined;
}) {
  const { data, error } = useLoad(() => api<{ items: DashboardItem[] }>('GET', '/numbering/translators'), []);
  const items = (data?.items ?? []).filter((item) => item.active);
  if (error) return <Feedback error={error} />;
  if (!data) return <p className="muted">Carregando…</p>;
  if (!items.length) return <p className="empty">Nenhum tradutor ativo cadastrado.</p>;
  return (
    <div className={`numbering-grid ${compact ? 'compact' : ''}`}>
      {items.map((item) => (
        <article key={item.id} className={`card numbering-card ${item.locked ? 'locked' : item.low ? 'low' : ''}`}>
          <header>
            <strong>{item.name}</strong>
            {item.locked ? <span className="badge danger">Travado</span> : item.low ? <span className="badge warn">Acabando</span> : null}
            {item.anomalies > 0 && <span className="badge warn">{item.anomalies} com problema</span>}
          </header>
          {!compact && <p className="muted small-text">{item.schemeLabel}</p>}
          <div className="numbering-stats">
            <span>
              <strong>{item.issued}</strong> emitidos
            </span>
            <span>
              <strong>{item.last30}</strong> em 30 dias
            </span>
            {item.remaining !== null && (
              <span>
                <strong>{item.remaining}</strong> do limite ({item.limit})
              </span>
            )}
            {item.drafts > 0 && (
              <span>
                <strong>{item.drafts}</strong> em preenchimento
              </span>
            )}
          </div>
          {item.book && (
            <UsageBar
              label={`Livro ${item.book.book}: próxima tradução ${item.book.nextNumber}, folha ${item.book.nextSheet}`}
              used={(item.book.sheetLimit ?? 0) - (item.book.sheetsLeft ?? 0)}
              total={item.book.sheetLimit ?? 0}
              hint={`${item.book.sheetsLeft ?? '—'} folhas restantes · ${item.queuedBooks.length ? `próximo: livro ${item.queuedBooks[0]!.book}` : 'sem próximo livro'}`}
            />
          )}
          {item.scheme === 'book_sheet' && !item.book && (
            <p className="alert warn-box small-text">Nenhum livro em uso: cadastre o livro e o número inicial.</p>
          )}
          {item.lots.map((lot) => (
            <UsageBar
              key={`${lot.language}-${lot.free}`}
              label={`${lot.free ? 'Gratuitos' : 'Números'}${lot.language ? ` · ${lot.language}` : ''}: ${lot.numbers}`}
              used={lot.capacity - lot.available}
              total={lot.capacity}
              hint={`${lot.available} de ${lot.capacity} usos disponíveis${lot.reserved ? ` · ${lot.reserved} reservados` : ''}${lot.blocked ? ` · ${lot.blocked} bloqueados` : ''}`}
            />
          ))}
          {item.subscription && (
            <UsageBar
              label={`Assinatura: ${money(item.subscription.paid)} de ${money(item.subscription.cap)}`}
              used={Math.min(item.subscription.paid, item.subscription.cap)}
              total={item.subscription.cap}
              hint={
                item.subscription.free
                  ? 'Teto atingido: assinatura gratuita'
                  : `Faltam ${money(item.subscription.cap - item.subscription.paid)}`
              }
            />
          )}
          {onManage && (
            <button className="small" onClick={() => onManage(item.id)}>
              Administrar
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function UsageBar({ label, used, total, hint }: { label: string; used: number; total: number; hint: string }) {
  const share = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="usage">
      <span className="small-text">{label}</span>
      <span className="meter" aria-label={`${share}% usado`}>
        <span className={share >= 90 ? 'danger' : share >= 75 ? 'warn' : ''} style={{ width: `${share}%` }} />
      </span>
      <span className="muted small-text">{hint}</span>
    </div>
  );
}

// ---------- Administração por tradutor ----------

export function TranslatorNumberingAdmin({ translatorId, onBack }: { translatorId: string; onBack: () => void }) {
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((current) => current + 1);
  const { data, error } = useLoad(
    () =>
      api<{ rule: Rule; presets?: Record<string, { scheme: Scheme; config: NumberingConfig; description: string }> }>(
        'GET',
        `/sworn-translators/${translatorId}/numbering`,
      ),
    [translatorId, version],
  );
  if (!data) return error ? <Feedback error={error} /> : <p className="muted">Carregando…</p>;
  return (
    <div className="stack numbering-admin administration-view">
      <button className="ghost small" onClick={onBack}>
        ← Todos os tradutores
      </button>
      <h3>{data.rule.translatorName}</h3>
      <RuleEditor rule={data.rule} presets={data.presets ?? {}} onSaved={reload} />
      {data.rule.scheme === 'book_sheet' && <Books translatorId={translatorId} />}
      {data.rule.scheme !== 'book_sheet' && <Stock rule={data.rule} version={version} onChange={reload} />}
    </div>
  );
}

const SCHEME_OPTIONS: Array<[Scheme, string]> = [
  ['free_text', 'Livre (digitado, sem repetir)'],
  ['prefixed', 'Sigla + ano + número, com protocolo e assinatura'],
  ['book_sheet', 'Número, livro e folha automáticos (limite de folhas)'],
  ['stock', 'Números da planilha, uso único'],
  ['reusable_stock', 'Números da planilha por idioma, até 2 usos'],
];

function RuleEditor({
  rule,
  presets,
  onSaved,
}: {
  rule: Rule;
  presets: Record<string, { scheme: Scheme; config: NumberingConfig; description: string }>;
  onSaved: () => void;
}) {
  const [scheme, setScheme] = useState<Scheme>(rule.scheme);
  const [config, setConfig] = useState<NumberingConfig>(rule.config);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  useEffect(() => {
    setScheme(rule.scheme);
    setConfig(rule.config);
  }, [rule]);
  const set = <K extends keyof NumberingConfig>(key: K, value: NumberingConfig[K]) =>
    setConfig((current) => ({ ...current, [key]: value }));
  const num = (key: keyof NumberingConfig, label: string, hint?: string) => (
    <label>
      {label}
      <input
        inputMode="decimal"
        value={(config[key] as number | null | undefined) ?? ''}
        onChange={(e) => set(key, numberOrNull(e.target.value) as never)}
      />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
  const check = (key: keyof NumberingConfig, label: string) => (
    <label className="check">
      <input type="checkbox" checked={config[key] === true} onChange={(e) => set(key, e.target.checked as never)} />
      {label}
    </label>
  );

  async function save() {
    try {
      // Campos vazios saem: o servidor só guarda o que foi definido.
      const clean = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== null && value !== undefined && value !== ''));
      await api('PUT', `/sworn-translators/${rule.translatorId}/numbering`, { scheme, config: clean });
      setFeedback({ ok: 'Regra salva: vale para as próximas numerações.' });
      onSaved();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <div className="card stack numbering-rule">
      <h4>Regra de numeração</h4>
      {Object.keys(presets).length > 0 && (
        <div className="filters">
          <span className="muted small-text">Partir de uma regra pronta:</span>
          {Object.entries(presets).map(([key, preset]) => (
            <button
              key={key}
              className="small"
              title={preset.description}
              onClick={() => {
                setScheme(preset.scheme);
                setConfig(preset.config);
              }}
            >
              {key[0]!.toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
      )}
      <label>
        Como numerar
        <select value={scheme} onChange={(e) => setScheme(e.target.value as Scheme)}>
          {SCHEME_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        {num('limit', 'Limite de números', 'Ninguém emite além disso; vazio = sem limite')}
        {num('alertRemaining', 'Avisar quando restarem', 'Números, usos ou folhas')}
      </div>
      {scheme === 'prefixed' && (
        <div className="field-row">
          <label>
            Sigla
            <input value={config.prefix ?? ''} maxLength={10} onChange={(e) => set('prefix', e.target.value.toUpperCase() || null)} />
            <small className="muted">Formato: {(config.prefix || 'NB').toUpperCase()}-2026-1111</small>
          </label>
          {num('protocolValue', 'Valor padrão do protocolo (R$)')}
          {num('translatorFee', 'Valor padrão da assinatura (R$)')}
          {num('subscriptionCap', 'Assinatura gratuita após (R$)', 'Total pago a partir do qual a assinatura é gratuita')}
          <label>
            Somar assinaturas desde
            <input type="date" value={config.subscriptionSince ?? ''} onChange={(e) => set('subscriptionSince', e.target.value || null)} />
          </label>
        </div>
      )}
      {scheme === 'book_sheet' && <div className="field-row">{num('sheetLimit', 'Folhas por livro', 'Ex.: 400 ou 500')}</div>}
      {scheme === 'reusable_stock' && (
        <div className="field-row">
          {num('maxUses', 'Usos por número', 'Nunca no mesmo protocolo')}
          <label>
            Idiomas
            <input
              value={(config.languages ?? []).join(', ')}
              placeholder="Francês, Italiano"
              onChange={(e) =>
                set(
                  'languages',
                  e.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
        </div>
      )}
      <div className="field-row">
        {check('recordPages', 'Pedir o número de páginas (laudas)')}
        {check('requiresMedium', 'Pedir se é digital ou impresso')}
      </div>
      {config.recordPages && (
        <div className="field-row">
          {num('freePages', 'Páginas gratuitas')}
          {num('pricePerExtraPage', 'Preço por página extra (R$)')}
        </div>
      )}
      <label>
        Lembrete na conclusão
        <input
          value={config.reminder ?? ''}
          maxLength={500}
          placeholder="Ex.: enviar por e-mail para a equipe responsável"
          onChange={(e) => set('reminder', e.target.value || null)}
        />
      </label>
      <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
      <div className="actions">
        <button className="primary" onClick={() => void save()}>
          Salvar regra
        </button>
      </div>
    </div>
  );
}

interface StockItem {
  id: string;
  number: string;
  book: string | null;
  language: string | null;
  free: boolean;
  maxUses: number;
  uses: number;
  protocols: string[];
  status: 'available' | 'reserved' | 'blocked';
  reservedFor: { id: string; name: string | null } | null;
  notifyOnUse: boolean;
}

function Stock({ rule, version, onChange }: { rule: Rule; version: number; onChange: () => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [status, setStatus] = useState('');
  const [usage, setUsage] = useState('');
  const [language, setLanguage] = useState('');
  const [free, setFree] = useState('');
  const [page, setPage] = useState(0);
  const [local, setLocal] = useState(0);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const people = usePeople();
  const path = `/sworn-translators/${rule.translatorId}/numbering/stock${queryString({ q, status, usage, language: language || undefined, free, limit: 100, offset: page * 100 })}`;
  const { data, error } = useLoad(() => api<{ items: StockItem[]; hasMore: boolean }>('GET', path), [path, version, local]);
  const languages = rule.config.languages ?? [];

  async function act(item: StockItem, body: Record<string, unknown>, label: string) {
    try {
      await api('PATCH', `/numbering-stock/${item.id}`, body);
      setFeedback({ ok: label });
      setLocal((current) => current + 1);
      onChange();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <div className="card stack numbering-stock">
      <h4>Números (planilhas)</h4>
      <StockImport rule={rule} onImported={(text) => (setFeedback({ ok: text }), setLocal((current) => current + 1), onChange())} />
      <div className="filters">
        <SearchInput value={search} onChange={(value) => (setSearch(value), setPage(0))} placeholder="Buscar número" />
        <select aria-label="Situação" value={status} onChange={(e) => (setStatus(e.target.value), setPage(0))}>
          <option value="">Todas as situações</option>
          <option value="available">Disponíveis</option>
          <option value="reserved">Reservados</option>
          <option value="blocked">Bloqueados</option>
        </select>
        <select aria-label="Uso" value={usage} onChange={(e) => (setUsage(e.target.value), setPage(0))}>
          <option value="">Usados ou não</option>
          <option value="unused">Nunca usados</option>
          <option value="used">Já usados</option>
          <option value="exhausted">Esgotados</option>
        </select>
        {languages.length > 0 && (
          <select aria-label="Idioma" value={language} onChange={(e) => (setLanguage(e.target.value), setPage(0))}>
            <option value="">Todos os idiomas</option>
            {languages.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Lote" value={free} onChange={(e) => (setFree(e.target.value), setPage(0))}>
          <option value="">Pagos e gratuitos</option>
          <option value="false">Pagos</option>
          <option value="true">Gratuitos</option>
        </select>
      </div>
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Livro</th>
              {languages.length > 0 && <th>Idioma</th>}
              <th>Lote</th>
              <th>Usos</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <code>{item.number}</code>
                </td>
                <td>{item.book ?? '—'}</td>
                {languages.length > 0 && <td>{item.language ?? '—'}</td>}
                <td>{item.free ? <span className="badge">Gratuito</span> : 'Pago'}</td>
                <td title={item.protocols.length ? `Protocolos: ${item.protocols.join(', ')}` : undefined}>
                  {item.uses}/{item.maxUses}
                </td>
                <td>
                  {item.status === 'blocked' ? (
                    <span className="badge danger">Bloqueado</span>
                  ) : item.status === 'reserved' ? (
                    <span className="badge info">Reservado: {item.reservedFor?.name}</span>
                  ) : (
                    <span className="badge soft">Disponível</span>
                  )}
                  {item.notifyOnUse && <span className="badge soft">Avisar ao usar</span>}
                </td>
                <td className="actions">
                  {item.status !== 'blocked' ? (
                    <button className="small" onClick={() => void act(item, { status: 'blocked' }, `Nº ${item.number} bloqueado.`)}>
                      Bloquear
                    </button>
                  ) : (
                    <button className="small" onClick={() => void act(item, { status: 'available' }, `Nº ${item.number} liberado.`)}>
                      Liberar
                    </button>
                  )}
                  <select
                    className="small"
                    aria-label="Reservar para"
                    value={item.reservedFor?.id ?? ''}
                    onChange={(e) =>
                      void act(
                        item,
                        e.target.value ? { status: 'reserved', reservedFor: e.target.value } : { status: 'available' },
                        e.target.value ? `Nº ${item.number} reservado.` : `Reserva do nº ${item.number} retirada.`,
                      )
                    }
                  >
                    <option value="">Reservar para…</option>
                    {people.map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    className="small ghost"
                    onClick={() =>
                      void act(
                        item,
                        { notifyOnUse: !item.notifyOnUse },
                        item.notifyOnUse ? 'Aviso retirado.' : 'Você será avisado quando este número for usado.',
                      )
                    }
                  >
                    {item.notifyOnUse ? 'Não avisar' : 'Avisar ao usar'}
                  </button>
                  {item.uses === 0 && (
                    <button
                      className="small danger"
                      onClick={() =>
                        window.confirm(`Excluir o nº ${item.number}?`) &&
                        api('DELETE', `/numbering-stock/${item.id}`)
                          .then(() => (setLocal((current) => current + 1), onChange()))
                          .catch((caught: unknown) => setFeedback({ error: message(caught) }))
                      }
                    >
                      Excluir
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.items.length === 0 && (
        <p className="empty">Nenhum número {q || status || usage || free ? 'corresponde aos filtros' : 'cadastrado: envie a planilha'}.</p>
      )}
      <div className="actions">
        {page > 0 && (
          <button className="ghost small" onClick={() => setPage(page - 1)}>
            ← Anteriores
          </button>
        )}
        {data?.hasMore && (
          <button className="ghost small" onClick={() => setPage(page + 1)}>
            Próximos →
          </button>
        )}
      </div>
    </div>
  );
}

/** Pessoas das equipes que o Supervisor lidera, para reservar números. */
function usePeople() {
  const teams = useLoad(() => api<{ items: Team[] }>('GET', '/teams'), []);
  const [people, setPeople] = useState<TeamMember[]>([]);
  useEffect(() => {
    const led = (teams.data?.items ?? []).filter((team) => team.myRole === 'leader');
    void Promise.all(led.map((team) => api<{ items: TeamMember[] }>('GET', `/teams/${team.id}/members`).then((result) => result.items)))
      .then((lists) => {
        const unique = new Map(lists.flat().map((member) => [member.userId, member]));
        setPeople([...unique.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)));
      })
      .catch(() => setPeople([]));
  }, [teams.data]);
  return people;
}

function StockImport({ rule, onImported }: { rule: Rule; onImported: (message: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('');
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Array<{ line: number; message: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const languages = rule.config.languages ?? [];

  async function send() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const result = await api<{ read: number; imported: number; problems: Array<{ line: number; message: string }> }>(
        'POST',
        `/sworn-translators/${rule.translatorId}/numbering/stock`,
        { fileName: file.name, text, ...(language ? { language } : {}), free },
      );
      setProblems(result.problems);
      setFile(null);
      onImported(
        `${result.imported} de ${result.read} número(s) importado(s)${result.problems.length ? `; ${result.problems.length} linha(s) não entraram` : ''}.`,
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-box">
      <p className="muted small-text">
        Planilha CSV (salve no Excel como "CSV"): colunas <code>número</code> e, se houver, <code>livro</code>, <code>idioma</code> e{' '}
        <code>gratuito</code> (sim/não). Sem cabeçalho, a 1ª coluna é o número e a 2ª, o livro.
      </p>
      <div className="filters">
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {languages.length > 0 && (
          <select aria-label="Idioma da planilha" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Idioma pela coluna da planilha</option>
            {languages.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
          Lote gratuito
        </label>
        <button className="primary small" disabled={!file || busy} onClick={() => void send()}>
          {busy ? 'Importando…' : 'Importar planilha'}
        </button>
      </div>
      <Feedback error={error} />
      {problems.length > 0 && (
        <details className="checks">
          <summary>{problems.length} linha(s) não entraram</summary>
          <ul>
            {problems.slice(0, 50).map((problem, index) => (
              <li key={index} className="muted">
                {problem.line ? `Linha ${problem.line}: ` : ''}
                {problem.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

interface BookItem {
  id: string;
  position: number;
  book: string;
  nextNumber: number;
  nextSheet: number;
  status: 'queued' | 'current' | 'closed';
  sheetsLeft: number | null;
  startedAt: string | null;
  closedAt: string | null;
}

function Books({ translatorId }: { translatorId: string }) {
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(
    () => api<{ sheetLimit: number | null; items: BookItem[] }>('GET', `/sworn-translators/${translatorId}/numbering/books`),
    [translatorId, version],
  );
  const [form, setForm] = useState({ book: '', nextNumber: '', nextSheet: '1' });
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const current = data?.items.find((item) => item.status === 'current');
  const queued = data?.items.filter((item) => item.status === 'queued') ?? [];

  async function add() {
    try {
      await api('POST', `/sworn-translators/${translatorId}/numbering/books`, {
        book: form.book.trim(),
        nextNumber: Number(form.nextNumber),
        nextSheet: Number(form.nextSheet || '1'),
      });
      setForm({ book: '', nextNumber: '', nextSheet: '1' });
      setFeedback({
        ok: current ? 'Próximo livro cadastrado: entra sozinho quando o atual chegar ao limite.' : 'Livro cadastrado e em uso.',
      });
      setVersion((value) => value + 1);
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <div className="card stack numbering-books">
      <h4>Livros (limite de {data?.sheetLimit ?? '—'} folhas)</h4>
      {current ? (
        <p>
          Em uso: <strong>livro {current.book}</strong> · próxima tradução <strong>{current.nextNumber}</strong> · próxima folha{' '}
          <strong>{current.nextSheet}</strong> · {current.sheetsLeft ?? '—'} folhas restantes
        </p>
      ) : (
        <p className="alert warn-box">Nenhum livro em uso: cadastre o primeiro livro e o número inicial da tradução.</p>
      )}
      {current && !queued.length && (
        <p className="alert warn-box small-text">
          Sem próximo livro cadastrado. Quando o livro {current.book} chegar a {data?.sheetLimit} folhas, a numeração deste tradutor trava.
        </p>
      )}
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      <div className="field-row">
        <label>
          {current ? 'Próximo livro' : 'Livro'}
          <input value={form.book} maxLength={40} onChange={(e) => setForm({ ...form, book: e.target.value })} />
        </label>
        <label>
          Primeiro nº de tradução
          <input
            inputMode="numeric"
            value={form.nextNumber}
            onChange={(e) => setForm({ ...form, nextNumber: e.target.value.replace(/\D/g, '') })}
          />
        </label>
        <label>
          Primeira folha
          <input
            inputMode="numeric"
            value={form.nextSheet}
            onChange={(e) => setForm({ ...form, nextSheet: e.target.value.replace(/\D/g, '') })}
          />
        </label>
        <button className="primary" disabled={!form.book.trim() || !form.nextNumber} onClick={() => void add()}>
          {current ? 'Cadastrar próximo' : 'Cadastrar'}
        </button>
      </div>
      <ul className="list compact">
        {data?.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>
                Livro {item.book}{' '}
                <span className={`badge ${item.status === 'current' ? '' : item.status === 'queued' ? 'info' : 'soft'}`}>
                  {item.status === 'current' ? 'Em uso' : item.status === 'queued' ? 'Na fila' : 'Encerrado'}
                </span>
              </strong>
              <span className="muted">
                Próxima tradução {item.nextNumber} · próxima folha {item.nextSheet}
                {item.closedAt
                  ? ` · encerrado em ${dateTime(item.closedAt)}`
                  : item.startedAt
                    ? ` · desde ${dateTime(item.startedAt)}`
                    : ''}
              </span>
            </div>
            {item.status === 'queued' && (
              <button
                className="small danger"
                onClick={() =>
                  api('DELETE', `/numbering-books/${item.id}`)
                    .then(() => setVersion((value) => value + 1))
                    .catch((caught: unknown) => setFeedback({ error: message(caught) }))
                }
              >
                Remover
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Numeração da tradução (usuário) ----------

/**
 * O usuário escolhe o tradutor e preenche a numeração conforme a regra dele; o sistema confere na hora e aponta
 * problemas (duplicado, fora da planilha, fora da sequência, livro travado…). O número só é emitido na conclusão.
 */
export function NumberingPanel({
  translationId,
  editable,
  canAuthorize,
  onSaved,
  defaultTranslatorId = null,
  defaultPages = null,
  completed = false,
}: {
  translationId: string;
  editable: boolean;
  canAuthorize: boolean;
  onSaved?: () => void;
  /** Tradutor escolhido no envio (ADR-017): a numeração já abre com a regra dele. */
  defaultTranslatorId?: string | null;
  /** Páginas do original, para a regra por folhas. */
  defaultPages?: number | null;
  completed?: boolean;
}) {
  const confirm = useConfirm();
  const translators = useLoad(() => api<{ items: SwornTranslator[] }>('GET', '/sworn-translators?active=true'), []);
  const ready = (translators.data?.items ?? []).filter((item) => item.ready);
  const [translatorId, setTranslatorId] = useState('');
  const [state, setState] = useState<{ entry: Entry | null; rule: Rule | null; check: Check | null } | null>(null);
  const [form, setForm] = useState({
    number: '',
    book: '',
    pages: '',
    protocol: '',
    medium: '',
    language: '',
    free: false,
    protocolValue: '',
    translatorFee: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (chosen?: string): Promise<void> =>
    api<{ entry: Entry | null; rule: Rule | null; check: Check | null }>(
      'GET',
      `/translations/${translationId}/numbering${chosen ? `?translatorId=${chosen}` : ''}`,
    )
      .then((result) => {
        if (!result.rule && !chosen && defaultTranslatorId) {
          void load(defaultTranslatorId);
          return;
        }
        setState(result);
        const entry = result.entry && (!chosen || result.entry.translatorId === chosen) ? result.entry : null;
        if (result.rule) setTranslatorId(result.rule.translatorId);
        setForm({
          number: entry?.number ?? '',
          book: entry?.book ?? '',
          pages: entry?.pages ? String(entry.pages) : defaultPages ? String(defaultPages) : '',
          protocol: entry?.protocol ?? '',
          medium: entry?.medium ?? '',
          language: entry?.language ?? '',
          free: entry?.free ?? false,
          protocolValue: entry?.protocolValue !== null && entry?.protocolValue !== undefined ? String(entry.protocolValue) : '',
          translatorFee: entry?.translatorFee !== null && entry?.translatorFee !== undefined ? String(entry.translatorFee) : '',
        });
      })
      .catch((caught: unknown) => setError(message(caught)));

  useEffect(() => {
    void load();
  }, [translationId]);

  const rule = state?.rule ?? null;
  const scheme = rule?.scheme;
  const config = rule?.config ?? {};
  const issued = state?.entry?.status === 'issued';
  const errors = state?.check?.anomalies.filter((anomaly) => anomaly.severity === 'error') ?? [];
  const warnings = state?.check?.anomalies.filter((anomaly) => anomaly.severity === 'warning') ?? [];
  const entry = state?.entry ?? null;
  // Emitida, a conferência não roda mais: o resumo vem do que foi gravado.
  const computed =
    state?.check?.computed ??
    (entry?.status === 'issued'
      ? {
          number: entry.number,
          book: entry.book,
          sheetStart: entry.sheetStart,
          sheetEnd: entry.sheetEnd,
          pages: entry.pages,
          free: entry.free,
          protocolValue: entry.protocolValue,
          translatorFee: entry.translatorFee,
          pageCharge: null,
        }
      : undefined);
  const languages = config.languages ?? [];

  async function save() {
    if (!translatorId) return;
    if (
      completed &&
      !(await confirm('Este documento já está pronto. Deseja alterar a numeração? Será necessário conferir a nova versão do Word.'))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ entry: Entry; rule: Rule; check: Check }>('PUT', `/translations/${translationId}/numbering`, {
        translatorId,
        number: form.number.trim() || null,
        book: form.book.trim() || null,
        pages: form.pages ? Number(form.pages) : null,
        protocol: form.protocol.trim() || null,
        medium: (form.medium || null) as 'digital' | 'impresso' | null,
        language: form.language || null,
        free: form.free,
        protocolValue: numberOrNull(form.protocolValue),
        translatorFee: numberOrNull(form.translatorFee),
        confirmCompleted: completed,
      });
      setState(result);
      onSaved?.();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function authorize() {
    if (completed && !(await confirm('Este documento já está pronto. Deseja alterar a autorização de protocolo zerado?'))) return;
    try {
      setState(await api('POST', `/translations/${translationId}/numbering/authorize-zero-protocol`, { confirmCompleted: completed }));
    } catch (caught) {
      setError(message(caught));
    }
  }

  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input
        value={form[key] as string}
        disabled={!editable || issued}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
    </label>
  );

  const summary = useMemo(() => {
    if (!computed) return null;
    const parts = [
      computed.number && `nº ${computed.number}`,
      computed.book && `livro ${computed.book}`,
      computed.sheetStart &&
        `folha ${computed.sheetStart}${computed.sheetEnd && computed.sheetEnd !== computed.sheetStart ? ` a ${computed.sheetEnd}` : ''}`,
      computed.protocolValue !== null && `protocolo ${money(computed.protocolValue)}`,
      computed.translatorFee !== null && `assinatura ${computed.free ? 'gratuita' : money(computed.translatorFee)}`,
      computed.pageCharge !== null && `páginas extras ${money(computed.pageCharge)}`,
    ].filter(Boolean);
    return parts.join(' · ');
  }, [computed]);

  return (
    <div className="card panel numbering-panel">
      <h3>Numeração {issued && <span className="badge">Emitida</span>}</h3>
      <label>
        Tradutor juramentado
        <select
          value={translatorId}
          disabled={!editable || issued}
          onChange={(e) => {
            setTranslatorId(e.target.value);
            if (e.target.value) void load(e.target.value);
          }}
        >
          <option value="">Escolha…</option>
          {ready.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.languages ? ` (${item.languages})` : ''}
            </option>
          ))}
        </select>
      </label>
      {rule && <p className="muted small-text">Regra: {rule.schemeLabel}</p>}
      {rule && (
        <div className="field-row">
          {scheme !== 'book_sheet' &&
            field('number', 'Número', {
              maxLength: 40,
              placeholder: scheme === 'prefixed' ? `${(config.prefix ?? 'NB').toUpperCase()}-2026-1111` : 'Como na planilha',
            })}
          {(scheme === 'free_text' || scheme === 'prefixed') && field('book', 'Livro', { maxLength: 40 })}
          {(config.recordPages || scheme === 'book_sheet') && field('pages', 'Páginas (laudas)', { inputMode: 'numeric' })}
          {scheme === 'reusable_stock' && field('protocol', 'Protocolo', { maxLength: 60 })}
          {scheme !== 'reusable_stock' && field('protocol', 'Protocolo (opcional)', { maxLength: 60 })}
          {scheme === 'reusable_stock' && languages.length > 0 && (
            <label>
              Idioma
              <select value={form.language} disabled={!editable || issued} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="">Escolha…</option>
                {languages.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}
          {config.requiresMedium && (
            <fieldset className="date-range" disabled={!editable || issued}>
              <legend>Entrega</legend>
              <label className="check">
                <input
                  type="radio"
                  name={`medium-${translationId}`}
                  checked={form.medium === 'digital'}
                  onChange={() => setForm({ ...form, medium: 'digital' })}
                />
                Digital
              </label>
              <label className="check">
                <input
                  type="radio"
                  name={`medium-${translationId}`}
                  checked={form.medium === 'impresso'}
                  onChange={() => setForm({ ...form, medium: 'impresso' })}
                />
                Impresso
              </label>
            </fieldset>
          )}
          {scheme === 'prefixed' && field('protocolValue', 'Valor do protocolo (R$)', { inputMode: 'decimal' })}
          {scheme === 'prefixed' && !form.free && field('translatorFee', 'Valor da assinatura (R$)', { inputMode: 'decimal' })}
          {(scheme === 'prefixed' || scheme === 'reusable_stock') && (
            <label className="check">
              <input
                type="checkbox"
                checked={form.free}
                disabled={!editable || issued}
                onChange={(e) => setForm({ ...form, free: e.target.checked })}
              />
              {scheme === 'prefixed' ? 'Assinatura gratuita' : 'Número do lote gratuito'}
            </label>
          )}
        </div>
      )}
      {summary && (
        <p className="small-text">
          {issued ? 'Emitido: ' : scheme === 'book_sheet' ? 'Previsto: ' : ''}
          {summary}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="alert error anomalies">
          {errors.map((anomaly, index) => (
            <li key={index}>{anomaly.message}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="alert warn-box anomalies">
          {warnings.map((anomaly, index) => (
            <li key={index}>{anomaly.message}</li>
          ))}
        </ul>
      )}
      {state?.entry?.zeroProtocolAuthorizedBy && (
        <p className="muted small-text">Protocolo zerado autorizado por {state.entry.zeroProtocolAuthorizedBy}.</p>
      )}
      {config.reminder && <p className="alert info small-text">Lembrete: {config.reminder}</p>}
      <Feedback error={error} />
      {editable && !issued && rule && (
        <div className="actions">
          <button className="primary small" disabled={busy} onClick={() => void save()}>
            {busy ? 'Conferindo…' : 'Salvar e conferir'}
          </button>
          {canAuthorize && errors.some((anomaly) => anomaly.code === 'zero_protocol') && (
            <button className="small" onClick={() => void authorize()}>
              Autorizar protocolo zerado
            </button>
          )}
        </div>
      )}
    </div>
  );
}
