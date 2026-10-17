# Operação local

## Ciclo diário

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f api worker
docker compose down
```

`docker compose down` mantém os volumes nomeados. **Não** use `docker compose down -v` para uma parada normal: isso apaga os dados persistentes locais.

## Migrações

No início, `migrate` espera o Postgres saudável e aplica, em ordem e uma única vez, os arquivos de `packages/database/migrations/` ainda ausentes de `schema_migrations`. A execução pontual termina com status `Exited` quando conclui. Para aplicar explicitamente: `docker compose run --rm migrate`. Toda mudança de schema deve ter migração SQL nova e revisada; não reescrever migração aplicada em ambiente persistente.

## Primeiro Diretor

Com a stack em execução, crie o primeiro Diretor. A senha é pedida sem eco, e o comando recusa se já existir Diretor:

```powershell
docker compose run --rm -it api corepack pnpm --filter @tradutor/api bootstrap:director --email diretor@exemplo.com --name "Nome do Diretor"
```

Entre em <http://localhost:5173>. Novos cadastros ficam pendentes até um Diretor aprovar em **Aprovações**. Veja [ADR-004](decisions/004-director-bootstrap.md).

## Saúde e diagnóstico

- API viva: `http://localhost:3000/health/live`.
- API pronta, incluindo conexão Postgres: `http://localhost:3000/health/ready`.
- Estado de containers: `docker compose ps`.
- Logs: `docker compose logs --tail=200 api worker postgres object-storage migrate`.
- Problema de pull com `docker-credential-desktop`: corrija a configuração do cliente Docker ou defina `DOCKER_CONFIG` para configuração temporária sem helper para pulls públicos. Isso não fornece credenciais para registries privados.
- Porta ocupada: ajuste a porta de host no `.env`; não altere a porta interna sem atualizar os endereços de rede Compose.
- `corepack enable` dá `EPERM` em `C:\Program Files\nodejs`: use `corepack pnpm ...` diretamente no diretório do projeto.

## Persistência e recuperação

Volumes atuais: `postgres_data` e `object_storage_data`. Eles sobrevivem a `docker compose down`. Não existe rotina automatizada de backup/restore ainda. Antes de atualizar volumes com dados importantes, exporte cópia independente; a estratégia formal entra na fase 8.

## Segredos locais

`.env` deve permanecer fora do Git. Os valores exemplo são públicos e não devem ser reutilizados em máquina compartilhada, rede ou implantação. Rotacione valores se houver exposição.
