import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { api, ApiError, type Me } from './api';
import { Wordmark } from './ui';

/** Campo de senha com "Mostrar" / "Ocultar", para quem quiser conferir o que digitou. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-field account-password-field">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="link small-text"
        aria-pressed={visible}
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? 'Ocultar' : 'Mostrar'}
      </button>
    </span>
  );
}

const FLOW = ['Envio', 'Tradução', 'Revisão', 'Prévia em Word', 'Conclusão', 'Word final'];

/** Metade da marca na entrada: o nome, o que o sistema faz e a linha do fluxo de cada documento. */
function AuthBrand() {
  return (
    <aside className="auth-brand" aria-label="Tradutor Documental">
      <Wordmark />
      <div className="auth-brand-copy">
        <p className="auth-brand-title">Cada documento, do original ao Word final, no mesmo layout.</p>
        <p className="auth-brand-text">Tradução automática, conferência lado a lado, numeração e entrega da tradução pública.</p>
      </div>
      <ol className="auth-flow" aria-label="Etapas de cada tradução">
        {FLOW.map((step, index) => (
          <li key={step} className={index < 4 ? 'done' : index === 4 ? 'current' : ''}>
            <i aria-hidden="true" />
            {step}
          </li>
        ))}
      </ol>
    </aside>
  );
}

type AuthMode = 'login' | 'signup' | 'forgot';

const AUTH_HEADINGS: Record<AuthMode, { title: string; text: string; submit: string }> = {
  login: { title: 'Entrar', text: 'Use o e-mail e a senha da sua conta aprovada.', submit: 'Entrar' },
  signup: { title: 'Solicitar acesso', text: 'Seu cadastro ficará pendente até a aprovação de um Diretor.', submit: 'Enviar cadastro' },
  forgot: {
    title: 'Esqueci a senha',
    text: 'Escolha uma senha nova. Ela passa a valer quando o Diretor autorizar, ou por 24 horas quando o Líder da sua equipe liberar.',
    submit: 'Pedir senha nova',
  },
};

export function AuthScreen({ onLogin }: { onLogin: (me: Me) => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [directorToken, setDirectorToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setPassword('');
    setConfirm('');
    setDirectorToken('');
    setError(null);
    setNotice(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'forgot' && password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') {
        onLogin(await api<Me>('POST', '/auth/login', { email, password }));
      } else if (mode === 'forgot') {
        const result = await api<{ status: 'pending' | 'changed' }>('POST', '/auth/password-reset', {
          email,
          newPassword: password,
          ...(directorToken.trim() ? { directorToken } : {}),
        });
        switchMode('login');
        setNotice(
          result.status === 'changed'
            ? 'Senha trocada com o Token do Diretor. Entre com a senha nova.'
            : 'Pedido enviado. Avise o Diretor ou o Líder da sua equipe: quando autorizarem, entre com a senha nova.',
        );
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
    <div className="auth-split">
      <AuthBrand />
      <main className="auth account-auth">
        <header className="account-auth-heading">
          <Wordmark />
          <h1 className="auth-title">{AUTH_HEADINGS[mode].title}</h1>
          <p className="muted">{AUTH_HEADINGS[mode].text}</p>
        </header>

        <form className="card form account-auth-form" onSubmit={submit}>
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
            {mode === 'forgot' ? 'Senha nova' : 'Senha'}
            <PasswordInput
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'login' ? 1 : 12}
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode !== 'login' && <small className="muted">Mínimo de 12 caracteres.</small>}
          </label>
          {mode === 'login' && (
            <button type="button" className="link small-text account-forgot" onClick={() => switchMode('forgot')}>
              Esqueci a senha
            </button>
          )}
          {mode === 'forgot' && (
            <>
              <label>
                Confirme a senha nova
                <PasswordInput
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <details className="secondary-options">
                <summary>Tenho o Token do Diretor</summary>
                <label>
                  Token do Diretor
                  <PasswordInput
                    autoComplete="off"
                    maxLength={100}
                    value={directorToken}
                    onChange={(e) => setDirectorToken(e.target.value)}
                  />
                  <small className="muted">Com o token, a senha nova vale na hora, para qualquer conta.</small>
                </label>
              </details>
            </>
          )}
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
            {busy ? 'Aguarde…' : directorToken.trim() && mode === 'forgot' ? 'Trocar a senha agora' : AUTH_HEADINGS[mode].submit}
          </button>
        </form>

        <p className="switch account-auth-switch">
          {mode === 'login' ? (
            <>
              Não tem conta?{' '}
              <button className="link" onClick={() => switchMode('signup')}>
                Solicitar acesso
              </button>
            </>
          ) : mode === 'forgot' ? (
            <>
              Lembrou a senha?{' '}
              <button className="link" onClick={() => switchMode('login')}>
                Entrar
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
    </div>
  );
}

/**
 * Configuração inicial (ADR-004, revisão de 2026-10-28): enquanto o sistema não tem Diretor, quem tem o Token do
 * Diretor cria o primeiro pela interface.
 */
export function SetupScreen({ onLogin }: { onLogin: (me: Me) => void }) {
  const [form, setForm] = useState({
    code: '',
    displayName: '',
    email: '',
    password: '',
    confirm: '',
    testAccount: true,
    demoAccounts: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onLogin(
        await api<Me>('POST', '/setup', {
          code: form.code,
          displayName: form.displayName,
          email: form.email,
          password: form.password,
          testAccount: form.testAccount,
          demoAccounts: form.testAccount && form.demoAccounts,
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível conectar ao servidor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-split">
      <AuthBrand />
      <main className="auth account-auth account-auth-setup">
        <header className="account-auth-heading">
          <Wordmark />
          <h1 className="auth-title">Configuração inicial</h1>
          <p className="muted">O sistema ainda não tem Diretor. Crie a conta que vai administrar tudo.</p>
        </header>

        <form className="card form account-auth-form" onSubmit={submit}>
          <label>
            Token do Diretor
            <PasswordInput autoComplete="off" required maxLength={100} value={form.code} onChange={(e) => set('code')(e.target.value)} />
            <small className="muted">O token fixo entregue com o sistema. Maiúsculas, minúsculas e hífens não importam.</small>
          </label>
          <label>
            Nome
            <input
              autoComplete="name"
              required
              maxLength={120}
              value={form.displayName}
              onChange={(e) => set('displayName')(e.target.value)}
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
            />
          </label>
          <label>
            Senha
            <PasswordInput
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              value={form.password}
              onChange={(e) => set('password')(e.target.value)}
            />
            <small className="muted">Mínimo de 12 caracteres.</small>
          </label>
          <label>
            Confirme a senha
            <PasswordInput
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              value={form.confirm}
              onChange={(e) => set('confirm')(e.target.value)}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.testAccount} onChange={(e) => set('testAccount')(e.target.checked)} /> Conta de teste
            <small className="muted block-line">
              Pode ser excluída depois com um botão; aí o sistema volta para esta tela e você cria a conta definitiva.
            </small>
          </label>
          {form.testAccount && (
            <label className="check">
              <input type="checkbox" checked={form.demoAccounts} onChange={(e) => set('demoAccounts')(e.target.checked)} /> Criar também
              Líder e Usuário de teste
              <small className="muted block-line">
                Na "Equipe de Teste", com a mesma senha: lider.teste@exemplo.com e usuario.teste@exemplo.com. Todas as contas de teste saem
                juntas com um botão.
              </small>
            </label>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Aguarde…' : form.testAccount ? 'Criar Diretor de teste e entrar' : 'Criar Diretor e entrar'}
          </button>
        </form>
      </main>
    </div>
  );
}
