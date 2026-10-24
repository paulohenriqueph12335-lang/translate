import { api, providerLabel, type Capabilities } from './api';
import { useLoad } from './ui';

/**
 * Avisa só quando algo impede o fluxo normal (ADR-010): processamento parado, tradução automática fora do ar ou
 * nenhum tradutor juramentado com máscara (ADR-012). Sem isso, um rascunho só com o texto original parece erro.
 */
export function AutoTranslationNotice({
  isDirector,
  canManageTranslators,
  onGoTranslators,
}: {
  isDirector: boolean;
  canManageTranslators: boolean;
  onGoTranslators?: () => void;
}) {
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
      {!data.translatorsReady && (
        <p className="alert warn-box">
          Para concluir traduções juramentadas, cadastre um tradutor juramentado com a máscara em Word.{' '}
          {canManageTranslators && onGoTranslators ? (
            <button className="link" onClick={onGoTranslators}>
              Cadastrar agora
            </button>
          ) : (
            'Peça a um Supervisor para cadastrar.'
          )}
        </p>
      )}
    </>
  );
}
