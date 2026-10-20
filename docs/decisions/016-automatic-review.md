# ADR-016 — Revisão automática que corrige o documento, nomes próprios protegidos e simulação ponta a ponta

- Estado: Accepted
- Data: 2026-10-20
- Relacionadas: [ADR-008](008-free-machine-translation.md) (tradução gratuita), [ADR-013](013-technical-spreadsheets.md) (códigos), [ADR-015](015-translation-modes.md) (modalidades e regras)

## Contexto

A skill de revisão aponta os problemas (destaque em amarelo) e deixa a correção para a pessoa. Pediu-se que a revisão
**corrija sozinha**: se o idioma não for o pedido, refazer; se um número, data ou termo saiu errado, voltar ao certo; tudo
o que tiver conserto, corrigido no documento. Ao rodar 18 documentos simulados (certidão de nascimento, CIN, CNH, fatura
de cartão, certidão de conselho de medicina e apostila, em inglês, francês, italiano e espanhol) apareceram também falhas
do motor de tradução: nomes de pessoas e cidades traduzidos ("ANA PAULA REGO" → "AGE PAUL AGE", "Serra Clara" →
"Sierra Clara"), texto em maiúsculas mal traduzido ("RÉPUBLIQUE FICIQUE"), rótulos de elemento visual traduzidos
("BRASÃO" → "BRAZON"), "S.A." quebrado, "1ª habilitação" virando "1", marcadores entre colchetes apagados e tipo de
documento herdado de outro documento só por terem uma etiqueta em comum.

## Decisão

### Revisão automática (`autoReview`, `packages/core/src/translation/review.ts`)

Roda em três momentos: no processamento (depois do rascunho), no botão **Revisão automática** da tela da tradução e
antes de **Pronta**. Cada correção fica registrada na revisão (`translation_drafts.corrections`), com o antes e o depois;
revisões feitas a pedido de alguém têm origem `review` e autor. Sem nada a corrigir, nenhuma revisão nova é criada.

| Problema | Correção |
| --- | --- |
| Trecho fora do idioma de destino (detecção por palavras funcionais, sem serviço externo) | Retraduz do original, num lote só |
| Trecho igual ao original | Retraduz do original |
| Texto perdido ("1ª habilitação" → "1") | Retraduz do original |
| Número, código ou data alterados (separador trocado, dia e mês invertidos, vírgula perdida na data por extenso) | Volta ao formato da regra da modalidade |
| Termo do glossário sem a tradução aprovada | Troca no texto ou retraduz com o termo protegido |
| Marcador no idioma errado ("[Carimbo]" num documento em inglês) | Marcador no idioma de destino |
| Nota do tradutor onde a regra pede marcador | Marcador entre colchetes |
| Espaços repetidos, espaço antes de pontuação, elisão separada no francês e no italiano ("l ' État") | Acerta |
| Tipo de documento em branco | Título do original traduzido |

Limites deliberados: trechos que vieram da **memória de tradução** (já aprovados por alguém) não são retraduzidos; trecho
em um **terceiro idioma** no original fica transcrito (regra das skills); **sem provedor** de tradução, a revisão corrige
o resto e lista o que não conseguiu (`unresolved`) — nunca inventa texto. A API usa o mesmo provedor do worker
(`LIBRETRANSLATE_URL`, `DEEPL_API_KEY`).

### Motor de tradução

- **Nomes próprios** ficam como no original: pessoas (prenome de uma lista de nomes comuns no Brasil seguido de
  sobrenomes), cidades (o nome antes da sigla do estado — "Vila Esperança – EF", "Porto Aurora/PA" —, valendo para o
  documento todo e cortando o órgão antes, como em "Registro Civil de Vila Esperança"), endereços eletrônicos, siglas com
  pontos ("S.A.") e marcadores do original entre colchetes. Vão protegidos ao provedor, como os números.
- **Maiúsculas**: trecho todo em maiúsculas vai em minúsculas e volta em maiúsculas (siglas curtas vão como estão).
- **Colunas de nomes em maiúsculas** (estabelecimentos e cidades numa fatura) ficam como no original.
- **Rótulo de elemento visual sozinho** ("BRASÃO", "SÍMBOLO", "QR CODE", "ASSINATURA ELETRÔNICA") vira marcador; novos
  marcadores: logotipo, assinatura eletrônica e foto, nos cinco idiomas.
- **Ordinais** seguem o idioma de destino (francês: 1re, 1er, 2e) e não se separam do número.
- **Tipo e título** só são herdados de um exemplo com o mesmo título do original; tradução anulada não serve de exemplo.

### Simulação ponta a ponta

`docs/exemplos-simulados/gerar.py` cria os 18 PDFs fictícios; `packages/core/scripts/simular-documentos.ts` os envia ao
sistema local com contas de teste, espera o worker, confirma o checklist, marca como pronta, numera as juramentadas com a
máscara simulada (tradutora fictícia, regra de número, livro e folha) e baixa o Word final. `teste-carga.ts` mede o limite
da API e da fila sem forçar a máquina. Resultados em `docs/exemplos-simulados/`.

## Consequências

- O revisor recebe o documento já corrigido e a lista do que mudou; o que não tem conserto seguro continua apontado.
- "Pronta" pode criar uma revisão `review` antes de seguir; a auditoria registra `translation.auto_reviewed`.
- A qualidade do texto continua limitada pelo provedor gratuito (escolhas de vocabulário como "Grandparents" para "Avós
  paternos"); o glossário é o caminho para fixar termos recorrentes.
- Nomes fora da lista de prenomes e cidades sem sigla do estado ainda podem ser traduzidos; a lista pode crescer.

## Alternativas consideradas

- **Só apontar, como a skill de revisão original**: foi o que se pediu para mudar.
- **Serviço externo de detecção de idioma**: dependência e envio de texto para fora sem necessidade; as palavras
  funcionais bastam para trechos de quatro palavras ou mais.
- **Lista de cidades do país**: grande e ainda assim incompleta; a sigla do estado é um sinal mais confiável nos documentos.
