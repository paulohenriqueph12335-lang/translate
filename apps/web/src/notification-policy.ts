export type NotificationFrequency = 'immediate' | '5m' | '15m' | '1h';

export interface NotificationPreferences {
  notificationsEnabled: boolean;
  notificationFrequency: NotificationFrequency;
}

export interface NotificationPolicyState<T extends { id: string }> {
  initialized: boolean;
  seen: Set<string>;
  pending: Map<string, T>;
  lastAlertAt: number;
}

export function notificationIntervalMs(frequency: NotificationFrequency): number {
  return { immediate: 0, '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000 }[frequency];
}

export function createNotificationPolicy<T extends { id: string }>(seen: Iterable<string> = []): NotificationPolicyState<T> {
  return { initialized: false, seen: new Set(seen), pending: new Map(), lastAlertAt: 0 };
}

/** The first complete unread snapshot is a baseline, including when a cache already exists. */
export function advanceNotificationPolicy<T extends { id: string }>(
  previous: NotificationPolicyState<T>,
  unread: readonly T[],
  frequency: NotificationFrequency,
  now: number,
): { state: NotificationPolicyState<T>; fresh: T[]; alerts: T[] } {
  const seen = new Set(previous.seen);
  if (!previous.initialized) {
    unread.forEach((item) => seen.add(item.id));
    return { state: { initialized: true, seen, pending: new Map(), lastAlertAt: now }, fresh: [], alerts: [] };
  }

  const unreadIds = new Set(unread.map((item) => item.id));
  // Reading an item in the notification center also removes it from a delayed batch.
  const pending = new Map([...previous.pending].filter(([id]) => unreadIds.has(id)));
  const fresh = unread.filter((item) => !seen.has(item.id)).reverse();
  for (const item of fresh) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    pending.set(item.id, item);
  }

  const due = now - previous.lastAlertAt >= notificationIntervalMs(frequency);
  const alerts = due ? [...pending.values()] : [];
  return {
    state: {
      initialized: true,
      seen,
      pending: alerts.length ? new Map() : pending,
      lastAlertAt: alerts.length ? now : previous.lastAlertAt,
    },
    fresh,
    alerts,
  };
}

interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const seenKey = (userId: string) => `tradutor:notificacoes-vistas:${encodeURIComponent(userId)}`;

export function loadNotificationSeen(storage: Pick<SeenStorage, 'getItem'> | null, userId: string): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(seenKey(userId)) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveNotificationSeen(storage: Pick<SeenStorage, 'setItem'> | null, userId: string, seen: Set<string>): void {
  try {
    storage?.setItem(seenKey(userId), JSON.stringify([...seen].slice(-200)));
  } catch {
    // Alerts still work in memory when browser storage is unavailable or full.
  }
}
