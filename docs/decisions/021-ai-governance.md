# ADR-021 — Gerenciamento AI: o Gemini como gestor de processo e orientador técnico, com escopo restrito

- Estado: Accepted
- Data: 2026-10-21
- Relacionadas: [ADR-010](010-review-flow-without-ai.md) (fluxo sem IA), [ADR-016](016-automatic-review.md) (revisão automática), [ADR-020](020-composed-layout.md) (diagramação construída)

## Contexto

Pediu-se ativar a IA (Gemini) como gestor de processo e orientador técnico, com um prompt de governança: conformidade
absoluta com o glossário, preservação da estrutura e do conteúdo, codificação limitada a soluções de diagramação dentro
das regras e proibição de funções extras. Fora disso, o sistema barra a IA. As pessoas podem pedir auxílio; se a IA
parar ou acabar a cota, o sistema segue normalmente. Só Líder e Diretor limitam o acesso de cada pessoa e configuram
prompts e habilidades. A IA só "codifica" combinações novas de diagramação se a pessoa aprovar a prévia, e o sistema
se molda às combinações aprovadas.

## Decisão

### Três tarefas, nada mais

A IA só atende três tarefas, cada uma com um esquema de resposta fixo (JSON validado com `strictObject`):

- **Verificar glossário**: recebe só os trechos que contêm termos do glossário, com o termo esperado. Apontamentos que
  citam termo ou bloco inexistente são descartados; se todos forem inválidos, a resposta é barrada. A conferência
  determinística do sistema vem junto — a IA reforça, não substitui.
- **Sugerir diagramação**: recebe só a estrutura do documento (papel, tipo de bloco, alinhamento, tamanho, número de
  caracteres), nunca o texto. Responde estilos por papel (dos papéis presentes), campos em tabela e largura do rótulo
  (20–50%). Texto corrido nunca fica centralizado, mesmo que a IA peça.
- **Orientar o processo**: dúvida da pessoa, com a situação da tradução (status, modalidade, idiomas, códigos de
  problemas). Resposta só em texto, até 1.500 caracteres.

Resposta com campo a mais, valor fora da lista, `in_scope: false` ou JSON inválido é **barrada** e registrada.

### "Codificar" é declarar, não executar

Uma combinação de diagramação é uma amostra declarativa (a mesma `LayoutSample` do ADR-020), nunca código. Ela fica como
**proposta** até a pessoa ver a prévia (PDF e Word gerados sem gravar nada) e aprovar. Aprovada, é aplicada pelo
compositor com a verificação de que as palavras do documento não mudaram, vira nova revisão (origem `review`, com a
correção registrada e a autoria) e entra no conhecimento de diagramação: documentos parecidos passam a sair assim sem
precisar da IA. Descartada, não muda nada.

O worker também pede uma proposta em segundo plano quando o sistema não reconhece o documento (modelo genérico sem
composição, ou problema de estrutura) e avisa quem trabalha na tradução. Falha aqui não interrompe o processamento.

### Prompt em camadas

O prompt enviado é: prompt de governança (editável por Líder e Diretor; padrão é o texto pedido) → habilidades ativas →
instruções da tarefa → **regras fixas do sistema** (por último, não editáveis): não alterar texto nem estrutura, não sair
do escopo, responder só no formato pedido, `in_scope: false` para qualquer outro pedido.

### Quem faz o quê

- **Diretor**: liga e desliga a IA; limita qualquer pessoa.
- **Líder (Supervisor)**: modelo, prompt de governança, habilidades; limita as pessoas das equipes que lidera; vê o
  registro das chamadas delas.
- **Pessoas**: usam por padrão, a menos que limitadas. Sem acesso, o pedido é negado e registrado.

A área "Gerenciamento AI" mostra estado, modelo, prompt, habilidades, acesso por pessoa e o registro de chamadas (com as
barradas, negadas e indisponíveis). Na tela da tradução, o painel "Auxílio da IA" fica recolhido e, sem IA, vira uma
linha de aviso.

### Modelo e reserva

O padrão é `gemini-3.5-flash` (migração 0021): o `gemini-2.5-flash` foi retirado pelo Google para chaves novas (404), e
o `gemini-3.8-flash` respondia 503/429 com frequência no plano gratuito no teste real (2026-10-21). Quando o modelo
escolhido responde 404, 429 ou 503, o sistema tenta uma vez o `gemini-3.5-flash-lite` (cota própria, menos de 1 s)
antes de dar a IA como indisponível. O modelo pode ser trocado em Gerenciamento AI.

As respostas sobre o processo se baseiam num guia escrito pelo sistema (`PROCESS_GUIDE`), enviado com a pergunta, e a
situação vai com o nome da tela ("concluída", não `approved`). Dúvida sobre o uso do sistema está no escopo mesmo sem
resposta no guia (a IA orienta procurar o Supervisor); qualquer outro assunto, senha, dado de outra pessoa, acesso ao
servidor, código ou comando é barrado.

### Sem IA, tudo segue

Sem `GEMINI_API_KEY`, desligada, sem cota (429) ou fora do ar (tempo limite de 45 s), a resposta é "indisponível" e
nenhuma etapa da tradução depende dela.

## Consequências

- O texto traduzido nunca passa pela IA na diagramação; no glossário, só os trechos com termos do glossário saem.
- A chave do Gemini fica só no `.env` (nunca no repositório); sem ela, o sistema funciona como antes.
- Combinações aprovadas aumentam o conhecimento de diagramação; uma combinação ruim aprovada influencia documentos
  parecidos até ser superada por conclusões novas.

## Alternativas consideradas

- **Deixar a IA editar o rascunho**: descartado; fere a preservação de texto e estrutura.
- **Gerar código de diagramação**: descartado; executar código vindo da IA abre uma superfície de ataque. A amostra
  declarativa cobre o que se precisa.
- **IA obrigatória no fluxo**: descartado; a IA é auxílio e o sistema precisa seguir sem ela.
