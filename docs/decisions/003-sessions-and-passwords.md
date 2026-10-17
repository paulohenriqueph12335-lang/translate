# ADR-003 — Sessões opacas no servidor e senhas com scrypt

- Estado: Accepted
- Data: 2026-10-16

## Contexto

A Fase 1 exige login, sessões revogáveis e nenhuma permissão para contas pendentes. `docs/api-conventions.md` deixava o mecanismo de sessão em aberto.

## Decisão

- **Sessão opaca**: token aleatório de 32 bytes (base64url) entregue em cookie `sid` com `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` quando `COOKIE_SECURE=true`. O banco guarda somente o SHA-256 do token (`sessions.token_hash`).
- **Expiração**: absoluta (`SESSION_TTL_HOURS`, padrão 12h) e por inatividade (`SESSION_IDLE_MINUTES`, padrão 120). `last_seen_at` é atualizado no máximo uma vez por minuto.
- **Revogação**: logout, revogação de sessão própria, revogação de todas as sessões de um usuário pelo Diretor e suspensão revogam no banco. Cada requisição recarrega o usuário; status diferente de `active` invalida a sessão imediatamente.
- **Senhas**: `crypto.scrypt` nativo do Node (N=2^15, r=8, p=1, 64 bytes, sal de 16 bytes), formato `scrypt$N$r$p$sal$hash`. Comprimento entre 12 e 256 caracteres. Login com e-mail inexistente executa scrypt contra hash fictício para reduzir diferença de tempo.
- **CSRF**: além de `SameSite=Strict`, métodos que alteram estado exigem o cabeçalho `X-CSRF-Protection: 1`. Cabeçalho customizado força preflight entre origens, e a API não habilita CORS.
- **Limite de tentativas**: limitador em memória por processo para login e cadastro (por IP e por e-mail). Suficiente para uma instância; trocar por armazenamento compartilhado antes de escalar a API horizontalmente.

## Consequências

- Revogação é imediata, sem listas negras de JWT.
- Toda requisição autenticada faz uma consulta ao banco (sessão + usuário).
- A interface web conversa com a API pela mesma origem (proxy do Vite em `/api`), mantendo o cookie `SameSite=Strict` funcional.
- Sem dependência nativa (argon2/bcrypt), evitando scripts de build adicionais em `onlyBuiltDependencies`.

## Alternativas consideradas

JWT stateless (revogação exige lista negra ou TTL curto + refresh); argon2id (melhor parâmetro de memória, mas dependência nativa); sessão em Redis (serviço adicional sem necessidade atual).
