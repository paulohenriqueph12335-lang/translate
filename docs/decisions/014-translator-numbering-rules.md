# ADR-014 — Regras de numeração por tradutor, números por planilha e painel do Supervisor

- Estado: Accepted
- Data: 2026-10-19
- Relacionadas: [ADR-011](011-hierarchy-numbering-dashboards.md) (cotas anuais e pedidos de alteração), [ADR-012](012-sworn-translators-masks.md) (tradutores com máscara)

## Contexto

Cada tradutor juramentado numera de um jeito, e os números chegam por planilha. Até aqui, quem concluía digitava número, livro e folha em texto livre, só com a regra "não repetir no mesmo tradutor". A organização definiu as regras de cada tradutor (Walter, Patricia, Jeferson, Carla, Bruno B., Antonio Dari, Vivian) e quem faz o quê: o **Supervisor** configura e administra a numeração de cada tradutor e envia as planilhas; o **usuário** preenche a numeração na tradução; o sistema confere e aponta anomalias (número duplicado, errado, fora da planilha, fora da sequência).

## Decisão

### Esquemas de numeração (`sworn_translators.numbering_scheme` e `numbering_config`)

| Esquema | Tradutores | Como funciona |
| --- | --- | --- |
| `free_text` | padrão | Número digitado, sem repetir no tradutor (comportamento anterior). |
| `prefixed` | Walter | `SIGLA-AAAA-número` (ex.: `NB-2026-1111`); valor do protocolo e da assinatura. Assinatura pode ser gratuita por escolha; fica gratuita automaticamente quando a soma das assinaturas pagas chega ao teto (R$ 4.000,00, contado desde uma data configurável). Protocolo zerado só com autorização do Supervisor ou do Diretor. Sem limite de números. |
| `book_sheet` | Patricia (400), Jeferson (500) | Número, livro e folha **automáticos**: o número sobe 1 por tradução e as folhas avançam pelas páginas (laudas) do documento. O Supervisor cadastra com antecedência o próximo livro e o número inicial; quando o atual passa do limite, o próximo entra sozinho. Documento que começa antes do limite pode passar dele; a troca vale para o seguinte. Sem próximo livro cadastrado, a numeração **trava**. |
| `stock` | Bruno B., Antonio Dari, Vivian | Número (e livro) da planilha, uso único. Parâmetros: lembrete na conclusão (Bruno: envio por e-mail à equipe), digital/impresso obrigatório (Antonio), páginas com gratuidade e cobrança por página extra (Vivian: 3 grátis, R$ 2,00 por página). |
| `reusable_stock` | Carla (Francês, Italiano) | Planilhas por idioma, de números pagos e de um lote gratuito; cada número vale até 2 vezes, **nunca no mesmo protocolo**. |

Comuns a todos: **limite** de números emitidos (nenhum tradutor passa do valor do Supervisor; vazio = sem limite) e **aviso** quando restarem N números, usos ou folhas. As regras prontas (presets) dos sete tradutores servem de ponto de partida e podem ser ajustadas.

### Estoque por planilha (`numbering_stock`, `numbering_imports`)

- O Supervisor envia CSV (do Excel: `;` ou `,`, com ou sem cabeçalho, com BOM). Colunas reconhecidas: número, livro, idioma, gratuito; idioma e lote gratuito também podem valer para a planilha inteira. Linhas sem número, repetidas ou já cadastradas são relatadas e não entram.
- Por número: **reservar** para uso exclusivo de uma pessoa, **bloquear**, **avisar quando for usado** e **excluir** (só nunca usado; usado, bloqueia-se).

### Preenchimento e conferência (`numbering_entries`)

- O usuário escolhe o tradutor e preenche os campos da regra (número, livro, páginas, protocolo, idioma, lote gratuito, digital/impresso, valores). Cada gravação roda a conferência e guarda os problemas; problema novo notifica os Supervisores (`numbering_anomaly`).
- **Pronta** é bloqueada enquanto a numeração preenchida tiver erro. Rascunho prende o número (conta como uso) até a conclusão ou a troca.
- A **emissão** acontece na conclusão, sob bloqueio do tradutor (`FOR UPDATE`): a conferência roda de novo, o livro avança ou troca, o estoque é consumido. Quem conclui pode completar ou corrigir o que foi preenchido. A unicidade passou do índice do banco para a regra (a Carla repete números).
- Depois de emitir: avisos de limite, estoque ou folhas acabando (`numbering_low`), número marcado (`numbering_used`) e lembrete do tradutor (`numbering_reminder`).

### Painel do Supervisor

`GET /numbering/translators`: por tradutor, emitidos (total e 30 dias), restante do limite, lotes por idioma (pagos e gratuitos: números, usos disponíveis, reservados, bloqueados), livro atual (próximo número, próxima folha, folhas restantes, próximo livro), assinatura (pago × teto) e marcas de **acabando** e **travado**. Aparece em Numeração (aba Tradutores, com a administração de cada tradutor) e no Painel da equipe.

## Consequências

- O usuário vê na hora o número previsto (livro e folha) e qualquer anomalia; o Supervisor é avisado e corrige a regra, a planilha ou o livro.
- As traduções já concluídas foram migradas como numerações emitidas, para os painéis e a conferência de duplicados.
- "Protocolo" é um campo da numeração preenchido pelo usuário (número do protocolo do cliente). "Limite" é a quantidade de números emitidos por tradutor. Se a organização usar outra definição (ex.: teto do valor numérico), entra como novo parâmetro.

## Alternativas consideradas

- Manter a numeração só na conclusão: o Supervisor não teria como saber antes que o número está errado, e o usuário não preencheria nada.
- Um esquema por tradutor no código: cada novo tradutor exigiria programação; os esquemas com parâmetros cobrem os sete e os próximos.
