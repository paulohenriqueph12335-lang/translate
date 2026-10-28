# Arquitetura

Atualizado em 28/10/2026.

## Componentes

| Componente          | O que faz                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | React 19, Vite 7 e Tailwind 4. Telas de entrada, Início, Traduções, Equipe, Ajustes, Administração, Notificações, Tutorial e Configurações. Proxy `/api` na mesma origem, para o cookie `SameSite=Strict` (ADR-003).                                                        |
| `apps/api`          | Fastify 5 e Zod 4. Identidade, sessões, tokens fixos e recuperação de senha, equipes, remessas, upload, traduções, numeração, tradutores, entregas e ZIP, painéis, notificações, auditoria e Gerenciamento AI. Rotas em `src/http/routes.ts` e serviços em `src/modules/*`. |
| `apps/worker`       | Consome a fila de traduções (`@tradutor/core/processing`): OCR, leitura do layout, tradução automática, revisão automática e rascunho para revisão. Também envia batimentos de saúde (`worker_heartbeats`).                                                                 |
| `packages/core`     | Banco (pool, migrações, auditoria e notificações), armazenamento S3, extração de PDF, DOCX e PPTX, OCR, modelos de corpo e de moldura, gerador do Word e processamento da fila.                                                                                             |
| `packages/database` | 34 migrações SQL em ordem, aplicadas uma vez cada pelo serviço `migrate`.                                                                                                                                                                                                   |
| PostgreSQL 17       | Fonte da verdade de estados e metadados. A fila usa `FOR UPDATE SKIP LOCKED`, com lease renovado.                                                                                                                                                                           |
| SeaweedFS (S3)      | Bucket privado para originais, máscaras e Word finais, cifrados pela aplicação (ADR-032).                                                                                                                                                                                   |
| LibreTranslate      | Tradução automática gratuita e local (PT, EN, FR, IT e ES).                                                                                                                                                                                                                 |
| Gotenberg           | Conversão de Word para PDF, para a prévia e para as entregas em PDF.                                                                                                                                                                                                        |

## Limites entre módulos

- A API autentica, valida e aplica as políticas. Não processa documentos pesados durante a requisição; a conclusão gera o Word final.
- O worker executa as tarefas demoradas e pode ser reiniciado e escalado: cada tentativa leva um token próprio e um lease.
- O PostgreSQL guarda estados e metadados; os arquivos ficam no S3.
- As regras de acesso ficam em funções puras (`policy.ts`), testadas à parte.

## Fluxo de um documento

```text
Browser → API → PostgreSQL (remessa, documento, trabalho na fila)
              ↘ S3 (original)
worker → OCR / leitura do layout → LibreTranslate → revisão automática → rascunho
Browser → revisão lado a lado → conclusão (responsável ou liderança) → Word final no S3 → download ou ZIP
```

## Serviços locais e portas

| Serviço      | Endereço no host        | Uso                                            |
| ------------ | ----------------------- | ---------------------------------------------- |
| Web          | `http://localhost:5173` | Interface                                      |
| API          | `http://localhost:3000` | HTTP e saúde (`/health/live`, `/health/ready`) |
| PostgreSQL   | `localhost:5433`        | Na rede do Compose, `postgres:5432`            |
| S3 SeaweedFS | `http://localhost:8333` | Endpoint compatível com S3                     |

As portas publicadas ficam presas a `127.0.0.1`. Os serviços do Compose rodam em modo de desenvolvimento (`tsx watch` e o servidor do Vite). Imagens de produção ainda estão no roadmap.
