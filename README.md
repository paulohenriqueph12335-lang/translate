# Tradutor Documental

Plataforma web para traduzir documentos com controle de acesso por equipe, arquivos privados, revisão humana e processamento recuperável. O ambiente local reúne API, interface, banco, armazenamento, tradutor e conversor de documentos.

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
- [Upgrade operacional: painéis, protocolos, revisão e downloads](docs/decisions/025-operational-document-flow.md)
- [Como contribuir](CONTRIBUTING.md)

## Início rápido

Requisitos: Docker Desktop com Compose v2. Para desenvolvimento fora do Docker, Node.js 22+ e Corepack.

1. Copie `.env.example` para `.env`.
2. Execute `docker compose up --build -d`.
3. Crie o primeiro Diretor conforme [operação local](docs/operations.md#primeiro-diretor).
4. Abra <http://localhost:5173>; a saúde da API fica em <http://localhost:3000/health/ready>.

No Windows, use `corepack pnpm ...` sem `corepack enable` se não tiver permissão de administrador. O PostgreSQL fica publicado em `localhost:5433`; os dados persistem em volumes Docker.

## Situação atual

O sistema oferece cadastro pendente com aprovação, sessões revogáveis, hierarquia Diretor/Líder/Operador, remessas com protocolo ou justificativa, tradução gratuita local, OCR no Docker, revisão comparativa e conclusão pela liderança. Há painéis opcionais, busca no escopo de acesso, auditoria de erros, tempos operacionais e exportação Word/PDF em ZIP. A IA permanece opcional. Consulte [o ADR-025](docs/decisions/025-operational-document-flow.md) para regras, limites e evidências do upgrade de 24/10/2026, e [o roadmap](docs/roadmap.md) para os demais itens de evolução e operação de piloto.
