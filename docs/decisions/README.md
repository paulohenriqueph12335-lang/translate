# Registro de decisões arquiteturais

Decisões que mudam limites, dependências ou operação ficam registradas como ADRs. Uma decisão substituída deve receber estado `Superseded` e apontar para a nova ADR; não se apaga o histórico.

- [ADR-001 — Monorepositório e monólito modular](001-monorepo-modular-monolith.md)
- [ADR-002 — Armazenamento S3 local com SeaweedFS](002-local-s3-storage.md)
- [ADR-003 — Sessões opacas no servidor e senhas com scrypt](003-sessions-and-passwords.md)
- [ADR-004 — Provisionamento do primeiro Diretor](004-director-bootstrap.md)
- [ADR-005 — Modelo de hierarquia e autorização](005-role-hierarchy.md)
- [ADR-006 — Lotes, upload validado e armazenamento privado](006-batch-upload-and-storage.md)
- [ADR-007 — Tradução juramentada assistida com revisão humana obrigatória](007-assisted-sworn-translation.md)
- [ADR-008 — Tradução automática com provedores gratuitos e memória de tradução](008-free-machine-translation.md)
- [ADR-009 — Leitura do layout do original para preservar a estrutura](009-source-layout.md)
- [ADR-010 — Fluxo de revisão simplificado, notificações, etiquetas e fim do uso do Claude](010-review-flow-without-ai.md)
- [ADR-011 — Trabalho por responsável, cotas de numeração e painéis por papel](011-hierarchy-numbering-dashboards.md)
- [ADR-012 — Tradutores juramentados com máscara em Word e numeração própria](012-sworn-translators-masks.md)
- [ADR-013 — Planilhas técnicas: tabelas sem bordas completas e códigos que não se traduzem](013-technical-spreadsheets.md)
- [ADR-014 — Regras de numeração por tradutor, números por planilha e painel do Supervisor](014-translator-numbering-rules.md)
- [ADR-015 — Modalidades de tradução, regras por idioma de destino e glossário das skills](015-translation-modes.md)

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
