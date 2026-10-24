import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { PopupSettings } from './LiveNotifications';
import { NOTIFICATION_PREFERENCES_CHANGED, useNotificationSettings, type SmartNotificationPreferences } from './notification-preferences';
import { Feedback, message } from './ui';

export function SmartNotificationSettings() {
  const settings = useNotificationSettings();
  const [draft, setDraft] = useState<SmartNotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const dirty=useRef(false);
  const changeDraft=(value:SmartNotificationPreferences)=>{dirty.current=true;setDraft(value);setFeedback({});};
  useEffect(() => {
    if (settings.data&&!dirty.current) setDraft(structuredClone(settings.data));
  }, [settings.data]);
  async function save(reset = false) {
    if (!draft || saving) return;
    setSaving(true);
    setFeedback({});
    try {
      const value = await api<SmartNotificationPreferences>(
        'PATCH',
        '/notifications/preferences',
        reset
          ? { resetToRecommended: true, deliveryMode: 'digest' }
          : {
              notificationsEnabled: draft.notificationsEnabled,
              notificationFrequency: draft.notificationFrequency,
              deliveryMode: draft.deliveryMode,
              categories: draft.categories,
            },
      );
      dirty.current=false;
      setDraft(value);
      window.dispatchEvent(new Event(NOTIFICATION_PREFERENCES_CHANGED));
      setFeedback({ ok: reset ? 'Recomendações do seu perfil restauradas.' : 'Preferências de notificações salvas.' });
    } catch (caught) {
      setFeedback({ error: message(caught) });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="card settings-card" aria-labelledby="notification-settings-title">
      <h3 id="notification-settings-title">Notificações inteligentes</h3>
      <p className="muted settings-copy">
        Escolha os assuntos e onde receber os avisos. O resumo agrupa o que precisa de atenção e explica o motivo.
      </p>
      <Feedback error={settings.error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      {!draft ? (
        <p role="status">Carregando suas escolhas…</p>
      ) : (
        <>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={saving} style={{ border: 0, padding: 0, minWidth: 0 }}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.notificationsEnabled}
                  onChange={(e) => changeDraft({ ...draft, notificationsEnabled: e.target.checked })}
                />{' '}
                Ativar avisos
              </label>
              <label>
                Forma de entrega
                <select
                  aria-label="Forma de entrega"
                  value={draft.deliveryMode}
                  onChange={(e) => changeDraft({ ...draft, deliveryMode: e.target.value as 'digest' | 'individual' })}
                >
                  <option value="digest">Resumo inteligente (recomendado)</option>
                  <option value="individual">Avisos individuais (mais frequentes)</option>
                </select>
              </label>
              <label>
                Frequência dos avisos
                <select
                  disabled={!draft.notificationsEnabled}
                  value={draft.notificationFrequency}
                  onChange={(e) =>
                    changeDraft({ ...draft, notificationFrequency: e.target.value as SmartNotificationPreferences['notificationFrequency'] })
                  }
                >
                  <option value="immediate">Assim que possível</option>
                  <option value="5m">A cada 5 minutos</option>
                  <option value="15m">A cada 15 minutos</option>
                  <option value="1h">A cada hora</option>
                </select>
              </label>
              <p className="muted small-text">
                No resumo, os eventos são agrupados em um aviso por intervalo, com mínimo de 1 minuto. Avisos individuais são uma escolha
                explícita e têm limite de 10 por consulta. O centro mantém o histórico completo.
              </p>
              <div className="notification-category-grid">
                {draft.catalog.map((category) => (
                  <section key={category.id} className="notification-category" aria-label={category.label}>
                    <h4>
                      {category.label} {category.recommended && <span className="badge soft">Recomendado</span>}
                    </h4>
                    <p className="small-text">{category.description}</p>
                    <p className="muted small-text">{category.reason}</p>
                    {(
                      [
                        ['inApp', 'Aviso neste navegador'],
                        ['browser', 'Windows / sistema'],
                      ] as const
                    ).map(([channel, label]) => (
                      <label key={channel} className="check">
                        <input
                          type="checkbox"
                          aria-label={`${label}: ${category.label}`}
                          checked={draft.categories[category.id][channel]}
                          disabled={!draft.notificationsEnabled}
                          onChange={(e) =>
                            changeDraft({
                              ...draft,
                              categories: {
                                ...draft.categories,
                                [category.id]: { ...draft.categories[category.id], [channel]: e.target.checked },
                              },
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </section>
                ))}
              </div>
            </fieldset>
            <p className="muted settings-hint">
              “Neste navegador” mostra avisos dentro da página. “Windows / sistema” usa a permissão deste navegador para exibir notificações
              do sistema operacional. Os avisos funcionam enquanto a aplicação está aberta, inclusive em outra aba; as preferências seguem
              sua conta.
            </p>
            <div className="actions">
              <button className="primary" disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar notificações'}
              </button>
              <button type="button" disabled={saving} onClick={() => void save(true)}>
                Usar recomendações do meu perfil
              </button>
            </div>
          </form>
          <PopupSettings enabled={draft.notificationsEnabled && Object.values(draft.categories).some((c) => c.browser)} />
        </>
      )}
    </section>
  );
}
