import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { setThemePreference, type ThemePreference } from './theme';
import { message } from './ui';

export interface UserPreferences {
  notificationsEnabled: boolean;
  notificationFrequency: 'immediate' | '5m' | '15m' | '1h';
  theme: ThemePreference;
}

/** O servidor guarda as preferências da conta; o cache local do tema evita um clarão ao abrir a página. */
export function useUserPreferences(userId: string) {
  const [data, setData] = useState<UserPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const writing = useRef(false);
  const current = useRef(data);
  current.current = data;

  const reload = useCallback(() => {
    if (writing.current) return;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    void api<UserPreferences>('GET', '/auth/preferences')
      .then((preferences) => {
        if (generation.current !== request) return;
        setData(preferences);
        setThemePreference(preferences.theme);
      })
      .catch((caught: unknown) => {
        if (generation.current === request) setError(message(caught));
      })
      .finally(() => {
        if (generation.current === request) setLoading(false);
      });
  }, [userId]);

  useEffect(() => {
    writing.current = false;
    setSaving(false);
    current.current = null;
    setData(null);
    reload();
    const sync = (event: StorageEvent) => {
      if (event.key !== 'tradutor.preferences.updated' || !event.newValue) return;
      try {
        if ((JSON.parse(event.newValue) as { userId?: string }).userId === userId) reload();
      } catch {
        // A malformed browser cache does not affect the account's preferences.
      }
    };
    window.addEventListener('focus', reload);
    window.addEventListener('storage', sync);
    return () => {
      generation.current += 1;
      window.removeEventListener('focus', reload);
      window.removeEventListener('storage', sync);
    };
  }, [reload, userId]);

  const update = useCallback(
    async (patch: Partial<UserPreferences>) => {
      if (!current.current || writing.current) return;
      const request = ++generation.current;
      writing.current = true;
      setSaving(true);
      setLoading(false);
      try {
        const preferences = await api<UserPreferences>('PATCH', '/auth/preferences', patch);
        if (generation.current !== request) return;
        current.current = preferences;
        setData(preferences);
        setError(null);
        setThemePreference(preferences.theme);
        try {
          window.localStorage.setItem('tradutor.preferences.updated', JSON.stringify({ userId, at: Date.now() }));
        } catch {
          // Cross-tab updates also refresh when the browser window regains focus.
        }
      } finally {
        if (generation.current === request) {
          writing.current = false;
          setSaving(false);
        }
      }
    },
    [userId],
  );

  return { data, error, loading, saving, reload, update };
}
