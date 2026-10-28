# Modelo de dados

Atualizado em 28/10/2026. As migrações ficam em `packages/database/migrations` (`0001` a `0035`). Cada uma é aplicada uma vez, em ordem, com trava e transação. São 42 tabelas, contando `schema_migrations`.

## Por domínio

| Domínio                | Tabelas                                                                                                                                                                 | Observações                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade             | `users`, `sessions`, `password_reset_requests`                                                                                                                          | Senha com scrypt e sessão opaca com prazo e inatividade (ADR-003). Em `users`, `access_expires_at` e `leader_unlocks` controlam o acesso liberado pelo Líder. O pedido de senha guarda só o hash, até ser decidido (ADR-031). |
| Equipes                | `teams`, `team_memberships`                                                                                                                                             | Papel na equipe: `leader` ou `operator`. O Diretor fica em `users.org_role` e não ocupa cargo de equipe (ADR-005).                                                                                                            |
| Auditoria              | `audit_events`                                                                                                                                                          | Somente inserção, com ator, ação, alvo, equipe, correlation ID e metadados sem conteúdo de documento.                                                                                                                         |
| Remessas e arquivos    | `batches`, `documents`, `document_versions`                                                                                                                             | Remessa com protocolo ou justificativa, equipe opcional até o direcionamento e inspeção integral ou por amostra. Versões imutáveis com SHA-256; os binários ficam no S3 (ADR-006).                                            |
| Tradução               | `translation_jobs`, `translation_drafts`, `translation_inspections`, `translation_format_registrations`, `translation_completed_versions`, `translation_profiles`       | Fila (estado, tentativas, lease e token por tentativa), responsável, modalidade, checklist, conferências, reprovações e Word final. `reference_number` é a referência sequencial "Tradução N" (ADR-031).                      |
| Tradução automática    | `machine_translation_settings`, `translation_memory`, `glossary_entries`, `worker_heartbeats`                                                                           | Provedor escolhido pelo Diretor, memória que aprende com as conclusões e glossário da organização ou da equipe.                                                                                                               |
| Tradutores e numeração | `sworn_translators`, `sworn_translator_masks`, `numbering_imports`, `numbering_stock`, `numbering_books`, `numbering_entries`, `numbering_quotas`, `numbering_requests` | Máscaras em edições numeradas, regras de numeração por tradutor, estoque, livros, cotas anuais e pedidos de alteração ou anulação (ADR-012 e ADR-014).                                                                        |
| Formatos novos         | `pattern_trials`, `pattern_trial_reviews`, `pattern_trial_formats`                                                                                                      | Ensaios de tipos de documento ainda desconhecidos (ADR-028).                                                                                                                                                                  |
| Notificações           | `notifications`, `notification_preferences`, `notification_delivery_state`                                                                                              | Categorias, canais e frequência por pessoa (ADR-029).                                                                                                                                                                         |
| Gerenciamento AI       | `ai_settings`, `ai_skills`, `ai_user_access`, `ai_requests`, `ai_layout_combinations`, `ai_user_choice`                                                                 | Gemini opcional, com escopo restrito e escolha por pessoa (ADR-021 e ADR-022).                                                                                                                                                |
| Histórico              | `translation_settings`, `translation_counters`                                                                                                                          | Só como histórico: a numeração passou para os tradutores (ADR-012).                                                                                                                                                           |

## Regras de integridade

- Toda linha documental herda a equipe e o dono da remessa. O escopo é aplicado nas consultas e nas políticas, nunca pelo que o cliente envia.
- Chaves estrangeiras, `CHECK` de estados e índices seguem as consultas reais.
- As categorias de documento (`document_category` e `suggested_document_category`) seguem `BODY_MODELS`: são 19, com os tipos da migração `0035` (ADR-033).
- A auditoria não é alterada pela aplicação.
- O PostgreSQL guarda metadados, estados, checksums e chaves de objeto geradas no servidor. O conteúdo binário fica no S3.
- O conteúdo dos documentos fica cifrado pela aplicação (ADR-032):
  - `extracted_text`;
  - em `translation_drafts`, as colunas `content`, `issues` e `corrections`;
  - `translation_format_registrations.draft`;
  - `ai_layout_combinations.sample`;
  - o texto da memória de tradução.

  As contagens dos rascunhos ficam abertas em `error_count`, `issue_count` e `correction_count`. A memória é buscada pelo índice cego `source_digest`.

## Estados de uma tradução

```text
queued → processing → in_review → awaiting_approval → approved
   │          │            │              │
   └──────────┴────────────┴──────────────┴──→ failed / cancelled
```

- O worker leva `queued` a `processing` e depois a `in_review`, com o rascunho pronto.
- Ao ser marcada como pronta, a tradução vai para `awaiting_approval`. Quando o responsável conclui direto, ela passa por esse estado na mesma ação.
- `approved` grava o Word final. Uma tradução concluída pode ser anulada por pedido de numeração (`annulled_at`).
