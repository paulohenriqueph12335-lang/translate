# ADR-018 — OCR local para imagens e PDFs digitalizados, e tradução de documentos longos

- Estado: Accepted
- Data: 2026-10-21
- Relacionadas: [ADR-008](008-free-machine-translation.md) (tradução gratuita), [ADR-016](016-automatic-review.md) (revisão automática), [ADR-017](017-automatic-flow-patterns.md) (fluxo automático)

## Contexto

Imagens (PNG/JPG) e PDFs digitalizados chegavam ao fluxo automático e paravam num rascunho vazio ("o original não tem
camada de texto"); mesmo assim o checklist era confirmado pela revisão automática, como se houvesse algo conferido.
Documentos longos estouravam o prazo do LibreTranslate (60 s por pedido) e caíam no rascunho com o texto original.

## Decisão

- **OCR local e gratuito** com o Tesseract (português, inglês, francês, italiano e espanhol) no worker e na API; o
  documento não sai da infraestrutura. Imagens vão direto ao OCR; PDF sem camada de texto vira imagens de página
  (`pdftoppm`, 300 dpi, até 20 páginas) e passa pelo OCR. O idioma do original vai primeiro, com o inglês de apoio.
- O texto reconhecido mantém as colunas do original (palavras distantes viram células) e segue o caminho normal:
  tradução, revisão automática, prévia em Word. O aviso informa a confiança média do OCR e pede conferência de nomes,
  números e datas; o teste de padrões classifica esses arquivos como "consegue, com conferência".
- **Checklist automático só quando houve leitura e tradução**: sem texto lido ou sem tradução automática, o checklist
  fica para a pessoa.
- **Documentos longos**: lotes menores (12 trechos / 2.000 caracteres), prazo de 120 s por pedido e, quando um lote
  estoura o prazo, ele é dividido ao meio até o trecho sozinho antes de a falha voltar ao worker (que tenta de novo mais
  tarde). O worker renova o lease enquanto processa, para outro worker não assumir um documento longo no meio.

## Consequências

- Imagens e digitalizados passam a ser traduzidos; a qualidade depende da nitidez da imagem e fica sinalizada.
- As imagens do worker e da API crescem (Tesseract, dados de idioma, Poppler).
- Um documento muito longo ocupa o worker por vários minutos; com mais demanda, sobe-se mais de um worker.
- Sem Tesseract instalado (ambiente de desenvolvimento fora do Docker), o sistema segue como antes, sem OCR.
