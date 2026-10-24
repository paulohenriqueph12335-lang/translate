import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, type Me } from './api';
import { AuthScreen, SetupScreen } from './AuthScreen';
import { Dashboard } from './Dashboard';
import { ConfirmProvider } from './ConfirmDialog';
import { UpdateBanner } from './UpdateBanner';
import { Wordmark } from './ui';
import { initializeTheme } from './theme';
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './style.css';

initializeTheme();

function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  // Sem Diretor no sistema, a tela de entrada vira a configuração inicial (ADR-004).
  const [setupNeeded, setSetupNeeded] = useState(false);
  const checkSetup = useCallback(() => {
    api<{ needed: boolean }>('GET', '/setup')
      .then((result) => setSetupNeeded(result.needed))
      .catch(() => setSetupNeeded(false));
  }, []);

  useEffect(() => {
    api<Me>('GET', '/auth/me')
      .then(setMe)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) setOffline(true);
        setMe(null);
        checkSetup();
      });
  }, [checkSetup]);

  const logout = useCallback(async () => {
    await api('POST', '/auth/logout').catch(() => undefined);
    setMe(null);
    checkSetup();
  }, [checkSetup]);
  const expire = useCallback(() => {
    setMe(null);
    checkSetup();
  }, [checkSetup]);

  if (me === undefined)
    return (
      <main className="app-loading" aria-busy="true">
        <Wordmark />
        <p role="status">Carregando…</p>
      </main>
    );
  if (!me)
    return (
      <>
        {offline && <div className="alert error banner">API indisponível. Verifique se o servidor está em execução.</div>}
        {setupNeeded ? <SetupScreen onLogin={setMe} /> : <AuthScreen onLogin={setMe} />}
      </>
    );
  return <Dashboard key={me.user.id} me={me} onLogout={logout} onUnauthorized={expire} />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UpdateBanner />
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </React.StrictMode>,
);
