# ADR-006 — Lotes, upload validado e armazenamento privado

- Estado: Accepted
- Data: 2026-10-17

## Contexto

A Fase 2 exige lotes de até 100 arquivos com estado individual, limites de tamanho e formato, objetos privados e histórico, sem que uma falha deixe um item aparentemente concluído. `docs/api-conventions.md` pedia valores exatos, política de duplicados, retomada e cancelamento antes da implementação.

## Decisão

### Fluxo em duas etapas

1. `POST /api/v1/batches` com `Idempotency-Key` declara a lista de arquivos (nome e tamanho) e, para o Líder de mais de uma equipe, a equipe. A API valida quantidade, extensão, tamanho por arquivo e total, e cria o lote e um documento `awaiting_upload` por arquivo. A mesma chave enviada de novo pela mesma pessoa devolve o lote já criado.
2. `PUT /api/v1/documents/:id/content` recebe o arquivo bruto (`application/octet-stream`). Cada documento é enviado e validado de forma independente, o que permite reenviar só o que falhou.

### Validação do conteúdo

- O corpo é gravado em arquivo temporário com limite de bytes, enquanto o SHA-256 é calculado. O `Content-Length` precisa ser igual ao tamanho declarado.
- O formato real é detectado pela assinatura, nunca pelo `Content-Type` do cliente: PDF (`%PDF-`), PNG, JPEG e ZIP. Um ZIP só é aceito como DOCX ou PPTX se o diretório central contiver `[Content_Types].xml` e `word/document.xml` ou `ppt/presentation.xml`. Um contêiner OLE (Office protegido por senha ou formato legado) é rejeitado.
- A extensão declarada precisa corresponder ao formato detectado (`.jpg` e `.jpeg` equivalem).
- Conteúdo idêntico (mesmo SHA-256) já armazenado no mesmo lote é rejeitado como `duplicate`. Entre lotes diferentes é permitido.

### Limites (configuráveis por ambiente)

| Variável | Padrão |
| --- | --- |
| `UPLOAD_MAX_FILE_MB` | 50 MB por arquivo |
| `UPLOAD_MAX_BATCH_FILES` | 100 arquivos por lote (teto do produto) |
| `UPLOAD_MAX_BATCH_MB` | 1024 MB por lote |

### Estados do documento

```text
awaiting_upload → uploading → stored
        │             ├────→ rejected      (formato, extensão, tamanho, vazio, duplicado: definitivo)
        │             └────→ upload_failed (armazenamento ou conexão: pode reenviar)
        └── (e upload_failed) → cancelled
```

- Um documento só fica `stored` depois que o objeto é gravado, conferido com `HeadObject` (tamanho igual) e a versão `original` é registrada no banco.
- Um `uploading` sem conclusão há mais de 15 minutos (queda do processo ou da conexão) pode ser reenviado.
- O estado do lote é calculado a partir dos documentos (`open` enquanto houver item pendente, em envio ou com falha reenviável; `completed` quando todos são finais), nunca armazenado.

### Armazenamento

- Uma interface `ObjectStorage` isola o S3 (ADR-002). As chaves são geradas no servidor: `batches/{batchId}/documents/{documentId}/original`. A chave não inclui a equipe, para que direcionar ou redirecionar um lote não exija mover objetos. O nome enviado pelo cliente é só metadado de exibição.
- O bucket é privado (o SeaweedFS recusa acesso anônimo com 403) e é criado pela API ao iniciar, se ainda não existir. A prontidão (`/health/ready`) verifica banco e armazenamento.
- O download passa pela API: a permissão é reavaliada a cada requisição, o conteúdo é transmitido em streaming com `Content-Disposition` seguro e o acesso é auditado. URLs assinadas ficam para quando houver necessidade de volume.

### Fluxo por papel (revisado em 2026-10-17)

- **Diretor** envia lotes que nascem **sem equipe** ("aguardando direcionamento"). Só o Diretor vê esses lotes até direcioná-los (`POST /api/v1/batches/:id/assign`). Ele também pode redirecionar um lote para outra equipe depois; cada mudança é auditada (`batch.assigned`, com origem e destino).
- **Líder** envia lotes que vão **direto para a equipe que lidera**. Se liderar mais de uma, escolhe a equipe.
- **Operadores** não criam lotes: trabalham com **todos** os documentos da equipe (ver, baixar e, nas próximas fases, traduzir).

### Autorização (complementa o ADR-005)

| Ação | Diretor | Líder da equipe do lote | Operador da equipe do lote | Outros |
| --- | --- | --- | --- | --- |
| Criar lote | sem equipe | na equipe que lidera | ✘ | ✘ |
| Ver lote, documentos e baixar | ✔ (inclusive sem equipe) | ✔ | ✔ | 404 |
| Enviar conteúdo | só nos próprios lotes | só nos próprios lotes | ✘ (403) | 404 |
| Cancelar documento ou lote | ✔ | ✔ | ✘ (403) | 404 |
| Direcionar ou redirecionar lote | ✔ | ✘ (403) | ✘ (403) | 404 |

- O acesso de quem não é Diretor exige associação **atual** à equipe do lote: quem sai da equipe perde acesso aos lotes dela, inclusive aos que criou.
- Antes da revisão, o Operador criava lotes e via só os próprios; o Diretor criava lotes já em uma equipe. A migração `0006_batch_routing` torna a equipe opcional e registra quem direcionou e quando.

## Consequências

- O disco temporário da API precisa comportar uploads simultâneos de até 50 MB cada. Os arquivos temporários são removidos ao fim de cada requisição, com sucesso ou erro.
- Itens rejeitados não geram objeto no armazenamento. Uma falha entre gravar o objeto e registrar a versão pode deixar um objeto órfão; a limpeza de órfãos entra na política de retenção da Fase 8.
- A detecção de PDF protegido por senha e a inspeção profunda do conteúdo ficam para as fases dos adaptadores (3, 5 e 6).

## Alternativas consideradas

Upload multipart de vários arquivos numa requisição (uma falha afeta todo o lote e dificulta o reenvio); URL pré-assinada direto ao S3 (o conteúdo não é validado antes de virar objeto); confiar na extensão ou no `Content-Type` (proibido por `docs/security.md`).
