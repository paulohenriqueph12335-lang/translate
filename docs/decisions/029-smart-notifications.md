# ADR-029 — Notificações por interesse, canal e responsabilidade

- Estado: Accepted
- Data: 2026-10-24
- Relacionadas: [ADR-024](024-personal-settings.md), [ADR-025](025-operational-document-flow.md)

## Decisão

O centro conserva o histórico e as não lidas. Os avisos ficam separados desse histórico: cada pessoa escolhe categorias, canais e frequência em `GET/PATCH /api/v1/notifications/preferences`. As categorias são produção/entregas, revisão, erros/emergências, atribuições, numeração e administração. Cada item informa categoria, gravidade e o motivo do aviso.

As recomendações acompanham o perfil atual. Usuários recebem a rotina da produção; Líderes e Diretores priorizam decisões, riscos e pendências, com rotina desativada inicialmente. Administração é recomendada ao Diretor. Escolhas individuais prevalecem e podem ser restauradas. Ativação e frequência compartilham os valores do endpoint legado de preferências; tema e senha continuam independentes.

Os canais são **aviso neste navegador** (`inApp`, dentro da aplicação) e **Windows/sistema** (`browser`, Notifications API). O segundo começa desligado e exige permissão local do navegador. A preferência acompanha a conta; a permissão pertence ao navegador/dispositivo. A aplicação não escolhe separadamente uma janela do Chrome e uma notificação nativa do Windows: a apresentação depende do navegador e das configurações do sistema, conforme o [padrão Notifications](https://notifications.spec.whatwg.org/). Não há Web Push, service worker de entrega nem garantia de aviso com a aplicação fechada.

O padrão é **resumo**: até um aviso agrupado por intervalo, com totais por categoria e maior gravidade. A frequência imediata tem intervalo mínimo de 60 segundos nesse modo; as outras são 5, 15 ou 60 minutos. O modo individual é uma escolha explícita, limitado a dez itens por consulta e intervalo imediato mínimo de cinco segundos. A interface consulta enquanto está aberta; temporização do navegador pode atrasar a entrega.

## Consumo, acesso e limites

`POST /api/v1/notifications/deliveries/claim` recebe `channel` e, opcionalmente, `initialize`. A primeira utilização de cada canal cria uma base silenciosa. Alterar interesses ou reativar avisos inicia outro período sem reproduzir o acervo. Marcar como lida antes do consumo retira a notificação dos avisos pendentes.

Locks da conta e marcas de consumo por evento/canal impedem repetição entre abas e sessões, inclusive quando IDs são gravados fora de ordem. Os canais têm consumo independente. O claim prepara/consome o aviso no servidor; não confirma sua exibição pelo sistema operacional. Falha de rede após o commit pode impedir a exibição, mas o evento continua no centro.

Cada claim processa até **1.000 notificações**; o restante permanece pendente para consultas posteriores. Leitura, contador, marcação e consumo revalidam conta ativa e acesso à equipe/remessa atual. Receber um evento no passado não preserva acesso após sair da equipe ou redirecionar a remessa.

Enquanto a liderança usa os avisos, uma varredura com intervalo mínimo de **15 minutos** acrescenta até **200 lembretes novos** por consulta: três reprovações, falha definitiva, fila/processamento sem avanço por 30 minutos, aprovação pendente há 24 horas, conclusão sem primeiro download por 24 horas e trabalho sem responsável por uma hora. Fila agendada para o futuro não é considerada parada. O Diretor acompanha a organização; o Líder, somente equipes que lidera. Deduplicação por condição/revisão evita lembretes repetidos. Condições já resolvidas deixam de gerar entrega, mantendo o registro histórico.

## Validação

`apps/api/src/smart-notifications.integration.test.ts` contém 14 casos: recomendações, persistência/concorrência, autenticação/CSRF, agrupamento, frequências, leitura antecipada, canais e sessões simultâneos, modo individual, 1.300 eventos, IDs fora de ordem, reativação sem acervo, acesso revogado, lembretes e condições resolvidas.

O QA local confirmou persistência das escolhas no formulário, incluindo frequência de cinco minutos e adesão a erros no canal do sistema. O navegador de testes informou canal nativo indisponível; não se afirma validação de exibição nativa no Windows.
