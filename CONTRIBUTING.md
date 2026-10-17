# Como contribuir

## Antes de começar

Leia [visão do projeto](docs/project-overview.md), [arquitetura](docs/architecture.md), [roadmap](docs/roadmap.md) e decisões em `docs/decisions/`. Confirme em que fase está trabalhando e não marque capacidade planejada como implementada.

## Padrões

- TypeScript estrito; validar entradas na fronteira.
- Mantenha regra de negócio fora de controlador e detalhes de framework.
- Crie abstrações/pacotes compartilhados quando houver um contrato ou consumidor real.
- Uma alteração de schema inclui migração SQL nova.
- Uma alteração arquitetural relevante inclui ADR.
- Atualize documentos quando mudar comandos, limites, portas, políticas ou comportamento.
- Não inclua segredos, documentos de usuários ou fixtures sem autorização.

## Revisão local

```powershell
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

Adicione e execute os testes adequados à mudança. Revise `git diff`, lockfile e `.env` antes de enviar a alteração.
