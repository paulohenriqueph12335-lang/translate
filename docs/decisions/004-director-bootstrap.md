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

### Revisão de 2026-10-22: configuração inicial pela interface

O comando exigia digitar a senha sem eco num terminal, o que travava no PowerShell de quem só quer usar o sistema. Passa a
existir também a **configuração inicial** no navegador, sem abrir mão do que o ADR exige (nada de endpoint público nem
senha padrão):

- Enquanto não há Diretor, a API gera um **código de uso único** (8 caracteres sem letras ambíguas, ex.: `K7QF-2M9P`) e o
  escreve só no próprio log (Docker Desktop → Containers → translate → api → Logs, ou `docker compose logs api`). Quem
  vê o log já opera o ambiente, como no comando.
- `GET /api/v1/setup` diz se falta Diretor; `POST /api/v1/setup` cria o Diretor com o código, pelo mesmo
  `bootstrapDirector` (trava, recusa se já houver Diretor ou e-mail) e já entra. Tentativas limitadas por IP; 10 códigos
  errados trocam o código. Auditoria: `director.bootstrapped` com `via: web` e `setup.code_rejected`.
- O código muda a cada reinício da API e deixa de valer assim que existe Diretor.
- **Conta de teste** (`users.test_account`): marcada na configuração inicial, pode ser excluída pela própria pessoa ou por
  um Diretor (`POST /api/v1/users/:id/delete-test-account`). Nome, e-mail, senha, sessões e equipes saem; a conta deixa
  de ser Diretor (`deleted_at`, `status = rejected`) e some da lista de usuários; a auditoria e o que ela fez ficam. Sem
  Diretor, a configuração inicial volta com um código novo. Contas definitivas não são excluídas por aqui.

O comando de linha continua valendo.

## Consequências

- Acesso ao shell/containers do ambiente equivale a poder criar o primeiro Diretor; isso já é verdade para quem acessa o banco.
- Recuperação quando todos os Diretores perderem acesso exige intervenção operacional no banco; documentar procedimento na Fase 8.

## Alternativas consideradas

Primeiro cadastro vira Diretor (corrida e exposição pública); senha padrão no seed (proibida); variável de ambiente com senha (vaza em `docker inspect`/logs).
