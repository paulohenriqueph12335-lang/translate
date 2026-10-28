# ADR-032 — Criptografia em repouso, gestão de segredos e instalação em outros lugares

- Estado: Accepted
- Data: 2026-10-28
- Relacionadas: [ADR-002](002-local-s3-storage.md), [ADR-006](006-batch-upload-and-storage.md), [ADR-008](008-free-machine-translation.md), [ADR-031](031-tokens-recovery-conclusion.md)

## Contexto

Antes desta decisão:

- os arquivos ficavam abertos no SeaweedFS;
- o texto extraído, os rascunhos e a memória de tradução ficavam abertos no PostgreSQL;
- os segredos existiam só no `.env`.

Quem copiasse um volume, um backup ou o bucket lia os documentos. O produto pediu proteção contra cópia indevida e uma forma simples de instalar o sistema para outras pessoas.

## Decisão

### Cifragem pela aplicação

A cifragem é feita pela aplicação, com AES-256-GCM. Ela não depende do disco, do PostgreSQL nem do provedor S3. O mesmo código protege o SeaweedFS local, o AWS S3, o MinIO e um PostgreSQL gerenciado.

**Arquivos no S3** (`packages/core/src/storage/object-storage.ts`):

- Cada objeto recebe uma chave própria, de 32 bytes aleatórios, embrulhada pela chave ativa.
- O IV, a etiqueta de autenticação, a chave embrulhada e o identificador da chave vão nos metadados do objeto (`x-amz-meta-tdenc-*`).
- O nome do objeto entra como dado autenticado. Um arquivo trocado de lugar não abre.
- O corpo gravado tem o mesmo tamanho do original. Por isso, `head()` e as conferências de tamanho não mudam.
- Objetos antigos, sem esses metadados, são lidos como estão até serem cifrados.

**Banco** (`packages/core/src/crypto`):

- Colunas cifradas:
  - `translation_jobs.extracted_text`;
  - em `translation_drafts`, as colunas `content`, `issues` e `corrections`;
  - `translation_format_registrations.draft`;
  - `ai_layout_combinations.sample`;
  - em `translation_memory`, as colunas `source_text` e `target_text`.
- Formato dos valores:
  - texto: `enc:v1:<chave>:<base64>`;
  - JSON: `{"$enc": "enc:v1:…"}`, na mesma coluna jsonb.
- A leitura é transparente: os conversores do `pg` para `text`, `json` e `jsonb` abrem os valores cifrados. As escritas usam `sealText`, `sealJson` e `insertDraft`.
- As contagens que os painéis usam (`error_count`, `issue_count` e `correction_count`) ficam abertas em colunas próprias (migração `0034`).
- A memória de tradução é buscada por um índice cego (`source_digest`). É um HMAC-SHA256 do par de idiomas e do trecho, com uma chave derivada da ativa por HKDF.

**O que fica aberto:** nomes de arquivo, protocolos, números, nomes de pessoas e metadados. Eles são necessários para busca, listas e auditoria.

### Chaves

- `ENCRYPTION_KEYS` traz uma ou mais chaves no formato `id:base64` (32 bytes). A primeira é a ativa; as outras só abrem dados antigos.
- `ENCRYPTION_KEYS_FILE` aponta para um arquivo no mesmo formato, como um segredo do Docker ou do Kubernetes.
- No Compose, sem `ENCRYPTION_KEYS`, o serviço `migrate` cria o arquivo na primeira subida, no volume `encryption_keys`. A API e o worker montam esse volume só para leitura.
- A API e o worker **não sobem** sem chave.
- A cada subida, o `migrate` cifra o que ainda estiver aberto e recifra o que usa chave antiga (`encryptAtRest`). Pode ser repetido sem risco.
- Rotação, com `pnpm --filter @tradutor/api encryption`:
  - `add-key` põe uma chave nova no início do arquivo;
  - `new-key` mostra uma chave para colar em `ENCRYPTION_KEYS`;
  - `rotate` recifra tudo.

  A chave antiga só sai do chaveiro depois que a rotação termina.

### Segredos de arquivo

Cada segredo pode vir de um arquivo, com `NOME_FILE`. Vale para `DATABASE_URL`, as chaves do S3, as chaves do DeepL, do Gemini e do LibreTranslate, e os dois tokens. Isso permite usar Docker secrets, Kubernetes secrets ou um cofre que monta arquivos, sem deixar segredos no `.env`.

### Instalação em outros lugares

`scripts/nova-instalacao.mjs` gera um `.env` novo com:

- senha do banco e chaves do S3 aleatórias;
- chave de criptografia própria;
- **tokens próprios do Diretor e do Líder**.

Os tokens aparecem uma vez na tela. Cada instalação fica com segredos só seus. Sem Node no computador, o script roda por um contêiner `node:22`.

## Consequências

- Perder a chave significa perder os documentos e os backups. A chave precisa de cópia fora do servidor, guardada separada dos backups do banco e do armazenamento.
- Quem tem acesso ao servidor em execução, com a chave carregada, ainda lê os dados. A cifragem protege cópias, backups, volumes e o bucket, não um servidor comprometido.
- Busca de texto livre dentro do conteúdo cifrado fica de fora. As buscas atuais usam metadados e não mudam.
- A rotação regrava os arquivos do bucket. Em bases grandes, rode `rotate` fora do horário de uso.

## Alternativas consideradas

- **Criptografia de disco ou do volume (LUKS, BitLocker, discos do provedor):** continua recomendada, mas depende de cada servidor e não protege dumps nem cópias do bucket.
- **SSE do S3:** varia entre provedores e o SeaweedFS local não oferece o mesmo recurso.
- **pgcrypto:** a chave passaria pelo SQL e poderia aparecer em logs.
- **Chave no código:** quem tivesse o repositório abriria tudo.
