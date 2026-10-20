# ADR-009 — Leitura do layout do original para preservar a estrutura

- Estado: Accepted
- Data: 2026-10-17

## Contexto

A tradução por trechos (ADR-008) montava o rascunho a partir do texto extraído, linha a linha. O DOCX gerado trazia o texto solto: sem as tabelas do original, sem mesclagens, sem títulos centrados, sem negrito e sem as notas do tradutor para brasão, carimbo, marca d'água e rodapé. O modelo juramentado (`fixtures/historico-escolar/esperado.docx`) reproduz a estrutura do original, e o revisor não deve ter de remontá-la à mão.

## Decisão

Antes de traduzir, o worker lê a **estrutura do original** (`SourceLayout`, em `packages/core/src/translation/layout/`) e a tradução preenche essa estrutura; o texto de cada célula ou bloco é traduzido, a forma não passa pelo provedor.

### PDF (`analyzePdfLayout`, pdf.js)

- **Tabelas**: as linhas desenhadas (`constructPath`, com a matriz de transformação acumulada) formam grades; colunas e linhas vêm do agrupamento das coordenadas, e a ausência de traço entre duas células vira `colSpan`/`rowSpan`. Células "RÓTULO / valor" viram "RÓTULO: valor"; grade de uma coluna é caixa, não tabela; a primeira linha em negrito de largura total vira seção; rótulos repetidos em linhas viram cabeçalho; fundo e posição definem cabeçalho e totais.
- **Texto livre**: linhas agrupadas em parágrafos por alinhamento (centro, direita, esquerda, justificado), negrito (fonte da página), tamanho e espaçamento. O maior texto em negrito é o título do documento (`sourceTitle`).
- **Assinaturas**: traço horizontal curto fora de tabela, com nome e cargo abaixo e rubrica (curvas) acima.
- **Elementos não textuais** viram notas do tradutor, no idioma de destino e no padrão do modelo: brasão (curvas no alto da página, com a posição), carimbo (texto inclinado pequeno, linhas agrupadas mesmo com tamanhos diferentes), marca d'água (texto inclinado grande) e rodapé (texto pequeno no pé da página). A citação fica no original e a tradução entre colchetes.

### DOCX (`analyzeDocxLayout`)

Alinhamento (`w:jc`), negrito, tamanho, tabelas com larguras, `gridSpan`, `vMerge` e sombreamento, cabeçalhos no início, rodapé como nota e desenhos como brasão.

### Sem layout

Imagens, PPTX ou falha da leitura: a estrutura é inferida do texto extraído (linhas com colunas viram tabelas), como antes.

### Rascunho sem tradução automática

Quando não há provedor, o rascunho também segue a estrutura do original, com datas e decimais já convertidos, glossário e memória aplicados. A checagem `untranslated` (erro) aponta quando a maioria dos trechos continua igual ao original: aprovar assim exige justificativa, e aprovações justificadas não ensinam a memória — um rascunho não traduzido nunca vira "tradução aprendida".

### Memória

Além de células e blocos, a memória aprende os cargos das assinaturas e as citações traduzidas de carimbos, marcas d'água e rodapés.

## Consequências

- O DOCX gerado pela tradução gratuita tem a mesma diagramação do modelo (verificado convertendo para PDF: tabelas, mesclagens, seções, data à direita, assinaturas e notas nas mesmas posições). A qualidade do texto continua sendo a do provedor; glossário e memória a melhoram a cada aprovação.
- As heurísticas foram calibradas nos históricos fictícios (`original.pdf` e `variante-fundamental.pdf`). Documentos com outra diagramação podem exigir ajustes; o revisor sempre pode editar a estrutura.
- PDFs digitalizados (sem camada de texto) continuam sem layout até o OCR (Fase 5).

## Alternativas consideradas

- Pedir a estrutura ao Claude: já é o caminho quando a equipe tem o Claude (ADR-007), mas a tradução gratuita precisa funcionar sem chave.
- Converter o PDF em DOCX com LibreOffice e traduzir o DOCX: o resultado vira caixas de texto posicionadas, não tabelas, e perde o padrão do modelo juramentado.
- Bibliotecas de extração de tabelas (Camelot, Tabula): exigem Python/Java no worker e não tratam assinaturas, carimbos nem notas.
