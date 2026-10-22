# Convenções para a API

Este documento define padrões para futuras rotas. Os contratos concretos devem ser aprovados e implementados junto com cada fase; as rotas abaixo são convenções, não endpoints existentes.

## Princípios

- Prefixar recursos HTTP de produto com `/api/v1`; manter saúde operacional em `/health/*`.
- JSON UTF-8 para metadados; upload/download de arquivos usa streaming/multipart e limites explícitos.
- Nomes de recurso no plural, IDs opacos e estáveis; datas em ISO 8601 UTC.
- Validar query, path, headers e body na entrada com esquemas explícitos; rejeitar campos inesperados quando risco justificar.
- Regras de negócio e autorização vivem na camada de serviço, não no handler.
- Não expor stack trace, SQL, caminho interno, segredo, conteúdo de documento ou detalhe do provedor em erros públicos.

## Autenticação e autorização

Sessão opaca em cookie `sid` HttpOnly/SameSite=Strict, guardada como hash no banco e revogável ([ADR-003](decisions/003-sessions-and-passwords.md)). Métodos `POST`/`PUT`/`PATCH`/`DELETE` em `/api/*` exigem `X-CSRF-Protection: 1`. Toda resposta traz `X-Correlation-ID`. Rotas protegidas exigem identidade válida e autorização por ação, equipe, proprietário e recurso ([ADR-005](decisions/005-role-hierarchy.md)). Toda busca de documento/lote deve ser escopada no servidor; buscar por ID não pode contornar o escopo. Uma conta que não esteja `active` não autentica.

O primeiro Diretor é criado pela linha de comando ([ADR-004](decisions/004-director-bootstrap.md)), nunca por endpoint público ou senha padrão.

### Rotas da Fase 1

| Método e rota | Quem | Observação |
| --- | --- | --- |
| `POST /api/v1/auth/signup` | público | Sempre `202`; cria conta `pending` sem revelar e-mail existente |
| `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` | público / autenticado | Login define o cookie; contas não ativas recebem `403` |
| `GET /api/v1/auth/me` | autenticado | Usuário e associações |
| `GET /api/v1/auth/sessions`, `DELETE /api/v1/auth/sessions/:id` | autenticado | Somente sessões próprias |
| `GET /api/v1/users?status=&limit=&cursor=` | Diretor | Paginação por cursor |
| `POST /api/v1/users/:id/{approve,reject,suspend,reactivate}` | Diretor | `409` em transição inválida; suspensão revoga sessões |
| `PUT /api/v1/users/:id/org-role` | Diretor | `{ "orgRole": "director" }` ou `"member"`; nunca a si; promover remove as associações de equipe |
| `POST /api/v1/users/:id/sessions/revoke` | Diretor ou a própria pessoa | Revoga todas as sessões |
| `GET`/`POST /api/v1/teams`, `GET`/`PATCH /api/v1/teams/:id` | membros / Diretor | Lista só equipes visíveis; criar/renomear é do Diretor |
| `GET /api/v1/teams/:id/candidates?q=&assignment=any\|unassigned\|assigned&limit=&cursor=` | Diretor, Líder da equipe | Pessoas ativas fora da equipe; busca por nome/e-mail; regras de visibilidade no ADR-005 |
| `GET`/`POST /api/v1/teams/:id/members` | Diretor, Líder da equipe | `POST` aceita `{ userId, role }` ou `{ email, role }`; Líder só adiciona `operator` |
| `PATCH`/`DELETE /api/v1/teams/:id/members/:userId` | Diretor; Líder remove operadores | Alterar função é do Diretor |
| `GET /api/v1/audit-events?action=&category=&actorId=&system=true&teamId=&targetType=&targetId=&from=&to=&q=&limit=&cursor=` | Diretor (tudo); Supervisor (equipes que supervisiona) | Mais recentes primeiro; `category` é o prefixo da ação (`translation`, `user`…) |
| `GET /api/v1/audit-events/facets` | Diretor | Ações e tipos de alvo registrados, para os filtros |

### Rotas da Fase 2 ([ADR-006](decisions/006-batch-upload-and-storage.md))

| Método e rota | Quem | Observação |
| --- | --- | --- |
| `GET /api/v1/batches/limits` | autenticado | Limites e extensões aceitas, para validação prévia na interface |
| `POST /api/v1/batches` | Diretor (sem equipe); Líder | `{ teamId?, name?, translation?: { sourceLanguage, targetLanguage }, tags?: string[], files: [{ name, size }] }` (sem `translation`, PT → EN; até 10 etiquetas, gravadas em minúsculas) e cabeçalho opcional `Idempotency-Key`; `teamId` só para Líder de mais de uma equipe; `201` novo, `200` repetição; itens inválidos nascem `rejected` |
| `POST /api/v1/batches/:id/assign` | Diretor | `{ teamId }`: direciona ou redireciona o lote; auditado |
| `GET /api/v1/batches?teamId=&unassigned=true&status=open\|completed&mine=true&q=&limit=&cursor=` | escopo do ADR-006 | `unassigned` lista os lotes aguardando direcionamento (Diretor); busca sem acento no nome do lote, na pessoa e nos arquivos |
| `GET /api/v1/batches/:id` | escopo do ADR-006 | Lote com contagens e documentos |
| `PUT /api/v1/documents/:id/content` | dono do lote | Corpo `application/octet-stream`; `Content-Length` igual ao declarado; `422 DOCUMENT_REJECTED` ou `503`/`400 UPLOAD_FAILED` (reenviável) |
| `POST /api/v1/documents/:id/cancel`, `POST /api/v1/batches/:id/cancel` | Diretor, Líder da equipe | Só itens `awaiting_upload`/`upload_failed` |
| `GET /api/v1/documents/:id/original` | escopo do ADR-006 | Streaming com `Content-Disposition` seguro; auditado |
| `GET /api/v1/documents?q=&teamId=&unassigned=&batchId=&mine=&uploadedBy=&status=a,b&format=a,b&tag=&untagged=&from=&to=&translation=none\|active\|approved\|failed&limit=&cursor=` | escopo do ADR-006 | Originais com as traduções geradas de cada um (ADR-010); datas `AAAA-MM-DD` |
| `PUT /api/v1/documents/:id/tags` | quem vê o documento | `{ tags }`; auditado |
| `GET /api/v1/tags` | autenticado | Etiquetas em uso nos documentos visíveis, com contagem |

### Rotas da Fase 3 ([ADR-007](decisions/007-assisted-sworn-translation.md))

| Método e rota | Quem | Observação |
| --- | --- | --- |
| `GET /api/v1/translation-capabilities` | autenticado | `{ workerOnline, machineProvider, machineProviders, machineAvailable, translatorsReady, lastSeenAt }`: o que impede o fluxo normal |
| `PUT /api/v1/machine-translation-settings` | Diretor | `{ provider: 'libretranslate' \| 'deepl' \| 'none' }`; auditado (DeepL é externo) |
| `POST /api/v1/documents/:id/translations` | quem vê o lote | `{ sourceLanguage, targetLanguage, mode? }`; PDF, JPG, PNG, DOCX e PPTX; um trabalho ativo por documento e idioma. Normalmente desnecessário: todo documento armazenado é processado sozinho |
| `GET /api/v1/translations?status=a,b&teamId=&unassigned=&documentId=&batchId=&sourceLanguage=&targetLanguage=&tag=&documentType=&patternKnown=&approvedBy=&uploadedBy=&createdFrom=&createdTo=&approvedFrom=&approvedTo=&q=&limit=&cursor=` | quem vê o lote | Fila de trabalho e área de downloads; `q` busca arquivo, lote, tipo e número |
| `GET /api/v1/translation-facets` | autenticado | Tipos, etiquetas e quem concluiu, para os filtros |
| `GET /api/v1/translations/:id`, `…/revisions`, `…/revisions/:n` | quem vê o lote | Rascunho atual, problemas de checagem, `frame` (textos fixos para a prévia), `patternKnown` e permissões |
| `PUT /api/v1/translations/:id/draft` | quem vê o lote | `{ baseRevision, draft }`; nova revisão imutável; `409` se outra pessoa salvou antes |
| `POST /api/v1/translations/:id/submit` | quem vê o lote | "Pronta": vai para o Líder/Diretor concluir; notifica |
| `POST /api/v1/translations/:id/return` | Líder da equipe, Diretor | "Refazer": `{ comment, reprocess? }`; com `reprocess`, o documento volta para a fila; notifica |
| `POST /api/v1/translations/:id/approve` | Supervisor da equipe, Diretor | "Concluir": `{ translatorId, number, book?, sheet?, overrideReason? }` (ADR-012); justificativa obrigatória se houver erro de checagem; preenche a máscara do tradutor e libera o download; sem tradutor, `409 translator_required`; número repetido no tradutor, `409 number_taken` |
| `POST /api/v1/translations/:id/reprocess` | Líder da equipe, Diretor | Processa de novo (falha ou rascunho a refazer) |
| `POST /api/v1/translations/:id/cancel` | Líder da equipe, Diretor | |
| `GET /api/v1/translations/:id/preview?revision=&translatorId=` | quem vê o lote | DOCX de rascunho na máscara do tradutor (ou no modelo do sistema), número em branco |
| `GET /api/v1/translations/:id/final` | quem vê o lote | DOCX aprovado e imutável; auditado |
| `GET`/`POST /api/v1/glossary`, `DELETE /api/v1/glossary/:id` | leitura: membros; escrita: Líder (equipe) e Diretor | |
| `GET /api/v1/notifications?unread=true&kind=a,b&limit=&cursor=` | a própria pessoa | Notificações do fluxo (ADR-010) |
| `GET /api/v1/notifications/unread-count` | a própria pessoa | `{ unread }` |
| `GET /api/v1/sworn-translators?active=` | autenticado | Tradutores juramentados (ADR-012) |
| `POST /api/v1/sworn-translators`, `PATCH /api/v1/sworn-translators/:id` | Supervisor | `{ name, registration?, languages?, notes?, active? }` |
| `POST /api/v1/sworn-translators/:id/masks` | Supervisor | Nova edição da máscara: corpo é o `.docx` (cabeçalhos `X-File-Name` e `X-Notes` opcional); `201 { translator, inspection, edition }`; `422 FILE_INVALID` com `details.inspection` se faltar `{{texto}}` |
| `POST /api/v1/sworn-translators/:id/masks/:maskId/use` | Supervisor | Volta a usar uma edição nas próximas conclusões |
| `GET /api/v1/sworn-translators/:id/masks/:maskId` | Supervisor, Diretor | Baixa uma edição |
| `PUT /api/v1/sworn-translators/:id/reference-pdf` | Supervisor | Corpo: o PDF entregue pelo tradutor (referência) |
| `GET /api/v1/sworn-translators/:id/mask`, `…/reference-pdf` | Supervisor, Diretor | Baixa a edição em uso e o PDF de referência |
| `POST /api/v1/translations/:id/claim` | equipe do lote ou Diretor | Assume tradução sem responsável (ADR-011) |
| `PUT /api/v1/translations/:id/assignee` | Supervisor da equipe, Diretor | `{ userId }`: reatribui a alguém da equipe |
| `POST /api/v1/translations/:id/numbering-requests` | responsável, Supervisor, Diretor | `{ kind: 'change' \| 'annul', reason, number?, book?, sheet? }` (texto, como o tradutor usa) |
| `GET /api/v1/numbering-requests?status=` | Diretor: todos; Supervisor: das equipes; demais: os próprios | |
| `POST /api/v1/numbering-requests/:id/decide` | Supervisor da equipe, Diretor | `{ approve, note? }`; alteração gera nova versão do DOCX |
| `POST /api/v1/numbering-requests/:id/revert` | Diretor | Desfaz a decisão autorizada |
| `GET /api/v1/numbering?year=` | autenticado | Cota própria; Supervisor: equipes e pessoas dela; Diretor: tudo |
| `PUT /api/v1/numbering/quotas` | Diretor (organização/equipe); Supervisor (Usuários da equipe, 1–1000) | `{ year, scope, teamId?, userId?, quota \| null }` |
| `GET /api/v1/dashboards/organization?from=&to=&teamId=` | Diretor | Painel da organização |
| `GET /api/v1/dashboards/team?from=&to=&teamId=` | Supervisor da equipe, Diretor | Painel da equipe |
| `POST /api/v1/notifications/read` | a própria pessoa | `{ ids? }`; sem `ids`, marca todas |
| `GET /api/v1/translation-profiles` | autenticado | Modalidades, etapas e regras efetivas por idioma de destino ([ADR-015](decisions/015-translation-modes.md)) |
| `PUT /api/v1/translation-profiles/:mode/:target` | Supervisor, Diretor | `{ rules \| null }`; `null` volta ao padrão das skills |
| `PUT /api/v1/translations/:id/checks` | quem edita ou conclui | `{ keys, checked }`: checklist de correção, diagramação e revisão; "Pronta" exige todos (`checklist_incomplete`) |
| `POST /api/v1/translations/:id/accept` | responsável, Supervisor, Diretor | Aprovar o Word ([ADR-017](decisions/017-automatic-flow-patterns.md)): confirma o checklist, marca como pronta e, para quem conclui, conclui (com o tradutor e as páginas do envio) |
| `GET /api/v1/translations/:id/preview?format=pdf` e `/final?format=pdf` | quem vê a tradução | O mesmo Word em PDF (LibreOffice); `download=true` baixa, sem ele abre na tela |
| `GET /api/v1/setup` | público | `{ needed }`: o sistema ainda não tem Diretor ([ADR-004](decisions/004-director-bootstrap.md)) |
| `POST /api/v1/setup` | público, com o código do log da API | `{ code, email, displayName, password, testAccount?, demoAccounts? }`: cria o primeiro Diretor e já entra; recusa com Diretor existente (`409`) ou código errado (`403`) |
| `GET /api/v1/test-accounts`, `POST /api/v1/test-accounts/delete-all` | Diretor | Contas de teste ativas; excluir todas de uma vez devolve `{ removed, setupNeeded }` |
| `POST /api/v1/users/:id/delete-test-account` | a própria pessoa ou Diretor | Exclui uma conta de teste (dados pessoais, sessões e equipes); devolve `{ setupNeeded }` |
| `GET /api/v1/document-patterns` | autenticado | Tipos de documento já processados, com veredito (`can`, `review`, `cannot`) e motivos |
| `POST /api/v1/document-patterns/test?sourceLanguage=&targetLanguage=&mode=` | autenticado | Corpo: o arquivo (binário). Analisa e traduz só para o teste, sem gravar; devolve veredito, motivos, estrutura e o Word da prévia (base64) |
| `GET /api/v1/frame-models` | autenticado | Modelos de moldura do tradutor ([ADR-019](decisions/019-sworn-layout-models.md)) |
| `GET /api/v1/frame-models/:model/preview?name=&registration=&city=&state=&contact=&target=&format=` | autenticado | Exemplo do modelo em PDF ou Word |
| `POST /api/v1/sworn-translators/:id/masks/model` | Supervisor | `{ model, city, state, contact?, title? }`: gera a máscara do modelo como nova edição; a moldura sai no idioma de cada tradução |
| `POST /api/v1/translations/:id/auto-review` | quem edita | Revisão automática ([ADR-016](decisions/016-automatic-review.md)): corrige a revisão atual e devolve `{ revision, corrections, unresolved, issues }`; com correções, grava revisão de origem `review`. "Pronta" roda a mesma revisão antes de seguir |

`POST /api/v1/batches` aceita `mode` (`sworn`, `certified`, `technical`, `simple`; padrão `sworn`), `useMask` e `translatorId` (juramentada com a máscara desse tradutor, ADR-017) e qualquer par entre `pt` e `en`, `fr`, `it`, `es`. `GET /api/v1/translations` filtra por `translationMode`.

Erros de documento trazem `error.details` com `reason` (por exemplo `extension_mismatch`, `duplicate`) e, quando cabe, `retryable: true`.

## Recursos previstos

- identidade: cadastro pendente, sessão e administração conforme função;
- equipes e associações;
- lotes e itens documentais com estado por item;
- documentos/versões e downloads autorizados;
- tarefas e histórico de eventos;
- idiomas, configuração de provedor e glossários após as fases iniciais.

Não aceitar diretamente um `role` privilegiado enviado pelo cliente; atribuição exige autorização explícita e deve gerar auditoria.

## Erros

Envelope `{ "error": { "code", "message", "correlationId" } }` com mensagem segura. Usar códigos HTTP apropriados: `400` entrada inválida, `401` identidade ausente/inválida, `403` ação proibida, `404` recurso ausente ou ocultado por política, `409` conflito/estado incompatível, `413` limite de arquivo, `422` conteúdo não processável, `429` limite de taxa, `503` dependência indisponível. Não revelar existência de recurso a quem não tem acesso.

## Upload e downloads

- Limites por arquivo (50 MB), quantidade por lote (100) e total do lote (1 GB), configuráveis por ambiente ([ADR-006](decisions/006-batch-upload-and-storage.md)).
- Validar extensão permitida, assinatura/formato real e política de nomes; gerar chave de objeto no servidor, nunca usar caminho fornecido pelo cliente.
- Criar primeiro o registro rastreável e estados de processamento sem marcar sucesso antes de confirmar o objeto.
- Downloads verificam a permissão atual e usam streaming ou URL assinada de curta duração após decidir a estratégia.
- Retomada, duplicados, cancelamento e itens inválidos seguem o [ADR-006](decisions/006-batch-upload-and-storage.md).

## Idempotência, paginação e limites

Operações que criam lotes/trabalhos devem aceitar chave de idempotência ou especificar semântica equivalente para evitar duplicação em retry. Listas devem paginar, ordenar de modo determinístico e impor limites máximos. Rate limits e quotas serão configurados antes do piloto.

## Observabilidade

Cada requisição recebe correlation ID; propague para eventos e worker sem registrar conteúdo do documento nem credenciais. Erros internos devem distinguir autenticação, autorização, persistência, armazenamento, extração, tradução e reconstrução.
