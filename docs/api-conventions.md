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
| `PUT /api/v1/users/:id/org-role` | Diretor | `{ "orgRole": "director" }` ou `"member"`; nunca a si |
| `POST /api/v1/users/:id/sessions/revoke` | Diretor ou a própria pessoa | Revoga todas as sessões |
| `GET`/`POST /api/v1/teams`, `GET`/`PATCH /api/v1/teams/:id` | membros / Diretor | Lista só equipes visíveis; criar/renomear é do Diretor |
| `GET`/`POST /api/v1/teams/:id/members` | Diretor, Líder da equipe | Líder só adiciona `operator` |
| `PATCH`/`DELETE /api/v1/teams/:id/members/:userId` | Diretor; Líder remove operadores | Alterar função é do Diretor |
| `GET /api/v1/audit-events?action=&limit=&cursor=` | Diretor | Mais recentes primeiro |

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

- Limitar tamanho por arquivo, quantidade por lote (máximo 100) e tamanho total; definir valores exatos antes da Fase 2.
- Validar extensão permitida, assinatura/formato real e política de nomes; gerar chave de objeto no servidor, nunca usar caminho fornecido pelo cliente.
- Criar primeiro o registro rastreável e estados de processamento sem marcar sucesso antes de confirmar o objeto.
- Downloads verificam a permissão atual e usam streaming ou URL assinada de curta duração após decidir a estratégia.
- O contrato precisa definir como retomar upload, tratar duplicados, cancelamento e itens inválidos.

## Idempotência, paginação e limites

Operações que criam lotes/trabalhos devem aceitar chave de idempotência ou especificar semântica equivalente para evitar duplicação em retry. Listas devem paginar, ordenar de modo determinístico e impor limites máximos. Rate limits e quotas serão configurados antes do piloto.

## Observabilidade

Cada requisição recebe correlation ID; propague para eventos e worker sem registrar conteúdo do documento nem credenciais. Erros internos devem distinguir autenticação, autorização, persistência, armazenamento, extração, tradução e reconstrução.
