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

A API tem testes unitários das políticas, senhas e limitador, e testes de integração da Fase 1 (`apps/api/src/phase1.integration.test.ts`) contra PostgreSQL real, com casos permitidos e negados. Cada arquivo usa um banco descartável `tradutor_test_<nome>` no PostgreSQL local (`localhost:5433` ou `POSTGRES_PORT`, credenciais do `.env`) ou `TEST_DATABASE_URL`. Os testes da Fase 2 (`phase2.integration.test.ts`) usam o S3 local em `localhost:8333` com um bucket descartável `tradutor-test-<nome>` (credenciais `S3_ACCESS_KEY`/`S3_SECRET_KEY` ou os padrões do Compose) e injetam falhas de armazenamento pela interface `ObjectStorage`. Os arquivos de teste são amostras sintéticas geradas em código (`samples` em `src/test/helpers.ts`). Com o Compose em execução, rode `corepack pnpm test`. A Fase 3 tem testes de fidelidade em `packages/core` (o DOCX gerado é comparado parágrafo por parágrafo com `fixtures/historico-escolar/esperado.docx`, e as checagens usam o PDF fictício `original.pdf`) e o teste de integração `apps/api/src/phase3.integration.test.ts`. O fluxo do ADR-010 (etiquetas, aviso de tipo novo, notificações, pronta/concluir/refazer com reprocessamento, filtros, busca de documentos com as traduções geradas e filtros da auditoria) está em `apps/api/src/review-flow.integration.test.ts`. O plano de hierarquia (ADR-011: responsável, assumir e reatribuir, cotas, pedidos de número, painéis e auditoria da equipe) está em `apps/api/src/hierarchy.integration.test.ts`, e as políticas em `modules/access/policy.test.ts`. A máscara do tradutor (ADR-012) é testada em `packages/core/src/translation/mask/fill-mask.test.ts` (marcadores partidos pelo Word, fonte do parágrafo `{{texto}}`, tabelas com mesclagens, prévia e recusa sem `{{texto}}`) e o cadastro e a conclusão com tradutor em `apps/api/src/translators.integration.test.ts`. A tradução gratuita é testada com provedor simulado e, se o serviço local responder em `127.0.0.1:15050` (ou `LIBRETRANSLATE_TEST_URL`), também com o LibreTranslate real traduzindo o histórico fictício inteiro sem perder números; sem o serviço, esse teste é pulado. A leitura do layout (ADR-009) é testada em `packages/core/src/translation/layout/layout.test.ts` com os dois PDFs fictícios (tabelas, mesclagens, seções, alinhamento, assinaturas e notas) e com o DOCX do modelo. Planilhas técnicas (ADR-013) usam `fixtures/planilha-tecnica/planilha-ficticia.pdf`, gerado por `gerar.py` com dados inventados: tabela do tamanho da página, verticais só no cabeçalho, continuação sem bordas e códigos que não podem ir ao provedor. Os modelos em `fixtures/` são documentos fictícios de simulação. A CI sobe PostgreSQL e SeaweedFS e executa build, tipos, lint e testes. O ambiente local que o usuário iniciou comprovou saúde de API/PostgreSQL e execução do migrador, mas não substitui a suíte de testes de aceite.

As regras de numeração por tradutor (ADR-014) têm testes unitários em `apps/api/src/modules/numbering/rules.test.ts` (Walter, Patricia, Carla, estoque, Antonio, Vivian e leitura de CSV) e de integração em `apps/api/src/numbering-rules.integration.test.ts` (planilhas, livro que trava e troca sozinho, 2 usos em protocolos diferentes, protocolo zerado, teto da assinatura, reserva, bloqueio, avisos e painel).

As modalidades (ADR-015) têm testes unitários em `packages/core/src/translation/profiles.test.ts` (datas por idioma, números como no original, nome do arquivo, etapas e ajuste inválido) e de integração em `apps/api/src/modes.integration.test.ts` (regras por idioma, ajuste e volta ao padrão pelo Supervisor, checklist antes de "Pronta", conclusão certificada sem numeração com sufixo `-FRA` e glossário das skills sem duplicar).
