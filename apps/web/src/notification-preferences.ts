import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { message } from './ui';

export const NOTIFICATION_PREFERENCES_CHANGED = 'tradutor:notification-preferences';
export type NotificationCategory = 'workflow' | 'review' | 'failures' | 'assignments' | 'numbering' | 'administration';
export interface SmartNotificationPreferences {
  notificationsEnabled: boolean;
  notificationFrequency: 'immediate' | '5m' | '15m' | '1h';
  deliveryMode: 'digest' | 'individual';
  profile: 'director' | 'leader' | 'operator';
  categories: Record<NotificationCategory, { inApp: boolean; browser: boolean }>;
  catalog: Array<{ id: NotificationCategory; label: string; description: string; reason: string; recommended: boolean }>;
  delivery: { minimumIntervalSeconds: number; maxIndividualItems: number; onlineOnly: boolean };
}
export function useNotificationSettings() {
  const [data, setData] = useState<SmartNotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener(NOTIFICATION_PREFERENCES_CHANGED, reload);
    return () => window.removeEventListener(NOTIFICATION_PREFERENCES_CHANGED, reload);
  }, [reload]);
  useEffect(() => {
    let active = true;
    api<SmartNotificationPreferences>('GET', '/notifications/preferences')
      .then((value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught) => active && setError(message(caught)));
    return () => {
      active = false;
    };
  }, [version]);
  return { data, error, reload };
}
