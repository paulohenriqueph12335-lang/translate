import { z } from 'zod';

export const UserPreferences = z.strictObject({
  notificationsEnabled: z.boolean(),
  notificationFrequency: z.enum(['immediate', '5m', '15m', '1h']),
  theme: z.enum(['light', 'dark', 'system']),
});

export type UserPreferences = z.infer<typeof UserPreferences>;

export const UserPreferencesPatch = UserPreferences.partial().refine((input) => Object.values(input).some((value) => value !== undefined), {
  message: 'Informe pelo menos uma preferência',
});

export type UserPreferencesPatch = z.infer<typeof UserPreferencesPatch>;

export interface PreferencesRow {
  notifications_enabled: boolean;
  notification_frequency: UserPreferences['notificationFrequency'];
  theme: UserPreferences['theme'];
}

export const toUserPreferences = (row: PreferencesRow): UserPreferences => ({
  notificationsEnabled: row.notifications_enabled,
  notificationFrequency: row.notification_frequency,
  theme: row.theme,
});
