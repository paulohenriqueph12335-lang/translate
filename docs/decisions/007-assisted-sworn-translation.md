# ADR-007 — Tradução juramentada assistida com revisão humana obrigatória

- Estado: Accepted (a parte do Claude foi substituída pelo [ADR-010](010-review-flow-without-ai.md); o tradutor público único e o contador, pelo [ADR-012](012-sworn-translators-masks.md))
- Data: 2026-10-17

## Contexto

O resultado esperado do produto (modelo em `docs/modelos testes/`) não é o arquivo de origem traduzido com o mesmo layout, e sim uma **tradução juramentada**: um documento novo, num modelo jurídico, com cabeçalho do tradutor público, fórmula de abertura e de encerramento, notas do tradutor descrevendo elementos não textuais (brasão, carimbo, marca d'água, assinaturas), conversões padronizadas (datas, decimais, milhares) e nomes institucionais mantidos no original entre colchetes. A entrada típica é um PDF digital ou digitalizado.

Decisões do produto (2026-10-17): um tradutor público fixo da organização assina as traduções; Líder ou Diretor dá a aprovação final; o uso do Claude é habilitado por equipe; os pares iniciais são PT→EN e EN→PT. Nenhum documento é aprovado sem a ação explícita de uma pessoa autorizada.

## Decisão

### Representação intermediária

A tradução é um **rascunho estruturado** (`Draft`, em `packages/core/src/translation/draft.ts`): uma lista plana de blocos — título, parágrafo, nota do tradutor, tabela (com mesclagem de colunas e linhas) e assinatura. Cada bloco guarda a origem (`rules`, `claude`, `human`) e, quando houver, o trecho original para a revisão lado a lado. A moldura juramentada (cabeçalho, abertura, tipo de documento, encerramento, emolumentos, assinatura e rodapé) não faz parte do rascunho: é gerada pelo modelo do idioma de destino a partir das configurações da organização.

### Fluxo

```text
documento armazenado → trabalho na fila (worker) → extração → rascunho → revisão → envio para aprovação → aprovação → DOCX final
                                                       │                  ↑               │
                                                       └─ falha tipada    └── devolvido ──┘
```

- **Fila no PostgreSQL** (`translation_jobs`, `FOR UPDATE SKIP LOCKED`, lease com prazo e tentativas limitadas). O worker é seguro para reiniciar: um lease vencido volta para a fila.
- **Extração**: texto com posição do PDF digital (pdf.js) para checagens determinísticas. OCR de PDF digitalizado e imagens entra na Fase 5.
- **Rascunho**:
  - **com o Claude habilitado na equipe** e chave configurada: o PDF ou a imagem vai ao Claude (`claude-opus-5-5`, saída estruturada validada pelo schema do rascunho), junto com o glossário e o exemplo aprovado mais recente do mesmo tipo de documento;
  - **sem o Claude**: o rascunho nasce com o texto extraído em blocos para tradução manual, já com o glossário aplicado onde houver correspondência exata.
- **Checagens determinísticas** sobre todo rascunho, de qualquer origem: todo número e data do original precisa aparecer no rascunho, convertido para o formato do idioma de destino; termos do glossário presentes no original precisam usar a tradução cadastrada. Os problemas aparecem para o revisor e não somem sozinhos.
- **Revisão**: Operadores, Líderes e o Diretor editam o rascunho; cada gravação cria uma revisão imutável (`translation_drafts`).
- **Aprovação**: somente Líder da equipe ou Diretor. Se houver problemas de checagem em aberto, a aprovação exige confirmação explícita com justificativa, registrada na auditoria. Só então são atribuídos o número da tradução, o livro e a folha, e o DOCX final é gerado e guardado como objeto imutável.
- **Prévia**: qualquer revisão pode ser baixada como DOCX com a marca "RASCUNHO – NÃO APROVADO".

### Tradução automática (revisão de 2026-10-17)

- O lote informa o par de idiomas ao ser criado (padrão PT→EN, ou "não traduzir"). Cada documento armazenado de um lote com equipe entra **sozinho** na fila; nos lotes do Diretor, isso acontece ao direcionar o lote. O pedido manual ("Traduzir…") continua disponível.
- Entradas aceitas: PDF e imagens (enviados ao Claude como arquivo) e DOCX/PPTX (texto extraído do XML do pacote, enviado como texto).
- A tradução automática de fato depende do Claude: chave `ANTHROPIC_API_KEY` no worker **e** a equipe habilitada pelo Diretor. Sem isso, o rascunho traz o texto original e o aviso do motivo; o worker publica em `worker_heartbeats` se está ativo e se tem o Claude, e a interface mostra esse diagnóstico. A aprovação continua sempre humana.

### Aprendizado

O sistema aprende pelo que pessoas aprovam, nunca sozinho:

- **Glossário** (`glossary_entries`): termos cadastrados por Líderes (equipe) e pelo Diretor (organização), inclusive a partir da tela de revisão, por par de idiomas.
- **Exemplos aprovados**: cada tradução aprovada vira exemplo do seu tipo de documento, identificado pelo título do original que o revisor informa (por exemplo "HISTÓRICO ESCOLAR"). O exemplo mais recente do mesmo tipo e par de idiomas entra no pedido ao Claude, para manter estrutura e terminologia consistentes. Aprovações feitas com problema de checagem justificado não servem de exemplo, e o rascunho manual não adivinha o título: um palpite errado ensinaria o sistema errado.

### Uso do Claude (provedor externo)

- Desligado por padrão; o Diretor liga por equipe (`teams.claude_enabled`). Sem `ANTHROPIC_API_KEY` no ambiente do worker, o recurso fica indisponível e o rascunho segue manual.
- Cada envio é auditado (`translation.claude_requested`) com modelo, tokens e duração, sem conteúdo do documento nos logs.
- O conteúdo do rascunho vindo do Claude é marcado como `claude` e passa pelas mesmas checagens e pela mesma aprovação humana. Recusa do modelo, resposta truncada ou fora do schema viram falha tipada e o rascunho cai para o modo manual.

## Consequências

- A Fase 3 do roadmap passa a ser a tradução juramentada assistida (PDF digital → DOCX juramentado). O antigo objetivo de traduzir DOCX preservando o layout fica para depois do piloto.
- `packages/core` é criado agora porque API e worker compartilham o schema do rascunho, o gerador de DOCX e o armazenamento S3.
- A numeração (tradução/livro/folha) é sequencial por organização e ano; cada tradução ocupa uma folha. O Diretor ajusta o livro atual e a próxima folha nas configurações.
- O envio de documentos ao Claude depende de política de privacidade da organização; deixar ligado por equipe torna explícito quem aceita esse envio.

## Alternativas consideradas

Traduzir o PDF mantendo layout (não é o produto esperado); extração por regras fixas por layout de escola (frágil: o segundo modelo de teste, de outra escola, já tem layout diferente); aprovação automática quando as checagens passam (proibida pela decisão de produto).
