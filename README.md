# Tradutor Documental

Plataforma web planejada para traduzir documentos com controle de acesso por equipe, arquivos privados e processamento recuperável. O repositório contém a fundação técnica local; as funcionalidades do produto ainda serão implementadas por fases.

## Comece aqui

- [Visão do projeto e escopo](docs/project-overview.md)
- [Arquitetura atual e alvo](docs/architecture.md)
- [Convenções de API](docs/api-conventions.md)
- [Modelo de dados proposto](docs/data-model.md)
- [Decisões de arquitetura](docs/decisions/README.md)
- [Plano de desenvolvimento e aceite](docs/roadmap.md)
- [Configuração do ambiente](docs/development.md)
- [Segurança e privacidade](docs/security.md)
- [Operação local](docs/operations.md)
- [Estratégia de testes](docs/testing.md)
- [Como contribuir](CONTRIBUTING.md)

## Início rápido

Requisitos: Docker Desktop com Compose v2. Para desenvolvimento fora do Docker, Node.js 22+ e Corepack.

1. Copie `.env.example` para `.env`.
2. Execute `docker compose up --build -d`.
3. Crie o primeiro Diretor conforme [operação local](docs/operations.md#primeiro-diretor).
4. Abra <http://localhost:5173>; a saúde da API fica em <http://localhost:3000/health/ready>.

No Windows, use `corepack pnpm ...` sem `corepack enable` se não tiver permissão de administrador. O PostgreSQL fica publicado em `localhost:5433`; os dados persistem em volumes Docker.

## Situação atual

Fase 1 implementada: cadastro pendente com aprovação, login com sessões revogáveis, hierarquia Diretor/Líder/Operador por equipe e trilha de auditoria. Ainda faltam uploads, fila de trabalhos, tradução e adaptadores documentais. Veja [o roadmap](docs/roadmap.md) antes de assumir que uma funcionalidade está pronta.
