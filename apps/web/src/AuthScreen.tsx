import { useState, type FormEvent } from 'react';
import { api, ApiError, type Me } from './api';

export function AuthScreen({ onLogin }: { onLogin: (me: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') {
        onLogin(await api<Me>('POST', '/auth/login', { email, password }));
      } else {
        await api('POST', '/auth/signup', { email, displayName, password });
        setPassword('');
        setMode('login');
        setNotice('Cadastro recebido. Você poderá entrar assim que um Diretor aprovar o acesso.');
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível conectar ao servidor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <span className="eyebrow">PLATAFORMA DOCUMENTAL</span>
      <h1 className="auth-title">{mode === 'login' ? 'Entrar' : 'Solicitar acesso'}</h1>
      <p className="muted">
        {mode === 'login' ? 'Use o e-mail e a senha da sua conta aprovada.' : 'Seu cadastro ficará pendente até a aprovação de um Diretor.'}
      </p>

      <form className="card form" onSubmit={submit}>
        <label>
          E-mail
          <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'signup' && (
          <label>
            Nome
            <input autoComplete="name" required maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
        )}
        <label>
          Senha
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signup' ? 12 : 1}
            maxLength={256}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'signup' && <small className="muted">Mínimo de 12 caracteres.</small>}
        </label>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Enviar cadastro'}
        </button>
      </form>

      <p className="switch">
        {mode === 'login' ? (
          <>
            Não tem conta?{' '}
            <button className="link" onClick={() => switchMode('signup')}>
              Solicitar acesso
            </button>
          </>
        ) : (
          <>
            Já tem conta aprovada?{' '}
            <button className="link" onClick={() => switchMode('login')}>
              Entrar
            </button>
          </>
        )}
      </p>
    </main>
  );
}
