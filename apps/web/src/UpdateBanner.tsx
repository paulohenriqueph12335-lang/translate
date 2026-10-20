import { useEffect, useState } from 'react';

declare const __BUILD_ID__: string;

/**
 * Avisa quando o sistema foi atualizado depois que a página foi aberta: a página antiga ainda chama endereços que
 * podem não existir mais (foi o que fez o envio de máscaras "falhar" numa aba aberta antes da atualização).
 */
export function UpdateBanner() {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    const check = () =>
      fetch('/__build', { cache: 'no-store' })
        .then((response) => (response.ok ? response.text() : null))
        .then((id) => id && id !== __BUILD_ID__ && setOutdated(true))
        .catch(() => undefined);
    void check();
    const timer = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  if (!outdated) return null;
  return (
    <div className="alert warn-box banner update-banner" role="alert">
      O sistema foi atualizado. Recarregue a página para usar a versão nova.{' '}
      <button className="small primary" onClick={() => window.location.reload()}>
        Recarregar agora
      </button>
    </div>
  );
}
