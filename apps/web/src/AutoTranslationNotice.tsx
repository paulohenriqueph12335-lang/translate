import { api, providerLabel, type Capabilities } from './api';
import { useLoad } from './ui';

/**
 * Avisa só quando algo impede o fluxo normal (ADR-010): processamento parado ou tradução automática fora do ar. Sem
 * isso, um rascunho só com o texto original parece erro. Sem tradutor juramentado, a juramentada conclui sem máscara.
 */
export function AutoTranslationNotice({ isDirector }: { isDirector: boolean }) {
  const { data } = useLoad(() => api<Capabilities>('GET', '/translation-capabilities'), []);
  if (!data) return null;
  return (
    <>
      {!data.workerOnline && (
        <p className="alert error">
          O processamento de documentos está parado: os envios ficam na fila até ele voltar
          {isDirector ? ' (verifique "docker compose ps" e "docker compose logs worker").' : '; avise o Diretor.'}
        </p>
      )}
      {data.workerOnline && !data.machineAvailable && (
        <p className="alert warn-box">
          Tradução automática indisponível:{' '}
          {data.machineProvider === 'none' ? 'ela está desligada' : `${providerLabel[data.machineProvider]} não responde`}. Os documentos
          chegam com o texto original, no layout do original, para serem traduzidos
          {isDirector ? '. Ajuste em Configurações ou verifique "docker compose logs translator".' : '; avise o Diretor.'}
        </p>
      )}
    </>
  );
}
