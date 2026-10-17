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
| Adicionar membro | qualquer função | somente `operator`, usuário ativo não Diretor | ✘ | 404 |
| Remover membro | qualquer | somente operadores (nunca líderes nem a si) | ✘ | 404 |
| Alterar função do membro | ✔ | ✘ | ✘ | 404 |

- Recursos fora do escopo respondem `404` para não revelar existência; recurso visível com ação proibida responde `403`.
- Campos privilegiados (`role`, `status`, `orgRole`) nunca são aceitos no cadastro: os esquemas são estritos e rejeitam campos extras.

## Consequências

- O Líder localiza pessoas por e-mail exato ao adicionar operador; isso revela a existência de contas ativas ao Líder, aceito para a fase.
- Quando houver várias organizações, `org_role` migra para uma associação usuário–organização.

## Alternativas consideradas

Papel global único (não suporta líder de uma equipe e operador em outra); RBAC genérico com tabela de permissões (abstração sem consumidor atual).
