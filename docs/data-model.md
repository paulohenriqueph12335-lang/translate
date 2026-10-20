# Modelo de dados proposto

Este é um mapa de domínio para guiar o desenho das migrações. **Existem hoje**: `users`, `sessions`, `teams`, `team_memberships` e `audit_events` (`0002`, [ADR-005](decisions/005-role-hierarchy.md)); `batches` (equipe opcional até o direcionamento, `0006`), `documents` e `document_versions` (`0005`, [ADR-006](decisions/006-batch-upload-and-storage.md)). Tradução juramentada (`0007`, [ADR-007](decisions/007-assisted-sworn-translation.md)): `translation_settings` (tradutor público e numeração), `translation_counters`, `translation_jobs` (fila e ciclo de revisão/aprovação), `translation_drafts` (revisões imutáveis) e `glossary_entries`. Tradução gratuita (`0009`): `translation_memory` e `machine_translation_settings`. Fluxo do ADR-010 (`0010`): `documents.tags`, `translation_jobs.pattern_known` e `document_type`, `notifications`; `teams.claude_enabled` removida. Hierarquia (`0011`, ADR-011): `translation_jobs.assignee_id`, `processed_at`, `redo_count`, `annulled_at`/`annulled_reason`, `numbering_quotas` e `numbering_requests`. Tradutores (`0012`, ADR-012): `sworn_translators` (PDF de referência no S3), `sworn_translator_masks` (edições numeradas da máscara, `0013`), `translation_jobs.mask_id`, `translation_jobs.translator_id`, `number_label`, `book_label`, `sheet_label`; `translation_settings` e `translation_counters` ficam só como histórico. As demais entidades ainda não existem. Ajustar cardinalidades e estados ao implementar as fases, e refletir alterações em migrações novas e testes.

## Entidades e relações

| Entidade | Responsabilidade | Relações/observações |
| --- | --- | --- |
| `User` | Identidade, estado e dados mínimos | Estado pendente/ativo/suspenso; credenciais e sessões protegidas |
| `Team` | Unidade de isolamento/delegação | Pertence à organização futura; possui associações com função e escopo |
| `Membership` | Usuário em equipe e função contextual | A função precisa ter escopo; não presumir um único papel global |
| `AuditEvent` | Ações administrativas e documentais relevantes | Ator, ação, alvo, instante, correlation ID; sem payload sensível |
| `Batch` | Solicitação criada pelo usuário | Dono, equipe, idiomas, totais e estado agregado calculado |
| `Document` | Item de entrada individual | Batch, dono/equipe, nome exibido, formato detectado, tamanho, hash e estado |
| `DocumentVersion` | Originais e resultados imutáveis | Chave de objeto interna, checksum, formato, tamanho, criado em; sem conteúdo binário no PostgreSQL |
| `TranslationJob` | Trabalho assíncrono por documento | Estado, etapa, tentativas limitadas, lease/checkpoint e erro tipado |
| `TranslationSegment` | Unidade de texto/rastreio no documento | Ordem, referência estrutural, texto protegido e resultado conforme retenção definida |
| `ProviderConfig` | Configuração de provedor por escopo | Referenciar segredo seguro; não guardar API key em texto/logs |
| `Glossary` / `GlossaryEntry` | Termos preferenciais por escopo/idioma | Opcional, introduzido após fluxo DOCX e contrato de tradução |

## Escopos e integridade

- Toda linha documental carrega ou herda organização, equipe e proprietário; escopo é aplicado em consultas e autorização.
- Não confiar em `team_id`, `owner_id`, função ou chave de objeto enviados pelo cliente.
- Definir chaves estrangeiras, restrições de estado, índices por consultas reais e política de exclusão/retention.
- Eventos de auditoria não devem ser alteráveis pela interface comum.
- Binários vivem no armazenamento S3; PostgreSQL guarda metadados, estados, checksums e referências não adivinháveis.

## Estados iniciais sugeridos

Revisar cada transição como uma máquina explícita. Um job pode usar:

```text
queued → validating → extracting → translating → rebuilding → completed
   │          │             │             │              │
   └──────────┴─────────────┴─────────────┴────→ failed / needs_review
queued ou etapa cancelável → cancelled
```

`retrying`/tentativas devem preservar a etapa e classificar erro temporário versus permanente. Não marcar lote concluído enquanto houver itens pendentes ou em andamento. `needs_review` comunica baixa confiança OCR ou incompatibilidade estrutural sem disfarçar como sucesso pleno.

O banco ainda não implementa esse modelo nem a fila; o diagrama é orientação para as fases 1–4.
