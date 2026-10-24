# ADR-025 — Painéis pessoais, protocolos e fluxo documental rastreável

- Estado: Accepted
- Data: 2026-10-24
- Relacionadas: [ADR-006](006-batch-upload-and-storage.md), [ADR-010](010-review-flow-without-ai.md), [ADR-011](011-hierarchy-numbering-dashboards.md), [ADR-015](015-translation-modes.md), [ADR-017](017-automatic-flow-patterns.md), [ADR-021](021-ai-governance.md), [ADR-023](023-compact-navigation.md)

## Contexto

O início acumulava gráficos e tabelas, a auditoria exigia procurar erros em eventos gerais e as remessas não tinham um protocolo externo obrigatório. O fluxo também precisava registrar a comparação entre original e Word, as etapas reprovadas, mudanças de idioma, retrabalho e o intervalo entre conclusão e download.

## Decisão

### Início e pesquisa

Os indicadores essenciais permanecem visíveis. **Escolher painéis** controla os gráficos complementares; cada painel pode ser ampliado em uma janela modal, ocultado e movido com botões acessíveis pelo teclado. A tendência semanal e o funil são os gráficos iniciais da liderança. Filtros de período/equipe, comparação com o período anterior, tabelas equivalentes e exportação CSV continuam disponíveis. Impressão remove os controles e a janela sobreposta, preservando o conteúdo selecionado.

Seleção e ordem ficam no `localStorage`, com chave separada por usuário e contexto do painel. Essa preferência pertence à conta **neste navegador**; não é sincronizada pelo servidor entre dispositivos. Falha ou bloqueio do armazenamento não impede consultar os painéis.

Diretor e Líder recebem no Início uma pesquisa que agrupa documentos, traduções, protocolos, auditoria, relatórios e equipes. A busca normaliza acentos e maiúsculas, separa tokens e exige que todos apareçam no registro pesquisável; o ranking favorece o título e a frase completa. Também considera nomes de pessoas, metadados, códigos de erro, fases e nomes dos idiomas. É pesquisa determinística, sem chamada de IA. Cada fonte aplica o escopo: Diretor consulta a organização; Líder consulta suas equipes; Operador não consulta esse endpoint de liderança.

### Auditoria e pendências operacionais

A API oferece gravidade, somente erros/emergências e causa do erro, além dos filtros anteriores. A classificação usa metadados e ações objetivas:

| Gravidade  | Exemplos de regra                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `critical` | Bloqueio de revisão, limite de tentativas, evento emergencial ou terceira reprovação consecutiva registrada |
| `error`    | Ação de falha/erro, rejeição de arquivo ou metadado com código de falha                                     |
| `warning`  | Devolução para refazer, rejeição administrativa, bloqueio, cancelamento ou exceção                          |
| `info`     | Demais eventos sem sinal de falha                                                                           |

Uma gravidade explícita válida em `metadata.severity` prevalece. Códigos são lidos de `failureCode`, `failure_code`, `errorCode`, `error_code`, `code` e, em falhas de envio/rejeição de documento, `reason`. A classificação é derivada na leitura e preserva a imutabilidade dos eventos históricos.

Os totais e a quantidade por causa usam **todos** os eventos que atendem aos filtros, sem limitar a contagem à página carregada. A visão de pendências usa a equipe selecionada e o estado atual, independente dos filtros históricos:

- Crítico: três reprovações consecutivas no formato vigente de um trabalho ainda aberto.
- Erro: tradução no estado `failed`.
- Atenção: fila/processamento há pelo menos 30 minutos sem atualização, quando a execução já pode começar.
- Atenção: tradução válida concluída há pelo menos 24 horas sem primeiro download registrado.

A lista prioriza gravidade e antiguidade, informa código, causa, início e duração, e apresenta o total completo mesmo quando limita os itens exibidos. Novos índices em auditoria aceleram consultas por alvo, ação e data.

### Remessa com protocolo e nomes de saída

Toda remessa nova exige exatamente uma das opções:

- Protocolo de 3 a 80 caracteres, começando com letra/número e usando letras, números, espaço, ponto, sublinhado ou hífen.
- Justificativa de ausência de 10 a 1000 caracteres, contendo ao menos uma letra.

A escolha e a justificativa entram no evento `batch.created`. Lotes históricos podem continuar sem esses campos; a atualização não inventa protocolos nem justificativas retroativas.

O nome final conserva o título derivado do original e o sufixo do idioma/modalidade, acrescentando o protocolo na frente: `ABC-10003 – Arquivo-ESP.docx`. Documentos diferentes com o mesmo título recebem ordinais estáveis pela posição no lote: o primeiro conserva o nome e os próximos recebem `(01)`, `(02)` etc. O cálculo também evita colisões com nomes que já contêm ordinal, nomes longos e caracteres que convergem após saneamento. A identidade do documento e seu conteúdo permanecem separados do nome visível.

### Comparação, fases e retrabalho

A área de traduções organiza o trabalho em etapas. A revisão apresenta original e Word lado a lado; a prévia do Word usa o conversor PDF para a visualização. Quando um formato não tem visualização incorporada, a interface informa a limitação e oferece o original para abrir. Comparação visual não é substituída por uma decisão automática de qualidade.

Os PDFs são renderizados localmente por PDF.js, com worker incluído na aplicação. A comparação não depende de plugin PDF do navegador. Cada lado oferece navegação de página, ajuste à largura, zoom de 150%/200% e consulta do texto da página; falhas exibem mensagem e opção de tentar renderizar novamente. O conversor do servidor continua responsável por produzir o PDF a partir do Word; o visualizador apenas apresenta esse PDF.

O ensaio de um novo formato também persiste inspeções, fases com falha e bloqueio após três reprovações. O Word pode ser regenerado com presets reais de alinhamento, e um novo formato precisa mudar a estrutura antes de liberar a geração seguinte. O [ADR-028](028-pattern-trial-reviews.md) detalha esse fluxo, que guarda apenas digests e propriedades de layout, sem o arquivo/texto do ensaio.

Cada inspeção pertence à revisão exata do rascunho e à geração de formato vigente. Uma reprovação exige comentário e pelo menos uma etapa entre correção, tradução, diagramação e revisão. Reprovar duas vezes a mesma revisão não cria tentativas artificiais: é necessário corrigir em uma nova revisão. O responsável ou a liderança pode registrar a inspeção segundo suas permissões. A conclusão final continua sujeita às permissões da liderança.

Após três reprovações consecutivas, o sistema bloqueia novas tentativas, inclusive atalhos de edição/reprocessamento e propostas de IA. Para retomar, é necessário registrar **novo formato**, com nome, explicação e rascunho cuja estrutura/diagramação realmente mudou. Renomear o formato ou alterar somente o texto não basta. O registro cria uma revisão e uma geração novas e reinicia o contador consecutivo; `redo_count` mantém o histórico acumulado. Uma inspeção aprovada também encerra a sequência de reprovações.

Remessas com **20 arquivos ou mais** exigem escolher explicitamente inspeção de todos ou por amostra antes do envio. O modo de amostra cobre os primeiros `min(10, quantidade)` documentos elegíveis, em ordem estável do lote; não é sorteio. A cobertura exige inspeção válida das revisões desses documentos para o mesmo par de idiomas e modalidade. Alterar uma revisão da amostra exige conferi-la novamente. A escolha fica auditada e não aprova automaticamente os documentos.

### Idiomas, IA e alterações de documentos prontos

Português, inglês, francês, espanhol e italiano podem formar os **20 pares direcionais** distintos. O usuário escolhe origem e destino; a troca valida o par, registra motivo e valores anteriores/novos na auditoria, invalida o rascunho/checagens/inspeção anteriores e recoloca o trabalho no fluxo. O processamento gratuito usa o par efetivamente escolhido, mesmo com Gerenciamento AI desativado. As checagens linguísticas não escolhem o idioma de destino pelo usuário.

Propostas de diagramação de IA pertencem a uma revisão. Se o conteúdo ou o par de idiomas mudou, uma proposta antiga não pode ser aprovada: é necessário gerar outra. A IA continua opcional, subordinada às permissões e à aprovação humana já definidas no ADR-021.

Reabrir um documento pronto para mudar conteúdo/idiomas ou reprocessá-lo exige confirmação explícita e motivo. Na reabertura de um documento concluído, o sistema preserva a saída anterior no histórico, registra sua invalidação, revoga a entrega vigente e exige nova revisão/conclusão. O histórico de números emitidos permanece reservado. Mudanças de etiquetas de documentos com traduções prontas exigem confirmação explícita; esse caso não solicita motivo textual.

### Tempos, estimativas e downloads

Cada tradução expõe data de conclusão, tempo total desde a criação, primeira/última entrega de download, espera entre conclusão e primeiro download, tempo pronto sem download e última atividade. A revisão mantém marcos de inspeção e mudanças efetivas; o Líder consulta os tempos individuais no painel da equipe e pode exportá-los no CSV. Os relatórios respeitam o período escolhido; as tabelas de documentos do painel limitam a apresentação aos 300 documentos mais recentes por equipe.

A estimativa de produção usa a mediana de segundos por página das até 50 traduções válidas concluídas mais recentes com **mesmo par e modalidade**, multiplicada pela quantidade de páginas atual. Não depende do tipo documental. Sem histórico comparável, usa `300 + 120 × páginas` segundos, considerando pelo menos uma página. A interface informa a base e a quantidade de amostras; é uma previsão, sem promessa de prazo ou ajuste pela fila concorrente.

Visualizar a prévia PDF ou o original não conta como download da tradução final. O PDF final incorporado também não conta, enquanto `download=true` registra a entrega para baixar. O Word final só registra depois da leitura completa do armazenamento; PDF exige conversão concluída e ZIP exige a preparação de todos os itens. Falha de leitura/conversão antes disso não registra entrega. Os marcos medem a resposta preparada pelo servidor, sem garantia de conclusão do socket ou do salvamento no dispositivo do usuário.

A migração `0025` preenche primeiro/último download e contagem de trabalhos legados concluídos a partir dos eventos `translation.downloaded` posteriores à aprovação, excluindo eventos marcados `metadata.inline=true`. A última atividade conserva a maior data entre a atualização histórica e o último desses downloads; o trigger novo é criado após esse preenchimento. Logs antigos de visualização PDF que não distinguiam `inline` podem estar incluídos; nesses casos, os marcos históricos são aproximados.

### ZIP organizado e limites

Uma remessa ou seleção pode ser exportada em Word ou PDF. Somente traduções concluídas, válidas e acessíveis ao usuário entram no pacote. A estrutura é `protocolo/par/Word ou PDF/arquivo`; ausência justificada usa a pasta `Sem protocolo`. Nomes e caminhos são saneados para impedir travessia de diretórios e colisões.

O limite é de **100 traduções**, **50 MiB por arquivo** e **128 MiB na soma do conteúdo**. O pacote é montado em memória, sem compressão; o cabeçalho/índice do ZIP adiciona pequeno overhead ao tamanho final. Conversão/armazenamento indisponível ou arquivo acima do limite interrompe a operação inteira, sem entregar ZIP parcial nem registrar os itens preparados como downloads.

Depois da preparação completa, `recordDownloads` revalida a conta ativa, cargo, associações atuais e permissão para cada trabalho, além de verificar que os documentos continuam concluídos/válidos e na remessa solicitada. Locks seguem ordem estável. Os marcos e contadores de todos os arquivos, seus eventos individuais e os registros do agrupamento são gravados em **uma única transação**. Qualquer recusa/falha nessa etapa desfaz o registro do pacote inteiro. A garantia transacional é do registro no banco; não confirma recebimento do socket nem salvamento no dispositivo.

## Consequências e verificação

- Migrações `0025_review_lifecycle`, `0026_batch_protocols` e `0027_operational_insights` ampliam o schema sem reescrever migrações anteriores.
- Novos metadados, histórico de inspeções, gerações de formato e versões concluídas tornam as mudanças recuperáveis e auditáveis.
- Inspeção por amostra reduz o trabalho visual e exige decisão explícita; não oferece a mesma cobertura de inspeção integral.
- `audit-search-upgrade.integration.test.ts` cobre isolamento de acesso, contagens além da página, busca por protocolo/tokens/acentos, causas de erro, pendências e tempos. Os testes de protocolos e ciclo de revisão cobrem seus fluxos específicos.
- Em 2026-10-24, o provedor LibreTranslate local anunciou os cinco idiomas e seus destinos. O teste opt-in `multilingual-live.test.ts` comprovou **FR→ES e ES→IT** com texto sintético, adaptador real, DOCX original, extração, rascunho e Word gerado, sem IA nem memória prévia. Isso comprova dois pares reais, não uma verificação de qualidade de todos os 20 pares nem de documentos arbitrários.
- As execuções automatizadas finais registraram 265 testes da API, 70 do core e 11 da interface aprovados, além dos dois casos reais do provedor. A conferência manual de interface tem acompanhamento separado em [testes](../testing.md).

## Alternativas consideradas

Manter todos os gráficos abertos não resolvia a densidade do Início. Aprovação somente pela prévia, sem associar a revisão, permitia aprovar conteúdo diferente do inspecionado. Liberar uma quarta tentativa apenas com um novo nome de formato não comprovaria correção de diagramação. Tornar IA obrigatória impediria a operação local sem chave ou com serviço externo indisponível.
