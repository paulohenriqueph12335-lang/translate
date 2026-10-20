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

Fase 1 implementada: cadastro pendente com aprovação, login com sessões revogáveis, hierarquia Diretor/Líder/Operador por equipe e trilha de auditoria. Fase 2: lotes com upload validado e armazenamento privado. Fase 3: tradução juramentada assistida (PDF → rascunho → revisão → aprovação → DOCX numerado), traduzida automaticamente pelo LibreTranslate local (gratuito) ou pelo DeepL Free na estrutura do original, revisada na prévia e concluída pelo Líder ou Diretor, com notificações, etiquetas e área de downloads. Ainda faltam OCR local e operação de piloto. Veja [o roadmap](docs/roadmap.md) antes de assumir que uma funcionalidade está pronta.
