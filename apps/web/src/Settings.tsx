import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { PopupSettings } from './LiveNotifications';
import type { UserPreferences } from './preferences';
import { Feedback, message, Section } from './ui';

export function Settings({
  preferences,
  loading,
  saving,
  error,
  onReload,
  onSave,
}: {
  preferences: UserPreferences | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onReload: () => void;
  onSave: (patch: Partial<UserPreferences>) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState<UserPreferences['notificationFrequency']>('immediate');
  const [theme, setTheme] = useState<UserPreferences['theme']>('light');
  const [notificationFeedback, setNotificationFeedback] = useState<{ error?: string; ok?: string }>({});
  const [themeFeedback, setThemeFeedback] = useState<{ error?: string; ok?: string }>({});

  useEffect(() => {
    if (!preferences) return;
    setEnabled(preferences.notificationsEnabled);
    setFrequency(preferences.notificationFrequency);
  }, [preferences?.notificationsEnabled, preferences?.notificationFrequency]);

  useEffect(() => {
    if (preferences) setTheme(preferences.theme);
  }, [preferences?.theme]);

  async function saveNotifications(event: FormEvent) {
    event.preventDefault();
    setNotificationFeedback({});
    try {
      await onSave({ notificationsEnabled: enabled, notificationFrequency: frequency });
      setNotificationFeedback({ ok: 'Preferências de notificações salvas.' });
    } catch (caught) {
      setNotificationFeedback({ error: message(caught) });
    }
  }

  async function saveTheme(event: FormEvent) {
    event.preventDefault();
    setThemeFeedback({});
    try {
      await onSave({ theme });
      setThemeFeedback({ ok: 'Aparência atualizada.' });
    } catch (caught) {
      setThemeFeedback({ error: message(caught) });
    }
  }

  return (
    <Section title="Preferências" subtitle="Personalize a aparência e os avisos da sua conta.">
      <Feedback error={error} />
      {error && (
        <button className="small" onClick={onReload} disabled={loading || saving}>
          Tentar novamente
        </button>
      )}
      {loading && !preferences && (
        <p className="muted" role="status">
          Carregando preferências…
        </p>
      )}
      {preferences && (
        <div className="settings-grid">
          <section className="card settings-card" aria-labelledby="notification-settings-title">
            <h3 id="notification-settings-title">Notificações</h3>
            <p className="muted settings-copy">Escolha quando receber os avisos na tela e os pop-ups do sistema.</p>
            <form className="settings-form" onSubmit={(event) => void saveNotifications(event)}>
              <label className="settings-row">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={saving}
                  onChange={(event) => {
                    setEnabled(event.target.checked);
                    setNotificationFeedback({});
                  }}
                />
                <span>Ativar notificações</span>
              </label>
              <label>
                Frequência dos avisos
                <select
                  value={frequency}
                  disabled={!enabled || saving}
                  onChange={(event) => {
                    setFrequency(event.target.value as UserPreferences['notificationFrequency']);
                    setNotificationFeedback({});
                  }}
                >
                  <option value="immediate">Assim que chegarem</option>
                  <option value="5m">A cada 5 minutos</option>
                  <option value="15m">A cada 15 minutos</option>
                  <option value="1h">A cada hora</option>
                </select>
              </label>
              <p className="muted settings-hint">
                Os avisos funcionam enquanto o sistema está aberto. As notificações continuam disponíveis no menu, mesmo com os avisos
                desativados.
              </p>
              <Feedback error={notificationFeedback.error ?? null} ok={notificationFeedback.ok ?? null} />
              <button
                className="primary"
                disabled={saving || (enabled === preferences.notificationsEnabled && frequency === preferences.notificationFrequency)}
              >
                {saving ? 'Salvando…' : 'Salvar notificações'}
              </button>
            </form>
            <PopupSettings enabled={preferences.notificationsEnabled} />
          </section>
          <section className="card settings-card" aria-labelledby="appearance-settings-title">
            <h3 id="appearance-settings-title">Aparência</h3>
            <p className="muted settings-copy">Use o modo noturno para trabalhar com uma interface escura.</p>
            <form className="settings-form" onSubmit={(event) => void saveTheme(event)}>
              <label>
                Tema da interface
                <select
                  value={theme}
                  disabled={saving}
                  onChange={(event) => {
                    setTheme(event.target.value as UserPreferences['theme']);
                    setThemeFeedback({});
                  }}
                >
                  <option value="light">Claro</option>
                  <option value="dark">Modo noturno</option>
                  <option value="system">Acompanhar o sistema</option>
                </select>
              </label>
              <p className="muted settings-hint">As prévias dos documentos mantêm o papel branco para representar o arquivo final.</p>
              <Feedback error={themeFeedback.error ?? null} ok={themeFeedback.ok ?? null} />
              <button className="primary" disabled={saving || theme === preferences.theme}>
                {saving ? 'Salvando…' : 'Salvar aparência'}
              </button>
            </form>
          </section>
        </div>
      )}
    </Section>
  );
}

export function PasswordSettings({ email }: { email: string }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback({});
    if (newPassword !== confirmation) {
      setFeedback({ error: 'A confirmação da nova senha não confere.' });
      return;
    }
    if (newPassword === currentPassword) {
      setFeedback({ error: 'Escolha uma senha diferente da atual.' });
      return;
    }
    setSaving(true);
    try {
      await api('POST', '/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setFeedback({ ok: 'Senha atualizada. Os acessos nos outros dispositivos foram encerrados; você continua conectado aqui.' });
    } catch (caught) {
      setFeedback({ error: message(caught) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Alterar senha" subtitle="Atualize a senha da sua própria conta usando a senha atual.">
      <section className="card settings-card" aria-labelledby="password-settings-title">
        <h3 id="password-settings-title">Senha da conta</h3>
        <p className="muted settings-copy">{email}</p>
        <form className="settings-form" onSubmit={(event) => void changePassword(event)}>
          <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
          <label>
            Senha atual
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={currentPassword}
              disabled={saving}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            Nova senha
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              aria-describedby="password-policy"
              value={newPassword}
              disabled={saving}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <small className="muted" id="password-policy">
              Use de 12 a 256 caracteres.
            </small>
          </label>
          <label>
            Confirmar nova senha
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              value={confirmation}
              disabled={saving}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <Feedback error={feedback.error ?? null} ok={feedback.ok ?? null} />
          <button className="primary" disabled={saving}>
            {saving ? 'Atualizando…' : 'Atualizar senha'}
          </button>
        </form>
      </section>
    </Section>
  );
}
