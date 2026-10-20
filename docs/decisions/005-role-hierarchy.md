# ADR-005 — Modelo de hierarquia e autorização

- Estado: Accepted
- Data: 2026-10-16

## Contexto

O produto prevê Diretor, Líder, Operador e cadastro pendente, com autorização por ação, equipe e objeto. O modelo de dados pede função com escopo, não um papel global único.

## Decisão

- **Organização única** nesta fase (sem tabela de organização). `users.org_role` é `director` ou `member`.
- **Funções por equipe**: `team_memberships.role` é `leader` ou `operator`. A mesma pessoa pode liderar uma equipe e operar em outra.
- **Status** do usuário: `pending` → `active` | `rejected`; `active` ⇄ `suspended`. Somente `active` autentica e recebe permissões.
- **Políticas** são funções puras em `apps/api/src/modules/access/policy.ts`, chamadas pela camada de serviço (não pelo handler):

| Ação | Diretor | Líder da equipe | Operador da equipe | Outros |
| --- | --- | --- | --- | --- |
| Aprovar/rejeitar cadastro, suspender/reativar, promover Diretor, revogar sessões de terceiros, ler auditoria | ✔ | ✘ | ✘ | ✘ |
| Criar/renomear equipe | ✔ | ✘ | ✘ | ✘ |
| Ver equipe | ✔ | ✔ | ✔ | 404 |
| Listar membros | ✔ | ✔ | ✘ (403) | 404 |
| Listar candidatos (pessoas ativas fora da equipe) | não Diretores, sem a si, com as equipes de cada pessoa | não Diretores, sem a si, só com a contagem de equipes | ✘ (403) | 404 |
| Adicionar membro | qualquer função, a outra pessoa ativa não Diretora | somente `operator`, nas mesmas condições | ✘ | 404 |
| Remover membro | qualquer outra pessoa | somente operadores (nunca líderes nem a si) | ✘ | 404 |
| Alterar função do membro | de outra pessoa | ✘ | ✘ | 404 |

- Recursos fora do escopo respondem `404` para não revelar existência; recurso visível com ação proibida responde `403`.
- Campos privilegiados (`role`, `status`, `orgRole`) nunca são aceitos no cadastro: os esquemas são estritos e rejeitam campos extras.
- **Ninguém altera o próprio cargo**: não se adiciona a equipes, não se remove delas, não muda a própria função, o próprio status nem o próprio papel na organização. Mudanças de cargo sempre vêm de um superior.
- **Diretor não ocupa cargo de equipe**: ele já administra todas as equipes, e ser Líder/Operador seria um rebaixamento. Ao ser promovida a Diretor, a pessoa perde as associações de equipe (cada remoção é auditada com `reason: promoted_to_director`). A migração `0004` aplica a regra também no banco, com triggers que recusam associação de Diretor e promoção de quem ainda tem associação.
- Revisado em 2026-10-17: antes o Diretor podia ser adicionado a equipes, inclusive por si mesmo.

## Consequências

- Para facilitar a gestão, o Líder vê a lista paginada e filtrável de pessoas ativas não Diretoras (nome e e-mail) para adicionar à própria equipe. Ele não vê contas pendentes, suspensas ou rejeitadas, nem em quais equipes cada pessoa está, apenas quantas. Revisado em 2026-10-17: antes o Líder só localizava pessoas por e-mail exato, que continua disponível para casos específicos.
- Quando houver várias organizações, `org_role` migra para uma associação usuário–organização.

## Alternativas consideradas

Papel global único (não suporta líder de uma equipe e operador em outra); RBAC genérico com tabela de permissões (abstração sem consumidor atual).
