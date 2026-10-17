# Configuração de desenvolvimento

## Requisitos

- Docker Desktop atualizado, Docker Compose v2 e acesso ao registry configurado.
- Para comandos locais: Node.js 22+ e Corepack.
- pnpm fixado em `package.json` como `pnpm@10.18.3`; não atualize major sem revisar o lockfile e CI.

## Primeiro início via Docker

1. Copie `.env.example` para `.env` (`Copy-Item .env.example .env` no PowerShell).
2. Deixe `DOCKER_CONFIG` apontar para a configuração válida do Docker se sua instalação não tiver o credential helper configurado.
3. Execute `docker compose up --build -d`.
4. Consulte `docker compose ps` e `docker compose logs -f api worker`.
5. Abra <http://localhost:5173> e confira <http://localhost:3000/health/ready>.

Compose inicia PostgreSQL e armazenamento, executa o serviço pontual de migração e depois a API/worker/interface. O serviço `migrate` aparece `Exited` após conclusão normal; verifique o código de saída/log se houver dúvida.

## Desenvolvimento local com recarga automática

Em outro terminal, na raiz:

```powershell
corepack pnpm install
corepack pnpm dev
```

Não é necessário `corepack enable` no Windows se ele não puder gravar em `Program Files`. Corepack usa a versão declarada no projeto. `pnpm.onlyBuiltDependencies` lista scripts de dependência aprovados; não aprove scripts adicionais sem revisar a necessidade.

## Comandos de verificação

```powershell
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

Use estes comandos conforme o pacote e o escopo estiverem implementados. Não trate comandos sem testes reais como evidência de cobertura.

## Portas e configuração

- Web `5173`, API `3000`, PostgreSQL no host `5433` (container `5432`) e S3 local `8333`.
- Os serviços publicados ficam presos ao loopback. Troque portas pelo `.env` se houver conflito.
- `.env.example` contém somente valores locais demonstrativos. `.env` é ignorado pelo Git.
- Os containers usam a rede interna do Compose; neles o banco é `postgres:5432` e o S3 é `object-storage:8333`.

## Dependências e lockfile

`pnpm-lock.yaml` é a fonte de versões reproduzíveis. Alterações de dependência devem ser feitas pelo pnpm e o lockfile deve acompanhar o commit. Imagens Docker usam instalação congelada pelo lockfile. A CI verifica build, tipos e lint.
