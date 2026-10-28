# ADR-011 — Trabalho por responsável, cotas de numeração e painéis por papel

- Estado: Accepted
- Data: 2026-10-18
- Planejamento: [docs/planejamento-hierarquia](../planejamento-hierarquia/README.md)

## Contexto

A organização definiu o que cada nível faz (Diretor, Supervisor = Líder, Usuário = Operador): o trabalho de cada usuário é dele, o Supervisor controla a numeração e os tempos da equipe, o Diretor analisa tudo por dados. As regras de cadastro **não mudam** (só o Diretor aprova contas; Diretor e Supervisor colocam pessoas na equipe como hoje).

## Decisão

### Responsável pela tradução

- `translation_jobs.assignee_id`: quem enviou o documento (o lote do Diretor nasce sem responsável e a equipe **assume**); quem inicia uma tradução manualmente também vira responsável.
- **Editar e marcar como pronta**: só o responsável e o Supervisor da equipe. O Diretor só edita o que é dele; no trabalho dos outros, **autoriza** (conclui, pede para refazer) ou **reatribui** (D4).
- **Reatribuir**: Supervisor da equipe ou Diretor, sempre para alguém da equipe do documento.
  - Revisão de 2026-10-28: o Diretor também pode reatribuir para si ("Eu (Diretor)") e passa a editar como responsável.
  - Quem perde o acesso ao documento deixa de ser responsável pelas traduções em aberto, que voltam a "Disponíveis para assumir". Isso vale para quem sai da equipe, para a remessa direcionada a outra equipe, para a conta suspensa e para quem deixa de ser Diretor. A auditoria registra `translation.released`.
  - O Diretor desfaz pedidos de número do mais recente para o mais antigo. Depois que a tradução é reaberta, a decisão não se desfaz.
- O Usuário passa a enviar documentos para a própria equipe.

### Cotas de numeração (anuais)

- `numbering_quotas` por ano: organização e equipe (Diretor) e usuário, de 1 a 1000 (Supervisor da equipe da pessoa ou Diretor). Sem cota, sem limite naquele nível.
- O número emitido conta para o **responsável**, a equipe do lote e a organização; número anulado continua contando (está no livro, D7).
- **Pronta** e **Concluir** são bloqueadas quando algum nível chegou ao limite (`409`, `reason: quota_exhausted`). Ao atingir 80% e 100%, o Supervisor (e, nos níveis de equipe e organização, o Diretor) é notificado.

### Alteração e anulação de número

- `numbering_requests`: o responsável (ou quem decide) pede **alterar** livro, folha ou número — este só para um número já emitido no ano e livre — ou **anular**, sempre com motivo; um pedido em aberto por tradução.
- Decide o Supervisor da equipe ou o Diretor. A alteração gera **nova versão do DOCX final** (a anterior fica no armazenamento); a anulação mantém o número no livro, bloqueia o download e marca a tradução como anulada.
- Decisão do Supervisor notifica o Diretor, que pode **reverter** (D3). Tudo é auditado.

### Painéis e relatórios

- **Diretor** (`GET /dashboards/organization`): concluídas e recebidas, acerto de primeira, tempo médio, participação dos idiomas (rosca), tipos de documento mais e menos traduzidos (barras ordenadas), acertos e erros por tipo (barras 100% — acerto = sem "refazer" e sem justificativa, D5), concluídas por semana, equipes e numeração.
- **Supervisor** (`GET /dashboards/team`, também do Diretor): entregas e tempo médio de revisão por pessoa, tempo de cada etapa por documento (processamento, revisão, conclusão), cotas. Marcos novos: `processed_at` e `redo_count`.
- Relatórios: exportação CSV (com BOM para o Excel) e impressão/PDF pelo navegador.

### Auditoria

O Supervisor lê a auditoria **das equipes que supervisiona**; o Usuário não lê. O Diretor continua vendo tudo.

### Telas

Tela inicial por papel: Diretor → Painel; Supervisor → Painel da equipe; Usuário → Meu workspace. Novas: Meu workspace, Histórico (números e prévia), Numeração. Na interface, Líder passa a se chamar **Supervisor** e Operador, **Usuário**.

## Consequências

- Colegas da mesma equipe veem o trabalho uns dos outros, mas não o alteram; trabalhos sem responsável aparecem em "Disponíveis para assumir".
- Sem cotas cadastradas, o sistema se comporta como antes.
- Os painéis consultam as tabelas transacionais com índices; com volume alto, entram visões agregadas (planejado).

## Alternativas consideradas

- Pré-alocar faixas de números por usuário: quebraria a sequência única do livro de traduções; a cota limita a quantidade sem fragmentar a numeração.
- Apagar número anulado: proibido pela natureza do livro; a anulação fica registrada.
