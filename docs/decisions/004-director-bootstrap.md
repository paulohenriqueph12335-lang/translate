# ADR-004 — Provisionamento do primeiro Diretor

- Estado: Accepted
- Data: 2026-10-16

## Contexto

O primeiro Diretor não pode ser criado por endpoint público nem por senha padrão (`docs/api-conventions.md`).

## Decisão

Um comando de linha executado por quem opera o ambiente:

```powershell
docker compose run --rm -it api corepack pnpm --filter @tradutor/api bootstrap:director --email diretor@exemplo.com --name "Nome"
```

- A senha é lida do terminal sem eco (ou da entrada padrão, quando redirecionada); nunca de argumento, variável de ambiente ou arquivo versionado.
- Em uma transação com `pg_advisory_xact_lock`, o comando recusa executar se já existir qualquer Diretor ou se o e-mail já estiver cadastrado.
- Cria o usuário `active` com `org_role = 'director'` e registra o evento de auditoria `director.bootstrapped` (sem ator).
- Diretores adicionais são promovidos por um Diretor existente pela API, com auditoria. Um Diretor não pode remover o próprio papel nem se suspender, evitando perder o último administrador.

## Consequências

- Acesso ao shell/containers do ambiente equivale a poder criar o primeiro Diretor; isso já é verdade para quem acessa o banco.
- Recuperação quando todos os Diretores perderem acesso exige intervenção operacional no banco; documentar procedimento na Fase 8.

## Alternativas consideradas

Primeiro cadastro vira Diretor (corrida e exposição pública); senha padrão no seed (proibida); variável de ambiente com senha (vaza em `docker inspect`/logs).
