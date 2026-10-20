# ADR-013 — Planilhas técnicas: tabelas sem bordas completas e códigos que não se traduzem

- Estado: Accepted
- Data: 2026-10-18

## Contexto

Uma lista de compatibilidade de memórias (PDF exportado do Excel, 5 páginas, 13 seções de cerca de 60 linhas, inglês) gerou um rascunho em português de 10 páginas com o texto solto: só a primeira linha do cabeçalho virou tabela, e todos os dados viraram um parágrafo gigante. Além disso, a tradução automática falhou por tempo esgotado, e o rascunho voltou sem tradução. As causas:

1. O PDF define um **recorte** do tamanho da página (caminho que não desenha nada); a leitura do layout (ADR-009) o tomou por moldura, juntou-o às linhas da tabela e descartou a grade inteira pela regra "grade maior que 55% da página é moldura".
2. A planilha desenha as **verticais só no cabeçalho**: as linhas de dados têm apenas as horizontais, e cada linha virava uma célula única.
3. Nas páginas seguintes, a tabela **continua sem nenhuma vertical** (ou sem linha alguma).
4. Milhares de trechos (referências de peça, marcas, siglas, medidas) foram mandados ao LibreTranslate; além de lento, o provedor estraga códigos ("Ver7.21" → "Ver7,21") e abreviações ("Chip NO." → "Chip não").

## Decisão

### Leitura do layout (`pdf-layout.ts`)

- Só caminhos efetivamente desenhados (traço ou preenchimento) contam como linhas; recortes (`endPath`) são ignorados.
- Moldura é o retângulo grande **sem divisões internas**; uma tabela que ocupa a página continua sendo tabela.
- Linha de dados numa faixa sem verticais é dividida pelas colunas do cabeçalho quando cada trecho de texto cabe inteiro numa coluna.
- **Tabela sem bordas**: três ou mais linhas seguidas com três ou mais trechos separados por espaço largo viram tabela. As colunas vêm da tabela anterior quando o texto se encaixa nelas (continuação em outra página); senão, dos vãos verticais do texto.
- Tabelas consecutivas com as mesmas colunas e sem novo cabeçalho são unidas (continuação entre páginas).
- O título da tabela pode estar numa célula que não começa na primeira coluna; sem título grande no documento, o primeiro título de seção identifica o documento.
- Linha que começa com marcador de lista ("•", "-", "*") abre um parágrafo novo.

### Códigos (`codes.ts`)

- **Código** é o trecho feito só de palavras com dígito, com símbolo no meio e sem minúsculas ("A-DATA", "N/A", "G.SKILL"), de pontuação ou do "x" de multiplicação. Fica exatamente como no original; sem letras (datas, notas) ou medida simples ("1.5V"), recebe só as conversões de formato (data, separador decimal).
- **Coluna de identificadores**: nas linhas de dados, 60% ou mais de códigos, ou nomes de uma palavra só que se repetem muito ou vêm em maiúsculas (marcas, "SS"/"DS"). Tabelas do mesmo documento com as mesmas colunas decidem juntas. Cabeçalhos, totais e texto corrido dentro da coluna ("Heat-Sink Package") continuam sendo traduzidos.
- A checagem `untranslated` (ADR-009) não conta códigos nem colunas de identificadores.

### Tradução

- "No."/"NO." em inglês vira "nº" antes de traduzir, e "nº" vai ao provedor como marcador protegido.
- O LibreTranslate recebe lotes de até 25 trechos ou 4.000 caracteres.

### Renderização

- A letra das tabelas diminui (de 9 pt até 5 pt) para que a palavra mais longa de cada coluna caiba sem ser partida; tabelas com sete ou mais colunas usam margens menores.

## Consequências

- O documento de origem é lido com 327 de 327 linhas, sem texto perdido; só 35 trechos (cabeçalhos, títulos e notas) vão ao provedor, em cerca de 25 s; o DOCX tem as 13 seções com tabelas de 10 colunas e cabeçalho mesclado.
- Fixture fictício `packages/core/fixtures/planilha-tecnica/planilha-ficticia.pdf`, gerado por `gerar.py` na mesma pasta, reproduz esses casos nos testes.
- As heurísticas de coluna podem errar em tabelas pequenas e incomuns; o revisor corrige o texto na prévia, e uma célula mantida como código aparece igual ao original.
- Texto em chinês dentro do documento depende de fonte instalada para aparecer no PDF convertido; no Word aparece normalmente.

## Alternativas consideradas

- Ler a planilha pelo arquivo original (XLSX): o produto recebe o PDF; quando o XLSX chegar como entrada, entra como novo formato.
- Dicionário de marcas e referências: não acompanha a variedade de fabricantes; as regras de forma (dígitos, símbolos, repetição) generalizam.
