# Arquitetura

## Estado atual e arquitetura desejada

O código atual é uma fundação de monólito modular em um monorepositório; ainda não é o fluxo funcional do produto. A tabela diferencia o que existe do que o plano exige.

| Componente | Implementado agora | Direção planejada |
| --- | --- | --- |
| `apps/web` | React + TypeScript/Vite; login, cadastro, documentos (novo lote, envio com progresso, histórico), aprovações, usuários, equipes, auditoria e sessões; proxy `/api` | Painéis, autenticação, equipes, upload e resultados |
| `apps/api` | Fastify + TypeScript; saúde, identidade, sessões, equipes, políticas de acesso, auditoria, lotes, upload validado e download (`src/modules/*`) | Autenticação, autorização, lotes, arquivos e histórico |
| `apps/worker` | Consome a fila de traduções (`@tradutor/core/processing`): extrai o texto, lê o layout, traduz trecho a trecho e deixa o rascunho para revisão, notificando a equipe | OCR, outros formatos, checkpoints por etapa |
| `packages/core` | Banco (pool, migrações, auditoria), armazenamento S3, rascunho, checagens, extração de PDF, leitura do layout, tradução automática, gerador do DOCX juramentado, notificações e processamento | Contratos compartilhados entre API e worker |
| LibreTranslate | Serviço `translator` (modelos PT/EN), tradução automática gratuita e local (ADR-008); a estrutura do original vem da leitura do layout no worker (ADR-009) | Outros pares de idiomas conforme a demanda |
| PostgreSQL | Identidade, equipes, `audit_events` (somente inserção), `batches`, `documents` e `document_versions` (imutável) | Usuários, equipes, documentos, tarefas, eventos e auditoria |
| Armazenamento S3 | SeaweedFS local; a API grava os originais por uma interface `ObjectStorage` em bucket privado criado ao iniciar | Adaptador de objetos privados com políticas e retenção |
| Migrações | Serviço `migrate` roda `pnpm --filter @tradutor/api migrate`: arquivos em ordem, uma vez cada, com lock e transação | Migrações ordenadas e rastreadas com validação de versão |
| Worker documental | PDF digital via pdf.js, DOCX/PPTX via leitura do XML; imagens aguardam o OCR; imagem inclui Tesseract (por/eng) e LibreOffice Writer | OCR local, adaptadores DOCX e PPTX |

## Limites entre módulos

- A API autentica, valida, aplica políticas e coordena persistência; não deve processar documentos pesados durante uma requisição HTTP.
- O worker executa tarefas demoradas e deve ser seguro para reiniciar e escalar para mais de uma instância.
- PostgreSQL é a fonte de verdade para estados e metadados; objetos ficam no armazenamento S3.
- Pacotes compartilhados devem conter contratos/regras independentes dos frameworks. Criar pacotes quando a fase os exigir, evitando diretórios e abstrações vazios.
- Cada formato tem adaptador próprio sobre um modelo documental intermediário; segmentos devem manter referências suficientes para reconstrução.

## Fluxo alvo

```text
Browser → API → PostgreSQL
              ↘ armazenamento S3 (originais e resultados)
PostgreSQL/fila → worker → extração/OCR → provedor de tradução
                                  └────→ reconstrução → S3
```

A fila de traduções vive no PostgreSQL (`translation_jobs`, `FOR UPDATE SKIP LOCKED` e lease com prazo). O DOCX final é gerado pela API no momento da aprovação. Não anunciar processamento assíncrono ou recuperação como existente até os critérios da fase correspondente passarem.

## Serviços locais e portas

| Serviço | Endereço no host | Uso |
| --- | --- | --- |
| Web | `http://localhost:5173` | Interface de desenvolvimento |
| API | `http://localhost:3000` | HTTP e saúde |
| PostgreSQL | `localhost:5433` | Porta do host; dentro da rede Compose usa `postgres:5432` |
| S3 SeaweedFS | `http://localhost:8333` | Endpoint compatível com S3 |

As portas publicadas são vinculadas a `127.0.0.1`. As portas externas podem ser alteradas no `.env` quando suportadas pelo Compose.
