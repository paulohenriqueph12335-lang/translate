# ADR-023 — Navegação compacta por papel

- Estado: Accepted
- Data: 2026-10-22
- Relacionadas: [ADR-011](011-hierarchy-numbering-dashboards.md) (painéis por papel), [ADR-017](017-automatic-flow-patterns.md), [ADR-021](021-ai-governance.md), [ADR-022](022-ai-choice-comparison.md)

## Contexto

O menu tinha chegado a 19 itens para o Diretor, 15 para o Supervisor e 11 para o Usuário. Vários faziam a mesma coisa
por caminhos diferentes ("Meu workspace", "Traduções", "Envios", "Histórico" e "Downloads"; "Painel" e "Painel das
equipes"), e o Usuário via telas de administração que não usa. Pediu-se compactar: o Usuário só traduz e vê o próprio
histórico; Supervisor e Diretor ficam com todas as opções, organizadas por objetivo e sem redundância.

## Decisão

Poucas áreas no menu; as telas parecidas viram abas dentro delas (o título da tela não se repete dentro da aba).
Notificações e Minhas sessões ficam no rodapé do menu, com o contador de não lidas.

| Área | Abas | Usuário | Supervisor | Diretor |
| --- | --- | --- | --- | --- |
| Início | Organização (Diretor), Equipe(s), Com IA × sem IA | — | ✔ | ✔ |
| Traduzir / Traduções | Meu trabalho, Da equipe (Todas, no Diretor), Enviar documentos, Concluídas | Meu trabalho e Enviar | ✔ | ✔ |
| Meu histórico | — | ✔ | — (em Traduções → Concluídas) | — |
| Equipe(s) | Pessoas, Numeração, Tradutores juramentados, Auditoria | — | ✔ | ✔ |
| Ajustes | Glossário, Regras, Tipos de documento, IA, Tradução automática (Diretor) | — | ✔ | ✔ |
| Administração | Cadastros pendentes, Usuários | — | — | ✔ |

- Tela inicial: Início para a liderança, Traduzir para o Usuário. Abrir uma tradução (de qualquer lista ou notificação)
  leva à aba de traduções da própria área.
- O comparativo Com IA × sem IA saiu do workspace e foi para o Início da liderança; a escolha Com IA / Sem IA de cada
  pessoa continua no Meu trabalho.

## Consequências

- Diretor: 19 → 5 itens; Supervisor: 15 → 4; Usuário: 11 → 2. Nenhuma função foi removida.
- A restrição do Usuário é de navegação: as permissões da API (ADR-005, ADR-011) continuam as mesmas.
