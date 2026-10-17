# Estratégia de testes

Testes devem ser acrescentados junto com a funcionalidade e usar documentos sintéticos ou fixtures autorizadas, sem dados pessoais reais.

## Camadas planejadas

| Tipo | Verifica |
| --- | --- |
| Unitário | Regras, validação, transições de estado e políticas de acesso |
| Integração | API/worker com PostgreSQL e armazenamento S3 |
| Contrato | Esquemas e adaptadores de provedor/formatos |
| Segurança | Isolamento de usuários/equipes, upload, sessão e downloads |
| Documental | Texto, estilos, tabelas, imagens, slides e conteúdo protegido |
| Recuperação | Retomada, idempotência, falhas e limites de retentativa |
| E2E | Fluxo de cadastro/aprovação até download |
| Carga | Concorrência, CPU, memória, tamanho de lote e documentos |

## Critérios por alteração

- Build TypeScript, tipos e lint aprovados.
- Testes do comportamento alterado e integração correspondente aprovados.
- Migrações validadas em banco limpo e persistente.
- Alterações de acesso incluem casos permitidos e negados.
- Alterações de extrator/reconstrutor incluem regressão de fixtures.
- Sem segredo, arquivo real ou conteúdo sensível nos artefatos de teste/log.

## Estado atual

A API tem testes unitários das políticas, senhas e limitador, e testes de integração da Fase 1 (`apps/api/src/phase1.integration.test.ts`) contra PostgreSQL real, com casos permitidos e negados. Cada arquivo usa um banco descartável `tradutor_test_<nome>` no PostgreSQL local (`localhost:5433` ou `POSTGRES_PORT`, credenciais do `.env`) ou `TEST_DATABASE_URL`. Com o Compose em execução, rode `corepack pnpm test`. A CI sobe PostgreSQL e executa build, tipos, lint e testes. O ambiente local que o usuário iniciou comprovou saúde de API/PostgreSQL e execução do migrador, mas não substitui a suíte de testes de aceite.
