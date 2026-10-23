export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'tradutor.theme';
let currentPreference: ThemePreference = 'light';
let systemTheme: MediaQueryList | undefined;
let watchingSystem = false;
let watchingStorage = false;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getSystemTheme() {
  if (!systemTheme && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  }
  return systemTheme;
}

function onSystemThemeChange() {
  if (currentPreference === 'system') applyTheme('system');
}

/** Apply immediately, including when browser storage is unavailable. */
export function applyTheme(theme: ThemePreference): void {
  currentPreference = theme;
  const media = theme === 'system' ? getSystemTheme() : systemTheme;
  const resolved = theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme;

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }

  if (!media) return;
  if (theme === 'system' && !watchingSystem) {
    media.addEventListener('change', onSystemThemeChange);
    watchingSystem = true;
  } else if (theme !== 'system' && watchingSystem) {
    media.removeEventListener('change', onSystemThemeChange);
    watchingSystem = false;
  }
}

/** Restore the cached preference before mounting the application. */
export function initializeTheme(): ThemePreference {
  let theme: ThemePreference = 'light';
  try {
    const cached = window.localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(cached)) theme = cached;
  } catch {
    // Privacy settings or a full storage quota must not prevent using the app.
  }
  applyTheme(theme);

  if (typeof window !== 'undefined' && !watchingStorage) {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        applyTheme(isThemePreference(event.newValue) ? event.newValue : 'light');
      }
    });
    watchingStorage = true;
  }
  return theme;
}

export function setThemePreference(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Keep the current preference usable even when it cannot be persisted.
  }
  applyTheme(theme);
}
