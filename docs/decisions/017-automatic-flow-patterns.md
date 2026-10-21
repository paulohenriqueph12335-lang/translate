# ADR-017 — Fluxo automático até o Word, máscara escolhida no envio e padrões de documento

- Estado: Accepted
- Data: 2026-10-21
- Relacionadas: [ADR-012](012-sworn-translators-masks.md) (máscaras), [ADR-014](014-translator-numbering-rules.md) (numeração), [ADR-015](015-translation-modes.md) (modalidades), [ADR-016](016-automatic-review.md) (revisão automática)

## Contexto

Pediu-se: colocar o documento e o sistema automatizar tudo até a entrega da prévia e, em seguida, do Word; tradução e
revisão automáticas, sem pedir autorização para revisar; mostrar sempre o Word para a pessoa e, se ela aprovar, seguir
para a próxima fase. Na juramentada, escolher no início com ou sem máscara e, com máscara, o tradutor e a numeração,
com opção de baixar em Word e em PDF. E uma área para mostrar padrões de documento novos e saber se o sistema consegue
ou não fazê-los.

## Decisão

### Fluxo na tela de Traduções

1. **Nova tradução**: arquivo(s), par de idiomas e modalidade; na juramentada, **com máscara** (e o tradutor) ou **sem
   máscara**. O lote guarda `use_mask` e `preferred_translator_id`, e cada tradução herda.
2. **Tradução e revisão automáticas**: o worker traduz, roda a revisão automática (ADR-016) e confirma o checklist das
   etapas como "Revisão automática"; grava as páginas do original (`page_count`) para a numeração por folhas.
3. **Prévia em Word**: a tela mostra o Word (convertido para PDF, como o Word imprime) com **Baixar Word** e **Baixar
   PDF**. Com máscara, sai na máscara do tradutor do envio, com o **número previsto** pela regra dele; a numeração abre
   já com esse tradutor e as páginas do original.
4. **Aprovar** (`POST /translations/:id/accept`): leva à próxima fase. Quem trabalha na tradução confirma o que faltar do
   checklist e marca como pronta; quem pode concluir (Supervisor da equipe, Diretor) conclui na hora. Um Usuário aprova
   e a liderança conclui com o mesmo botão. Sem numeração preenchida, a conclusão usa a regra do tradutor do envio com
   as páginas do original; regras que pedem número digitado continuam pedindo.
5. **Word final**: Word e PDF para baixar; o número fica na tela.

A edição do texto, o checklist, a revisão automática manual e a conclusão com outro tradutor continuam disponíveis em
"Ajustes manuais". A juramentada sem máscara sai como as demais (sem moldura nem número); a restrição
`approved_is_complete` só exige número na juramentada com máscara.

### PDF

Conversor do LibreOffice (Gotenberg) no Compose, acessado só pela API (`CONVERTER_URL`). `?format=pdf` em
`/preview` e `/final` devolve o mesmo Word em PDF (`inline` para ver na tela, `download=true` para baixar). Sem
conversor, a opção responde indisponível e o Word continua liberado.

### Padrões de documento

- **Histórico** (`GET /document-patterns`): os tipos que já passaram pelo sistema, agrupados pelo título do original, com
  veredito **consegue fazer** (conclusão sem justificativa e último processamento limpo), **consegue, com conferência**
  (sem conclusão limpa ainda, ou problemas restantes) ou **ainda não consegue** (sem texto legível ou tudo falhou), e os
  motivos.
- **Teste** (`POST /document-patterns/test`): o arquivo passa pelo mesmo caminho do worker (`draftFromFile`: leitura,
  layout, tradução, revisão automática e checagens) sem criar tradução nem guardar nada. Responde o veredito, os
  motivos, a estrutura reconhecida (tabelas, títulos, assinaturas, elementos visuais), as correções, se já há padrão
  concluído e um Word da prévia do teste. Imagem e PDF digitalizado ficam como "ainda não consegue" (falta OCR).

## Consequências

- O caminho comum é: colocar o documento → conferir o Word → aprovar. A revisão humana passa a ser a conferência do
  Word, não o preenchimento de checklists.
- O worker e o teste de padrões usam a mesma função; uma melhoria no motor vale para os dois.
- A conversão para PDF depende de um contêiner a mais (LibreOffice); fontes ausentes nele são substituídas por
  equivalentes, então o PDF pode diferir um pouco do Word aberto no Office.

## Alternativas consideradas

- **Concluir sem ninguém ver o Word**: descartado; pediu-se mostrar sempre o Word e só seguir com aprovação.
- **Pré-visualizar o Word em HTML**: não reproduz a máscara do tradutor; o PDF do LibreOffice mostra o documento como
  ele sai.
- **Teste de padrão criando uma tradução de verdade**: sujaria filas, memória e numeração; o teste não grava nada.
