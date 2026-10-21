# ADR-022 — Escolha com IA ou sem IA por pessoa e comparação dos protocolos

- Estado: Accepted
- Data: 2026-10-21
- Relacionadas: [ADR-021](021-ai-governance.md) (Gerenciamento AI)

## Contexto

Pediu-se que cada pessoa escolha, na própria área, trabalhar com ou sem IA, com a escolha vinculada a ela e registrada
na auditoria; e que o Diretor e os Supervisores vejam, no workspace, os protocolos com IA × sem IA num gráfico dinâmico.

## Decisão

- **Escolha da pessoa** (`ai_user_choice`), em Meu workspace: "Com IA" (padrão, sem registro) ou "Sem IA". Cada troca
  grava `ai.choice_set` na auditoria com a escolha nova e a anterior. Sem IA, o Auxílio da IA sai das traduções dela
  (os pedidos respondem 409 e não entram no registro de chamadas, porque não são bloqueio) e o worker não pede
  sugestões de diagramação em segundo plano para ela.
- **Modo do protocolo** (`translation_jobs.ai_mode`): gravado por gatilho na criação, pela situação de quem pediu a
  tradução naquele momento: com IA só se a IA está ligada, a pessoa não foi limitada pela liderança e escolheu com IA.
  Trocar a escolha depois não muda protocolos já criados. Os anteriores contam como sem IA, salvo os que já tiveram
  resposta da IA.
- **Comparação** (`GET /dashboards/ai-comparison`): Diretor (organização ou uma equipe) e Supervisores (equipes que
  supervisionam ou uma delas). Métricas por lado: recebidos, concluídos, em andamento, acerto de primeira (concluída
  sem refazer e sem justificativa) e tempo até concluir, semana a semana, mais as chamadas à IA do período.
- **Gráfico** no Meu workspace do Diretor e dos Supervisores: colunas lado a lado por semana (com IA em azul, sem IA em
  laranja), com a métrica, o período (30 dias, 90 dias, 6 meses ou datas) e a equipe escolhidos na hora, totais e
  diferença de cada lado, dica ao passar o mouse, tabela e CSV; atualiza a cada minuto.

## Consequências

- A comparação reflete a escolha, não o uso efetivo de cada botão: um protocolo "com IA" pode não ter chamado a IA.
  O número de chamadas do período aparece ao lado para dar essa medida.
- O protocolo pertence a quem pediu a tradução; se outra pessoa assumir, o modo não muda.
