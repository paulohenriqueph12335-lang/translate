# ADR-010 — Fluxo de revisão simplificado, notificações, etiquetas e fim do uso do Claude

- Estado: Accepted
- Data: 2026-10-17
- Substitui: a parte do [ADR-007](007-assisted-sworn-translation.md) sobre o Claude (rascunho por IA habilitado por equipe)

## Contexto

A tela de revisão do ADR-007 mostrava o rascunho bloco a bloco, com origem, termos e revisões, e confundia quem só precisa saber se o documento está pronto. A organização pediu:

- uma revisão simples, com a prévia de como o documento vai ficar;
- um fluxo claro: o Operador diz que está pronto, o Líder ou o Diretor conclui (liberando o download) ou pede para refazer;
- processamento imediato de todo documento enviado, com aviso quando o sistema ainda não conhece aquele tipo de documento;
- notificações, filtros em todas as listas longas, uma área só de downloads e a ligação entre o original e o que foi gerado;
- etiquetas no envio para classificar os documentos;
- deixar de usar IA por enquanto: a tradução gratuita (ADR-008) com a estrutura do original (ADR-009) atende.

## Decisão

### Sem Claude

O redator via Claude, a liberação por equipe (`teams.claude_enabled`), o pedido de ajuda (`/translations/:id/assist`), a chave `ANTHROPIC_API_KEY` e o sinal `claude_available` do worker saem do produto (migração `0010`). Rascunhos antigos com origem `claude` continuam válidos no histórico. Se a IA voltar, entra como um novo provedor de rascunho, com nova ADR.

### Processamento e padrão conhecido

- Todo lote tem par de idiomas (PT → EN por padrão) e todo documento armazenado entra na fila na hora, inclusive nos lotes do Diretor ainda sem equipe.
- O worker procura um **exemplo**: a tradução concluída mais recente, sem justificativa de exceção, com o mesmo título do original no texto ou, na falta dele, com uma etiqueta em comum. Sem exemplo, `translation_jobs.pattern_known = false` e o Líder, o Diretor e quem enviou recebem a notificação "Tipo de documento ainda não aprendido".

### Fluxo

| Situação | Quem age | Ações |
| --- | --- | --- |
| Para revisar (`in_review`) | equipe | editar o texto na própria prévia; **Pronta** (`submit`) |
| Aguardando conclusão (`awaiting_approval`) | Líder da equipe ou Diretor | **Concluir** (`approve`: numera, gera o DOCX final e libera o download) ou **Refazer** (`return` com motivo; opcionalmente reprocessa o documento) |
| Concluída (`approved`) | quem vê o lote | baixar a tradução e o original |
| Falhou | Líder ou Diretor | **Processar de novo** (`reprocess`) |

Concluir continua exigindo o tradutor público configurado e justificativa quando há erro de checagem em aberto; a interface mostra o motivo antes do clique, não depois. A prévia usa os mesmos textos fixos do DOCX (`frame` no detalhe da tradução).

### Notificações

Tabela `notifications` por pessoa, gravada na mesma transação do evento: pronto para revisar, tipo novo, aguardando conclusão, refazer, concluído, falha e lote direcionado. Quem causou o evento não é notificado. Leitura, filtro por tipo/não lidas e marcação como lida são só da própria pessoa.

### Etiquetas e associação

- `documents.tags` (até 10, minúsculas): informadas no envio do lote, editáveis depois por quem vê o documento, usadas como filtro e para reconhecer o tipo.
- `GET /documents` lista os originais com as traduções geradas de cada um; a lista de traduções traz o original. Juntas formam a área de **Downloads**.

### Filtros

Traduções (situação, equipe, etiqueta, tipo, idiomas, tipo novo, quem enviou, quem concluiu, períodos de recebimento e conclusão, busca por nome, lote, tipo ou número), documentos (equipe, lote, etiqueta, formato, situação da tradução, quem enviou, período) e auditoria (grupo, ação, pessoa ou sistema, equipe, alvo, período, busca).

## Consequências

- O Operador vê o documento como ele vai sair e corrige o texto no lugar; trechos iguais ao original ficam destacados.
- Nenhum documento é enviado para fora da infraestrutura por padrão (o DeepL continua opcional, ADR-008).
- Imagens (JPG/PNG) chegam com o aviso de transcrição manual até o OCR local (Fase 5).
- Notificações crescem com o uso; a limpeza entra com a retenção (Fase 8).

## Alternativas consideradas

- Manter o editor bloco a bloco como modo avançado: dobra a interface e a manutenção sem pedido de uso.
- Notificações por e-mail: exigem servidor de envio; ficam para depois, reaproveitando a mesma tabela.
