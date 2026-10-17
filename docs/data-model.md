# Modelo de dados proposto

Este é um mapa de domínio para guiar o desenho das migrações. **Existem hoje** (`0002_identity`): `users`, `sessions`, `teams`, `team_memberships` e `audit_events`, conforme [ADR-005](decisions/005-role-hierarchy.md); as demais entidades ainda não existem. Ajustar cardinalidades e estados ao implementar as fases, e refletir alterações em migrações novas e testes.

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
