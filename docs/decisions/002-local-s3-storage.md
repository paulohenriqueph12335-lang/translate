# ADR-002 — Armazenamento S3 local com SeaweedFS

- Estado: Accepted for local development; production choice open
- Data: 2026-10-16

## Contexto

O plano original previa MinIO. Durante a configuração, o Docker Hub recusou as imagens `minio/minio` e `minio/mc`; mudar a tag não resolveu. A base precisava de armazenamento local para prosseguir.

## Decisão

Usar SeaweedFS 4.48 como implementação local da API S3, com volume Docker persistente, credenciais de desenvolvimento e porta S3 publicada apenas em loopback. A escolha não determina o armazenamento de produção.

## Consequências

- O código futuro deve depender de uma interface S3 compatível, não de APIs específicas do SeaweedFS.
- A implementação real de criação de bucket, autenticação, isolamento por organização, políticas e backup ainda precisa ser construída e testada.
- Não considerar armazenamento privado pronto apenas porque o endpoint está limitado a `127.0.0.1`; a autorização da aplicação e a configuração S3 ainda são pendências.
- Antes do piloto, validar a alternativa de produção, atualizações, recuperação e compatibilidade com o adaptador escolhido.

## Alternativas consideradas

Imagem MinIO nos registries consultados, indisponível para pull neste ambiente; armazenamento em diretório local sem API S3, que reduziria a paridade entre desenvolvimento e produção.
