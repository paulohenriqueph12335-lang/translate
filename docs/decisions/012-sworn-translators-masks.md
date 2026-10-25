# ADR-012 — Tradutores juramentados com máscara em Word e numeração própria

- Estado: Accepted
- Data: 2026-10-18 (revisão de 2026-10-19: máscaras por edição, sem campo de regras e sem download de modelo)
- Substitui: o tradutor público único e o contador anual da organização (Configurações de tradução, ADR-007); ajusta a numeração do ADR-011

## Contexto

Cada tradutor juramentado entrega a própria máscara: o documento com timbre, abertura, encerramento, assinatura, rodapé e diagramação dele (em PDF e em Word). O sistema não deve reconstruir esse modelo; deve preencher o Word do tradutor com o documento traduzido, o número e a data, sem alterar o resto. Cada tradutor também tem o seu sistema de numeração e as suas regras, que ainda serão definidas.

Decisões do produto (2026-10-18): lista única de tradutores, mantida pelos Supervisores (o Diretor consulta); o tradutor é escolhido na conclusão; a máscara indica com marcadores onde entra cada informação; enquanto as regras não existem, o número é digitado na conclusão.

## Decisão

### Cadastro (`sworn_translators`)

Nome, matrícula, idiomas, observações, ativo/inativo, o **armazenamento de máscaras** e, opcionalmente, o **PDF do tradutor** como referência. Só Supervisores cadastram, alteram e enviam arquivos; o Diretor consulta e baixa; os demais veem a lista. Tudo auditado (`translator.*`).

**Regras de numeração não são campo do cadastro** (revisão de 2026-10-19): cada tradutor terá as suas regras programadas no sistema, a partir de uma especificação por tradutor que será preparada; conforme o Supervisor inclui um tradutor, as regras dele entram na programação e a numeração passa a ser automática.

### Armazenamento de máscaras por edição (`sworn_translator_masks`)

- As máscaras chegam **só por upload** do Supervisor; o sistema não oferece modelo para baixar (o modelo interno serve apenas aos testes e à prévia sem tradutor escolhido).
- Cada envio aceito vira uma **edição numerada** do tradutor (1, 2, 3…), com arquivo, marcadores encontrados, observação opcional ("o que mudou"), quem enviou e quando. A edição enviada passa a valer nas próximas conclusões; o Supervisor pode voltar a usar uma edição anterior. Envio recusado não consome número de edição.
- A tradução concluída guarda **a edição com que foi gerada** (`translation_jobs.mask_id`); uma renumeração autorizada gera o novo DOCX com a mesma edição.

### Máscara

- Um `.docx` com marcadores entre chaves duplas: `{{texto}}` (obrigatório, uma vez, num parágrafo do corpo), `{{numero}}`, `{{livro}}`, `{{folha}}`, `{{data}}` (por extenso no idioma da tradução), `{{data_curta}}`, `{{ano}}`, `{{tipo}}`, `{{titulo_original}}`, `{{idioma_origem}}`, `{{idioma_destino}}`, `{{tradutor}}`. Marcador em maiúsculas sai em maiúsculas.
- Ao enviar, a máscara é conferida (`inspectMask`): Word válido, `{{texto}}` presente uma vez e fora de cabeçalho/rodapé; marcadores desconhecidos e ausência de `{{numero}}`/`{{data}}` viram avisos.
- O preenchimento (`fillMask`, `packages/core/src/translation/mask/`) troca **só os marcadores**, em corpo, cabeçalhos, rodapés e notas, inclusive quando o Word partiu o marcador em vários trechos; fontes, espaços, margens, campos de página e imagens não são tocados.
- O documento traduzido entra no lugar do parágrafo `{{texto}}` com a formatação dele (fonte, tamanho, espaçamento, recuo): títulos em negrito e um pouco maiores, notas do tradutor em itálico, tabelas na largura útil da página da máscara, com mesclagens e sombreamento de cabeçalho e totais.

### Conclusão e numeração

- Quem conclui (Supervisor da equipe ou Diretor) escolhe um tradutor **ativo com máscara** e digita **número** (obrigatório), **livro** e **folha** (quando a máscara usa), em texto livre (`number_label`, `book_label`, `sheet_label`). O mesmo número não se repete no mesmo tradutor (`409 number_taken`); tradutores diferentes podem ter números iguais.
- A prévia em DOCX sai na máscara escolhida (ou no modelo do sistema), com número em branco e aviso de rascunho.
- Cotas (ADR-011) contam os números emitidos; pedidos de alteração usam os mesmos valores em texto e geram nova versão do DOCX na máscara do tradutor da tradução.
- Quando as regras de cada tradutor forem programadas, o número passa a ser sugerido/validado automaticamente na conclusão, sem mudar o fluxo.

### Revisão de 2026-10-25: tradutor só na conclusão, e opcional

O envio da juramentada obrigava escolher máscara e tradutor logo no início, e sem tradutor cadastrado nada podia ser
concluído. Agora:

- O envio não pergunta tradutor nem máscara; a numeração também sai da revisão.
- Na conclusão, quem conclui escolhe **Com tradutor** (máscara, número, livro e folha, como acima) ou **Sem tradutor**
  (`POST /translations/:id/approve` com `withoutTranslator: true`): o Word sai no layout do original, sem máscara e sem
  número, e a tradução fica com `use_mask = false`. Uma numeração rascunhada é anulada (`void`) e o número volta a ficar
  livre; com número já emitido, a conclusão sem tradutor é recusada.
- "Aprovar e concluir" sem tradutor decidido deixa a tradução pronta e abre a conclusão para essa escolha.
- Sem tradutor com máscara cadastrado, só a opção "Sem tradutor" fica disponível, e o aviso que bloqueava o fluxo sai.

### O que sai

`translation_settings` e `translation_counters` deixam de ser usados (ficam como histórico das traduções já concluídas, que foram numeradas com eles e mantêm o texto do número). A tela "Configurações de tradução" passa a ter só a tradução automática.

## Consequências

- O documento final tem exatamente a cara do tradutor; uma nova edição vale para as próximas conclusões (as já concluídas são imutáveis e registram a edição usada).
- Se a máscara não usar `{{numero}}` ou `{{data}}`, essas informações não aparecem no documento (o envio avisa).
- Traduções concluídas antes deste ADR não têm tradutor cadastrado e não podem ser renumeradas.

## Alternativas consideradas

- Gerar o documento a partir do PDF do tradutor: PDF não é editável com fidelidade; o Word é a fonte e o PDF fica como referência.
- Detectar automaticamente onde vão número e texto: frágil com máscaras diferentes; marcadores explícitos são previsíveis.
- Contador automático por tradutor já agora: as regras de cada tradutor ainda não estão definidas; o número digitado evita numerar errado.
