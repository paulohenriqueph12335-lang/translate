# Registro de decisões arquiteturais

Decisões que mudam limites, dependências ou operação ficam registradas como ADRs. Uma decisão substituída deve receber estado `Superseded` e apontar para a nova ADR; não se apaga o histórico.

- [ADR-001 — Monorepositório e monólito modular](001-monorepo-modular-monolith.md)
- [ADR-002 — Armazenamento S3 local com SeaweedFS](002-local-s3-storage.md)
- [ADR-003 — Sessões opacas no servidor e senhas com scrypt](003-sessions-and-passwords.md)
- [ADR-004 — Provisionamento do primeiro Diretor](004-director-bootstrap.md)
- [ADR-005 — Modelo de hierarquia e autorização](005-role-hierarchy.md)

## Modelo para novas decisões

```md
# ADR-NNN — Título

- Estado: Proposed | Accepted | Superseded
- Data: AAAA-MM-DD

## Contexto
## Decisão
## Consequências
## Alternativas consideradas
```
