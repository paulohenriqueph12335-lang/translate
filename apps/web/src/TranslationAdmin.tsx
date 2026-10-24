import { useState, type FormEvent } from 'react';
import { api, languageLabel, LANGUAGES, providerLabel, type Capabilities, type GlossaryEntry, type Language, type Me } from './api';
import { Feedback, message, SearchInput, Section, Segmented, useDebounced, useLoad } from './ui';

/** Destinos na ordem das skills: os termos ficam organizados pelo idioma para o qual se traduz. */
const TARGETS: Language[] = ['en', 'fr', 'it', 'es', 'pt'];
const FOREIGN = LANGUAGES.filter((language) => language !== 'pt');

export function Glossary({ me }: { me: Me }) {
  const isDirector = me.user.orgRole === 'director';
  const ledTeams = me.memberships.filter((m) => m.role === 'leader');
  const [target, setTarget] = useState<Language>('en');
  // Para o português, escolhe-se de qual idioma vem o termo; para os demais, a origem é o português.
  const [foreignSource, setForeignSource] = useState<Language>('en');
  const source: Language = target === 'pt' ? foreignSource : 'pt';
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const { data, error, reload } = useLoad(
    () =>
      api<{ items: GlossaryEntry[] }>(
        'GET',
        `/glossary?sourceLanguage=${source}&targetLanguage=${target}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    [source, target, q],
  );
  const [form, setForm] = useState({ sourceTerm: '', targetTerm: '', note: '', scope: isDirector ? 'org' : (ledTeams[0]?.teamId ?? '') });
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const canAdd = isDirector || ledTeams.length > 0;

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api('POST', '/glossary', {
        sourceLanguage: source,
        targetLanguage: target,
        sourceTerm: form.sourceTerm,
        targetTerm: form.targetTerm,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(form.scope !== 'org' ? { teamId: form.scope } : {}),
      });
      setForm({ ...form, sourceTerm: '', targetTerm: '', note: '' });
      setFeedback({ ok: 'Termo adicionado.' });
      reload();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    }
  }

  return (
    <div className="administration-view glossary-view">
      <Section title="Glossário" subtitle="Traduções aprovadas de termos. O sistema as usa nos rascunhos e confere nas checagens.">
        <div className="filters">
          <Segmented
            label="Idioma de destino"
            value={target}
            options={TARGETS.map((language) => [language, `Para ${languageLabel[language].toLowerCase()}`])}
            onChange={setTarget}
          />
          {target === 'pt' && (
            <select aria-label="Idioma do termo" value={foreignSource} onChange={(e) => setForeignSource(e.target.value as Language)}>
              {FOREIGN.map((language) => (
                <option key={language} value={language}>
                  Termos em {languageLabel[language].toLowerCase()}
                </option>
              ))}
            </select>
          )}
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar termo" />
        </div>
        {canAdd && (
          <form className="card toolbar glossary-entry-form" onSubmit={add}>
            <input
              required
              placeholder={`Termo (${source.toUpperCase()})`}
              value={form.sourceTerm}
              onChange={(e) => setForm({ ...form, sourceTerm: e.target.value })}
            />
            <input
              required
              placeholder={`Tradução (${target.toUpperCase()})`}
              value={form.targetTerm}
              onChange={(e) => setForm({ ...form, targetTerm: e.target.value })}
            />
            <input placeholder="Observação (opcional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} aria-label="Alcance">
              {isDirector && <option value="org">Toda a organização</option>}
              {(isDirector ? me.memberships : ledTeams).map((m) => (
                <option key={m.teamId} value={m.teamId}>
                  Equipe {m.teamName}
                </option>
              ))}
            </select>
            <button className="primary">Adicionar</button>
          </form>
        )}
        <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Termo</th>
                <th>Tradução</th>
                <th>Alcance</th>
                <th>Observação</th>
                <th>Origem</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.sourceTerm}</td>
                  <td>{entry.targetTerm}</td>
                  <td className="muted">{entry.team ? `Equipe ${entry.team.name}` : 'Organização'}</td>
                  <td className="muted">{entry.note ?? '—'}</td>
                  <td className="muted small-text">{entry.origin ?? `Cadastro de ${entry.createdBy}`}</td>
                  <td className="actions">
                    {entry.canEdit && (
                      <button
                        className="small danger"
                        onClick={() =>
                          window.confirm(`Remover "${entry.sourceTerm}" do glossário?`) &&
                          api('DELETE', `/glossary/${entry.id}`)
                            .then(reload)
                            .catch((caught: unknown) => setFeedback({ error: message(caught) }))
                        }
                      >
                        Remover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.items.length === 0 && (
          <p className="empty">
            Nenhum termo{' '}
            {q ? 'corresponde à busca' : `de ${languageLabel[source].toLowerCase()} para ${languageLabel[target].toLowerCase()}`}.
          </p>
        )}
      </Section>
    </div>
  );
}

/** Configurações da organização (Diretor): a tradução automática. Tradutores e máscaras ficam em Tradutores juramentados. */
export function TranslationSettingsView() {
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  return (
    <div className="administration-view machine-settings-view">
      <Section title="Configurações" subtitle="Tradução automática dos documentos enviados.">
        <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
        <p className="muted small-text">
          O tradutor juramentado, a máscara em Word e a numeração de cada um são cadastrados em Tradutores juramentados, pelos Supervisores.
        </p>
        <MachineProviderSettings onError={(error) => setFeedback({ error })} />
      </Section>
    </div>
  );
}

/** Provedor gratuito da organização (ADR-008): LibreTranslate local, DeepL Free externo ou desligado. */
function MachineProviderSettings({ onError }: { onError: (message: string) => void }) {
  const { data, reload } = useLoad(() => api<Capabilities>('GET', '/translation-capabilities'), []);
  if (!data) return null;

  async function choose(provider: Capabilities['machineProvider']) {
    if (provider === 'deepl' && !window.confirm('O DeepL envia o texto dos documentos para servidores externos. Confirmar?')) return;
    try {
      await api('PUT', '/machine-translation-settings', { provider });
      reload();
    } catch (caught) {
      onError(message(caught));
    }
  }

  return (
    <>
      <h3 className="top-gap">Tradução automática gratuita</h3>
      <p className="muted small-text">
        Todo documento enviado é traduzido trecho a trecho, dentro do layout do original. Trechos de traduções já concluídas vêm da memória
        sem gastar cota; brasões, carimbos e assinaturas viram marcadores entre colchetes, conforme as regras de tradução.
      </p>
      <ul className="list compact machine-provider-list">
        {(['libretranslate', 'deepl', 'none'] as const).map((provider) => {
          const online = provider === 'none' || data.machineProviders.includes(provider);
          return (
            <li key={provider}>
              <label className="check grow">
                <input
                  type="radio"
                  name="machine-provider"
                  checked={data.machineProvider === provider}
                  onChange={() => void choose(provider)}
                />
                <span className="who">
                  <strong>{providerLabel[provider]}</strong>
                  <span className="muted">
                    {provider === 'libretranslate'
                      ? 'Roda no seu Docker; o documento não sai da sua infraestrutura. Sem custo e sem limite.'
                      : provider === 'deepl'
                        ? 'Melhor qualidade; grátis até 500 mil caracteres/mês. Exige DEEPL_API_KEY no worker.'
                        : 'Sem tradução automática: os rascunhos trazem o texto original no layout do original.'}
                  </span>
                </span>
              </label>
              {provider !== 'none' && <span className={`badge ${online ? '' : 'warn'}`}>{online ? 'Respondendo' : 'Indisponível'}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
