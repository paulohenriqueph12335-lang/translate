# Arquitetura

## Estado atual e arquitetura desejada

O código atual é uma fundação de monólito modular em um monorepositório; ainda não é o fluxo funcional do produto. A tabela diferencia o que existe do que o plano exige.

| Componente | Implementado agora | Direção planejada |
| --- | --- | --- |
| `apps/web` | React + TypeScript/Vite; login, cadastro e painéis de aprovação, usuários, equipes, auditoria e sessões; proxy `/api` | Painéis, autenticação, equipes, upload e resultados |
| `apps/api` | Fastify + TypeScript; saúde, identidade, sessões, equipes, políticas de acesso e auditoria (`src/modules/*`) | Autenticação, autorização, lotes, arquivos e histórico |
| `apps/worker` | Processo Node, log estruturado simples e conexão/verificação PostgreSQL | Fila, extração, tradução, reconstrução, retentativas e checkpoints |
| PostgreSQL | `schema_migrations`, `users`, `sessions`, `teams`, `team_memberships`, `audit_events` (somente inserção) | Usuários, equipes, documentos, tarefas, eventos e auditoria |
| Armazenamento S3 | SeaweedFS local, compatível com S3 | Adaptador de objetos privados com políticas e retenção |
| Migrações | Serviço `migrate` roda `pnpm --filter @tradutor/api migrate`: arquivos em ordem, uma vez cada, com lock e transação | Migrações ordenadas e rastreadas com validação de versão |
| Worker documental | Imagem inclui Tesseract (por/eng) e LibreOffice Writer | Adaptadores DOCX, PDF, imagem/OCR e PPTX |

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

O projeto ainda não tem consumidor de fila, nem adaptador S3 integrado na API/worker. Não anunciar processamento assíncrono ou recuperação como existente até os critérios da fase correspondente passarem.

## Serviços locais e portas

| Serviço | Endereço no host | Uso |
| --- | --- | --- |
| Web | `http://localhost:5173` | Interface de desenvolvimento |
| API | `http://localhost:3000` | HTTP e saúde |
| PostgreSQL | `localhost:5433` | Porta do host; dentro da rede Compose usa `postgres:5432` |
| S3 SeaweedFS | `http://localhost:8333` | Endpoint compatível com S3 |

As portas publicadas são vinculadas a `127.0.0.1`. As portas externas podem ser alteradas no `.env` quando suportadas pelo Compose.
