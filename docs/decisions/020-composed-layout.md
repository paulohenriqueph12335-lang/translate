# ADR-020 — Diagramação construída para documentos desconhecidos, combinando o que o sistema já conhece

- Estado: Accepted
- Data: 2026-10-21
- Relacionadas: [ADR-009](009-source-layout.md) (layout do original), [ADR-010](010-review-flow-without-ai.md) (padrão conhecido), [ADR-016](016-automatic-review.md) (revisão automática), [ADR-019](019-sworn-layout-models.md) (modelos de diagramação)

## Contexto

O sistema dependia de documentos iguais: o "padrão conhecido" vinha de uma tradução concluída com o mesmo título, e os
modelos de corpo cobriam só os tipos com palavras-chave conhecidas. Um tipo novo (uma declaração, um atestado, um
formulário de órgão) saía com a estrutura crua do original, e uma imagem lida por OCR saía toda à esquerda, sem título,
com campos soltos e linhas partidas. Pediu-se que o sistema construa os modelos que ainda não conhece, combinando tudo o
que conhece, sem perder a qualidade da entrega.

## Decisão

### Papéis em vez de tipos

Cada parte de qualquer documento recebe um papel pela posição, pela forma do texto e pela vizinhança: elemento visual,
cabeçalho do órgão, título (a última linha da sequência em maiúsculas do topo, quando nada o marca), seção, campo
"rótulo: valor" (pelo texto traduzido ou pelo original), tabela de campos, tabela de dados, texto corrido (frase longa),
linha curta, local e data, linha de assinatura, quem assina e nota de rodapé.

### Aprendizado contínuo

Cada tradução concluída (sem justificativa de exceção e não anulada) vira uma amostra: a mistura de papéis do documento
(vetor de estrutura), como cada papel foi diagramado (alinhamento, negrito, tamanho, título ou parágrafo) e se os campos
foram para tabela, com a largura da coluna de rótulos. As amostras são recalculadas das 300 conclusões mais recentes e
ficam 5 minutos em memória: o sistema aprende a cada conclusão, sem cadastro.

### Composição

Para um documento sem modelo próprio, sem exemplo do mesmo título ou sem formatação no original, o sistema escolhe até
cinco documentos conhecidos de estrutura mais parecida (semelhança de cosseno do vetor de papéis, mínimo 50%) e, papel a
papel, aplica o que a maioria ponderada deles faz (60% ou mais):

- campos soltos viram tabela de campos, na largura de rótulos aprendida;
- sem formatação no original (OCR, texto colado), cada papel ganha o estilo aprendido, e as linhas partidas pela leitura
  são juntadas ao parágrafo; a falsa "tabela" de uma linha (espaço largo no meio) volta a ser linha;
- o tipo do documento vem do título reconhecido.

Garantias de qualidade: **nenhum texto muda** (só a forma); a formatação conhecida do original prevalece (o aprendido só
completa o que falta); texto corrido é sempre à esquerda ou justificado; cada mudança entra na lista da revisão
automática e o aviso diz de quais documentos conhecidos a diagramação foi construída; as checagens continuam valendo.

## Consequências

- Uma declaração de residência e um atestado médico que o sistema nunca viu, em PDF e em imagem (OCR), saíram com
  título, cabeçalho do órgão, campos em tabela, texto justificado e tipo do documento, sem problemas de checagem,
  construídos de certidões e faturas já concluídas (exemplos em `docs/exemplos-simulados/novos-tipos`).
- Quanto mais tipos diferentes concluídos, melhor a combinação; com poucos, o sistema se apoia nos mais parecidos.
- O teste de padrões mostra de quais documentos a diagramação foi construída.
- Documentos de estrutura muito diferente de tudo o que existe (semelhança abaixo de 50%) seguem a estrutura do
  original, sem empréstimo.
