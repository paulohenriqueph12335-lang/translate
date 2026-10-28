import { useState, type FormEvent } from 'react';
import { api, type PasswordResetItem } from './api';
import { PasswordInput } from './AuthScreen';
import { dateTime, Feedback, message, Section, useLoad } from './ui';

/**
 * Pedidos de senha nova (2026-10-28). O Diretor autoriza de vez com o Token do Diretor. O Líder libera o Usuário da
 * equipe por 24 horas com o Token do Líder, até 3 vezes seguidas; depois, só o Diretor.
 */
export function PasswordRequests({ isDirector, onChange }: { isDirector: boolean; onChange?: () => void }) {
  const { data, error, reload } = useLoad(() => api<{ items: PasswordResetItem[] }>('GET', '/password-resets'), []);
  const [feedback, setFeedback] = useState<{ error?: string; ok?: string }>({});
  const [open, setOpen] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(item: PasswordResetItem, action: 'approve' | 'reject', event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ accessUntil: string | null }>(
        'POST',
        `/password-resets/${item.id}/${action}`,
        action === 'approve' ? { token } : undefined,
      );
      setFeedback({
        ok:
          action === 'reject'
            ? `Pedido de ${item.user.name} recusado. A senha continua a mesma.`
            : result.accessUntil
              ? `${item.user.name} pode entrar com a senha nova até ${dateTime(result.accessUntil)}.`
              : `Senha de ${item.user.name} trocada. A pessoa já pode entrar com a senha nova.`,
      });
      setOpen(null);
      setToken('');
      reload();
      onChange?.();
    } catch (caught) {
      setFeedback({ error: message(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Pedidos de senha"
      subtitle={
        isDirector
          ? 'Quem esqueceu a senha pede uma nova. Confirme com a pessoa e autorize com o Token do Diretor: a senha nova vale de vez.'
          : 'Quem esqueceu a senha pede uma nova. Confirme com a pessoa e libere com o Token do Líder: o acesso vale 24 horas, até 3 vezes seguidas. Depois, só o Diretor troca a senha.'
      }
    >
      <Feedback error={error ?? feedback.error ?? null} ok={feedback.ok ?? null} />
      {data && data.items.length === 0 && <p className="empty">Nenhum pedido de senha aguardando.</p>}
      <ul className="list password-requests">
        {data?.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.user.name}</strong>
              <span className="muted">
                {item.user.email} · {item.user.role}
                {item.user.teams.length ? ` em ${item.user.teams.join(', ')}` : ''} · pedido {dateTime(item.createdAt)}
              </span>
              {item.leaderUnlocks > 0 && (
                <span className="muted small-text block-line">
                  Liberada pelo Líder {item.leaderUnlocks} de 3 vezes
                  {item.accessExpiresAt
                    ? new Date(item.accessExpiresAt).getTime() > Date.now()
                      ? `; o acesso atual vale até ${dateTime(item.accessExpiresAt)}`
                      : `; o último acesso terminou em ${dateTime(item.accessExpiresAt)}`
                    : ''}
                  .
                </span>
              )}
              {!item.authorizeAs && (
                <span className="muted small-text block-line">O Líder já liberou 3 vezes seguidas. Agora só o Diretor troca a senha.</span>
              )}
              {open === item.id && item.authorizeAs && (
                <form className="form password-request-form" onSubmit={(event) => run(item, 'approve', event)}>
                  <label>
                    {item.authorizeAs === 'director' ? 'Token do Diretor' : 'Token do Líder'}
                    <PasswordInput autoComplete="off" required maxLength={100} value={token} onChange={(e) => setToken(e.target.value)} />
                    <small className="muted">
                      {item.authorizeAs === 'director'
                        ? 'A senha que a pessoa pediu passa a valer de vez.'
                        : 'A senha que a pessoa pediu vale por 24 horas. Depois, o acesso para até nova liberação.'}
                    </small>
                  </label>
                  <div className="actions">
                    <button className="primary small" disabled={busy}>
                      {item.authorizeAs === 'director' ? 'Autorizar senha nova' : 'Liberar por 24 horas'}
                    </button>
                    <button
                      type="button"
                      className="small"
                      onClick={() => {
                        setOpen(null);
                        setToken('');
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
            {open !== item.id && (
              <div className="actions">
                {item.authorizeAs && (
                  <button
                    className="primary small"
                    onClick={() => {
                      setOpen(item.id);
                      setToken('');
                      setFeedback({});
                    }}
                  >
                    {item.authorizeAs === 'director' ? 'Autorizar' : 'Liberar 24 h'}
                  </button>
                )}
                <button className="danger small" disabled={busy} onClick={() => run(item, 'reject')}>
                  Recusar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
