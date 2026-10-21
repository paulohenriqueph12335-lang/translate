# ADR-019 — Modelos de diagramação juramentada: moldura do tradutor e corpo por tipo de documento

- Estado: Accepted
- Data: 2026-10-21
- Relacionadas: [ADR-009](009-source-layout.md) (layout do original), [ADR-012](012-sworn-translators-masks.md) (máscaras), [ADR-015](015-translation-modes.md) (regras), [ADR-016](016-automatic-review.md) (revisão automática)

## Contexto

A diagramação juramentada tinha quatro problemas: tabelas que não fechavam as colunas (formulários com grade de muitas
colunas, mesclagens que não batiam: 19 dos 29 problemas em aberto), blocos e espaçamento irregulares (parágrafos vazios,
título sozinho no fim da página), cabeçalho e rodapé que dependiam inteiramente da máscara enviada por cada tradutor, e
o tipo do documento em branco quando o original não tinha título. Pediu-se programar diversos modelos de diagramação
juramentada: da moldura do tradutor e do corpo por tipo de documento.

## Decisão

### Modelos de corpo (`body-models.ts`)

O tipo do documento é reconhecido pelo título e pelo começo do texto do original: certidão de nascimento, casamento e
óbito, identidade (CIN/RG), CNH, histórico escolar, diploma, apostila, certidão de conselho profissional, contrato,
fatura e geral. Depois da tradução e antes da revisão automática, o modelo:

- **Repara tabelas** que não fecham a grade: ajusta as mesclagens linha a linha; se ainda não fecha, refaz a tabela com
  uma coluna por célula. Nenhum texto é perdido.
- **Alinha rótulo e valor** em certidões, identidade, CNH, conselho e fatura: sequências de linhas "Rótulo: valor" viram
  tabela de duas colunas (35% / 65%), com o original de cada célula para a memória.
- **Limpa o espaçamento**: tira parágrafos vazios e linhas de assinatura repetidas.
- **Preenche o tipo do documento** com o nome do tipo no idioma de destino ou, no modelo geral, com o primeiro título.

Cada mudança entra na lista da revisão automática (código `layout`), e o aviso da tradução diz qual modelo foi usado.
Títulos, seções e a marca de assinatura ficam presos ao parágrafo seguinte (não sobram sozinhos no fim da página), com
e sem máscara.

### Modelos de moldura (`frame-models.ts`)

Quatro molduras prontas, com os marcadores do sistema: **Clássico**, **Cabeçalho em quadro** (timbre em duas colunas e
quadro com número, livro e folha), **Bilíngue** (abertura e encerramento em português e no idioma da tradução) e
**Compacto** (uma linha de timbre e uma de numeração). Todas têm rodapé "Tradução Pública nº … – Livro nº … – Página X / Y".

Em Tradutores juramentados, o Supervisor escolhe o modelo, informa cidade, estado e contato, confere a prévia (PDF) e
gera a máscara, que vira uma nova edição como um envio (`POST /sworn-translators/:id/masks/model`). A edição guarda o
modelo e os dados (`sworn_translator_masks.frame`); na conclusão e na prévia, a moldura é gerada **no idioma de cada
tradução** e com a fonte da regra. Máscaras enviadas em Word continuam como antes.

## Consequências

- Os dois documentos reais com tabelas quebradas foram reprocessados: de 19 problemas de estrutura para 0.
- Um tradutor sem máscara própria fica pronto para concluir em minutos, em qualquer idioma.
- A reorganização da tabela mantém o conteúdo, mas pode mudar a geometria do original em grades muito irregulares; a
  pessoa confere no Word antes de aprovar.
- O reconhecimento do tipo é por palavras do título; tipos novos entram no modelo geral até ganharem um modelo.
