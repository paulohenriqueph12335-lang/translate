# ADR-031 — Tokens fixos, recuperação de senha, conclusão pelo responsável e nomes no ZIP

- Estado: Accepted
- Data: 2026-10-28
- Relacionadas: [ADR-003](003-sessions-and-passwords.md), [ADR-004](004-director-bootstrap.md), [ADR-007](007-assisted-sworn-translation.md)

## Contexto

O produto pediu quatro mudanças:

- um token fixo do Diretor, para criar a conta dele e autorizar a troca de senha de qualquer pessoa;
- um token fixo do Líder, para liberar por 24 horas o acesso de quem esqueceu a senha;
- o próprio Usuário conclui a tradução, e a liderança só entra em problemas de numeração;
- o ZIP leva o número da tradução e o protocolo, ou uma referência sequencial quando não há nenhum dos dois.

O sistema não envia e-mail. Por isso a recuperação passa por uma pessoa que confirma quem pediu.

## Decisão

### Tokens fixos

- Há dois tokens: o do Diretor e o do Líder. O código guarda só o SHA-256 de cada um, em `modules/identity/master-tokens.ts`. Os valores foram entregues ao responsável pelo sistema.
- `DIRECTOR_TOKEN` e `LEADER_TOKEN`, no ambiente, trocam os tokens sem mudar o código.
- A comparação ignora maiúsculas, espaços e hífens e roda em tempo constante.
- Cada token tem 24 caracteres aleatórios, cerca de 119 bits. O hash publicado não permite descobrir o valor.
- A configuração inicial passa a pedir o **Token do Diretor** no lugar do código que saía no log da API. O código do log deixa de existir. O comando de linha continua valendo.

### Esqueci a senha

- `POST /api/v1/auth/password-reset` recebe e-mail, senha nova e, se a pessoa tiver, o Token do Diretor.
- Sem token, o sistema cria um pedido pendente e responde `202` da mesma forma, exista a conta ou não.
- O pedido guarda só o hash scrypt da senha nova, apagado quando é decidido. Um pedido novo substitui o anterior.
- O pedido avisa os Diretores e os Líderes das equipes em que a pessoa é Usuário. O aviso entra na categoria "revisão".
- Com o Token do Diretor, a senha muda na hora, para qualquer conta, inclusive a de um Diretor que esqueceu a própria. As sessões caem. É o caminho quando não há outro Diretor.
- `GET /api/v1/password-resets` lista os pedidos que a pessoa pode decidir:
  - o Diretor vê todos, menos o próprio;
  - o Líder vê só os de quem é Usuário nas equipes que ele supervisiona.
- `POST /api/v1/password-resets/:id/approve` pede o token do papel de quem decide. O Líder não usa o token do Diretor, e o Diretor não usa o do Líder.
  - Quando o Diretor autoriza, a senha vale de vez e o contador de liberações volta a zero.
  - Quando o Líder libera, a senha vale por **24 horas** (`users.access_expires_at`). O login e a sessão param nesse horário. Cada liberação soma 1 em `users.leader_unlocks`. Depois de **3 liberações seguidas**, o Líder não libera mais, e só o Diretor troca a senha.
- `POST /api/v1/password-resets/:id/reject` recusa sem trocar nada.
- Token errado devolve `403` e fica na auditoria (`password_reset.token_rejected`). As tentativas usam o mesmo limite por IP da troca de senha.
- Na auditoria:
  - `password_reset.requested`, `password_reset.rejected` e `password_reset.request_ignored`;
  - `auth.password_reset`, com quem autorizou e até quando vale;
  - `auth.login_denied`, com `reason: access_expired`.
- Quem foi liberado pelo Líder vê um aviso com o fim do acesso. Ao tentar entrar depois desse horário, recebe `ACCESS_EXPIRED`.

### Conclusão pelo responsável

- A política nova é `canConcludeTranslation`. Concluem o responsável pela tradução e a liderança: o Supervisor da equipe e o Diretor. Vale para todas as modalidades.
- Quem é responsável aprova o Word e conclui no mesmo passo. Na juramentada, escolhe se conclui com ou sem tradutor.
- Nesse caso, a liderança não recebe o aviso de "pronta".
- Ficam só com a liderança:
  - devolver uma tradução pronta;
  - cancelar e reprocessar;
  - autorizar exceções de numeração, como o protocolo zero (`permissions.authorizeNumbering`);
  - decidir pedidos de alteração ou anulação de número.
- O que já impedia concluir continua valendo: numeração com problema (número repetido, fora do estoque ou fora da sequência), cotas, checklist e checagem em aberto.

### Nomes no ZIP

- Cada tradução tem uma referência sequencial, `translation_jobs.reference_number`.
- Dentro do ZIP, cada arquivo leva o número e o protocolo, por exemplo `0012-2026 – ABC-1.docx`.
- Sem número, o arquivo leva o protocolo e a referência, por exemplo `ABC-1 – Tradução 7.docx`.
- Sem número e sem protocolo, o arquivo leva só a referência: `Tradução 7.docx`.
- O nome do ZIP segue a mesma regra:
  - se o ZIP tem uma tradução só, ele leva o nome dela;
  - se todas as traduções têm o mesmo protocolo, ele leva o protocolo;
  - nos outros casos, ele se chama `Traduções N`, com `N` vindo da sequência `translation_archive_seq`.
- A busca de traduções aceita "Tradução 7" ou só "7" e encontra a tradução pela referência.

## Consequências

- Quem tem o Token do Diretor troca a senha de qualquer pessoa sem entrar no sistema. O token deve ser guardado como uma senha de administrador. Se vazar, defina `DIRECTOR_TOKEN` com um valor novo e reinicie a API.
- A identidade de quem pede a senha nova é confirmada por quem autoriza, fora do sistema. Sem isso, alguém poderia pedir uma senha nova em nome de outra pessoa.
- Os testes usam tokens próprios (`TEST_TOKENS` em `apps/api/src/test/helpers.ts`). Os tokens de verdade não ficam no repositório.
- A migração `0033` acrescenta as colunas, a tabela `password_reset_requests` e a referência sequencial das traduções existentes.

## Alternativas consideradas

- Recuperação por e-mail: precisa de um servidor SMTP, que o sistema não tem. Pode vir depois, junto com estes tokens.
- Tokens em texto no código: qualquer pessoa com acesso ao repositório os usaria.
- Código novo a cada reinício, só no log: era o modelo anterior, e o produto pediu um valor fixo.
