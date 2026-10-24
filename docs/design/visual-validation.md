# Relatório da reconstrução visual

24/10/2026. Direção escolhida pelo responsável e aplicada ao projeto React/TypeScript existente. Referência funcional: `7458ca4`. A implantação local inclui também os upgrades funcionais previamente autorizados; esta etapa visual não acrescentou regras de negócio.

## 1. Diagnóstico

O CSS anterior tinha 4.356 linhas e várias direções sobrepostas. Havia inconsistência de densidade, gráficos pequenos, índices abaixo do monitor ao vivo, ações dispersas e diferenças de contraste entre os temas. O inventário nominal de todos os componentes e estados está em [visual-audit.md](visual-audit.md). A rastreabilidade da leitura anterior às edições cobre 40 dos 41 TSX; `AutoTranslationNotice.tsx` foi conferido complementarmente, sem edição de fonte. Não se atesta retrospectivamente uma leitura inicial desse arquivo.

## 2. Direção de arte

Grafite, verde sóbrio e branco; títulos Source Serif 4 Variable e corpo/controles Inter Variable, com fontes locais. Densidade compacta, navegação agrupada, documentos em blocos individuais, gráficos maiores e índices prioritários. Bordas finas, raios discretos e pouca sombra. Claro e noturno têm tokens próprios, com papel branco preservado nas prévias reais.

## 3. Arquivos e componentes

Os módulos de apresentação de autenticação, conta, notificações, tradução, entrega, comparação, padrões, modalidades, gestão, numeração, IA, auditoria e painéis receberam classes e composição próprias. `main.tsx`, `ui.tsx` e `Dashboard.tsx` organizam a fundação e o shell. `vite.config.ts`, o manifesto web e o lockfile integram Tailwind e fontes.

Os únicos arquivos da API ajustados nesta fase foram `http/routes.ts` e `modules/translations/service.ts`, **somente pela formatação exigida pelo lint**, registrada separadamente em `fe3834e`. Não houve mudança de contratos, operações ou validações nesses ajustes. As migrações 0029–0032 pertencem ao checkpoint funcional anterior.

## 4. Tokens e padrões reutilizáveis

Tailwind CSS 4.3.3 pelo plugin oficial de Vite. Entrada central `apps/web/src/style.css`, incluindo o seletor de idiomas, com camadas e ordem únicas. `styles/tokens.css` concentra paletas, fontes, semântica, raios, sombras, camadas e durações. `foundation.css` e `components.css` definem base e controles; `account.css`, `documents.css`, `administration.css` e `analytics.css` compõem os domínios. `domain.css` conserva estrutura e geometria documental especializadas.

Valores calculados de zoom, páginas, colunas, progresso, portais e gráficos permanecem dinâmicos. Não foram substituídos por tamanhos fixos. Detalhamento de manutenção em [DESIGN.md](../../DESIGN.md).

## 5. Telas contempladas e evidência de execução

Toda a superfície encontrada nos 41 TSX tem tratamento pelos módulos específicos ou padrões compartilhados. Isso é cobertura de implementação e fonte; a execução abaixo é uma amostra identificada, não toda combinação possível de estado e permissão.

O ensaio usou banco e bucket separados, três contas de demonstração e documentos sintéticos já existentes. Nenhum dado de produção foi substituído para obter capturas. A API de QA ficou em 3001 e o frontend em 5174. A ausência de worker nesse banco foi exibida pelo alerta real, sem ocultação.

| Cenário executado no navegador                                                                                | Resultado observado                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Diretor: Início/organização, qualidade, comparação com IA; Líder: equipe; Usuário: desenvolvimento individual | Índices, filtros e escopos de navegação existentes preservados; valores individuais incluem somente seu trabalho       |
| Painel ampliado e Escape                                                                                      | Janela centralizada, gráfico maior, rolagem interna e fechamento funcionando                                           |
| Traduções por fases, filtros e listas                                                                         | Blocos individuais com situação, protocolo, par, responsável e ações                                                   |
| Busca de idiomas `fra esp` e Enter                                                                            | Lista flutuante apresentou Francês → Espanhol e selecionou FR → ES                                                     |
| Documento em revisão                                                                                          | Original e Word renderizados de verdade, em páginas brancas; conferência, motivo anterior e ações existentes presentes |
| Entregas e ZIP                                                                                                | Metadados preservados; seleção carregada marcou o documento e habilitou os dois ZIPs                                   |
| Janela Salvar arquivos e Escape                                                                               | Word/PDF/original e opções de ZIP presentes; centralização, limites e retorno ao botão funcionaram                     |
| Equipes, cotas, tradutores, formulário de cadastro sem salvar                                                 | Campos, estados vazios e permissões de gestão presentes                                                                |
| Glossário, regras, tipos de documento, governança/indisponibilidade de IA, provedores                         | Composição, formulários e mensagens reais exibidos                                                                     |
| Auditoria: filtro de erros/emergências                                                                        | Contadores e registros filtrados carregados, com severidade e detalhes preservados                                     |
| Administração: pendentes e usuários                                                                           | Vazio de cadastros e lista de pessoas exibidos; nenhuma promoção, suspensão ou exclusão acionada                       |
| Preferências, notificações, senha e sessões                                                                   | Categorias/canais, leitura, campos e controles presentes; credenciais não alteradas                                    |
| Claro → noturno → claro no Diretor                                                                            | Preferência salva com feedback; superfícies, tipografia e contraste acompanharam o tema                                |
| Entrada e Solicitar acesso                                                                                    | Telas e formulário exibidos; cadastro não enviado                                                                      |
| 1280×720, 768×900 e 320×800                                                                                   | Desktop, comparação intermediária e amostras móveis conferidos; sem transbordamento da página nos casos medidos        |

As amostras de 320 px incluíram preferências, traduções, revisão, entrega, histórico e desenvolvimento individual; 768 px incluiu a comparação real lado a lado. Não se afirma que cada tela foi executada em todas essas dimensões e temas. O viewport temporário foi restaurado.

## 6. Preservação funcional

Revisões independentes dos diffs e comparação AST conferiram os controles, callbacks, hooks, dependências, condições de renderização e atributos funcionais das frentes de documentos, administração/análise, conta e shell. A apresentação tabular de entregas virou lista sem perder campos, seleção ou menu. A fila ao vivo permaneceu montada; os índices foram reposicionados sem alterar os cálculos. O seletor manteve portal, teclado e geometria.

A identidade JSX de ticks repetidos foi tornada única, sem alterar os valores do gráfico. Não houve novas chamadas HTTP, persistência, regras, integrações, permissões ou funcionalidades no redesenho. Essa evidência estática e os cenários de navegador reduzem o risco de regressão; não equivalem a uma prova exaustiva de todos os fluxos.

## 7. Verificações executadas

| Verificação                                            | Resultado                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Build de todo o workspace                              | Aprovado: web, core, API e worker                               |
| Build web após os últimos ajustes de CSS               | Aprovado                                                        |
| Typecheck de todo o workspace                          | Aprovado                                                        |
| Lint de todo o workspace                               | Aprovado após corrigir a formatação dos dois arquivos da API    |
| Testes web após a reconstrução                         | **25/25**, zero falhas e zero pulados                           |
| Console das abas de QA e da entrada na versão entregue | Sem erros capturados na revisão final                           |
| `git diff --check`                                     | Aprovado                                                        |
| Docker: build, subida sem remover volumes e migrações  | Aprovado; 0029–0032 aplicadas e migrador saiu com código 0      |
| API `/health/ready`, web 5173 e heartbeat do worker    | Banco/armazenamento OK, web HTTP 200, sinal recente presente    |
| Navegador na versão Docker 5173                        | Tela de entrada com novo estilo carregada, sem erros capturados |

Antes desta etapa visual, **311/311 testes da API, 74/74 do core e dois ensaios reais FR→ES/ES→IT** já haviam passado. Não foram executados novamente nesta etapa, pois nenhuma lógica correspondente foi alterada. Esses resultados são históricos separados dos 25 testes web atuais. Detalhes em [TESTING.md](../TESTING.md).

O build avisa que o chunk principal tem aproximadamente 530 kB minificado. Não houve erro de compilação. Dividir a aplicação em novos pontos de carregamento não fez parte do redesenho.

## 8. Problemas encontrados e corrigidos

- A importação antecipada do CSS do seletor declarava a camada de componentes antes da base Tailwind; a base anulava bordas e espaçamentos. Importação central corrigida e aparência conferida novamente.
- Atalhos da conta tinham contraste e larguras inadequados pela especificidade da cascata. Seletores desktop/móvel corrigidos.
- Diálogos ficaram no canto após o reset de margem e herdavam desfoque excessivo. Margem automática e backdrop discreto aplicados e medidos no navegador.
- O helper da nova senha esticava o campo de confirmação. Campos alinhados ao topo e conferidos com a mesma altura, sem troca de credenciais.
- “Sem conclusões” ultrapassava um indicador de 320 px. Escala responsiva corrigida e largura medida sem transbordamento.
- Datas estreitas cortavam parte do texto em 320 px. Agrupamento em duas linhas preservou campos e rótulos.
- Texto pequeno em rampas e barras de gráfico tinha contraste insuficiente. Tokens ajustados; cálculos das combinações utilizadas deram mínimo de 4,72:1 no heatmap escuro e 4,54:1 nas séries claras com percentual. Isso não certifica todos os pixels/estados do sistema.
- Ticks com valores arredondados repetidos usavam a mesma key React. Identidade de renderização corrigida; cálculos e rótulos preservados.
- A folha HTML de edição recebia negrito, espaçamento de seções e regras de borda/hover das tabelas da interface. Os novos seletores de UI agora excluem `.paper`; o negrito nativo foi restaurado. A comparação com o CSS anterior confirmou a separação necessária. Papel branco, Times New Roman de 14,7 px e peso 700 dos destaques foram conferidos no navegador; tabelas e seções seguem as regras originais, revisadas em fonte.

## 9. Limitações e verificações não realizadas

Não foi executada a matriz completa de telas × papéis × dados × temas × resoluções. A configuração inicial sem Diretor, molduras/estoques preenchidos, todos os estados persistidos de ensaio, notificações nativas, leitor de tela e impressão física não receberam nova validação visual exaustiva nesta etapa. Não se atribui aprovação integral a esses casos pela cobertura de fonte.

As janelas nativas de “Salvar como”/Explorer e notificações do Windows não foram testadas de ponta a ponta. A lógica de salvamento tem testes e o download comum foi conferido anteriormente, mas isso não comprova a experiência nativa do Windows. Não há garantia de entrega em disco a partir do marco de download da API.

Interações preexistentes que exigiriam mudança comportamental — como navegação por setas em certos segmentados, seleção de algumas linhas por clique e pausa de toast ao receber foco — foram preservadas, sem certificação geral de acessibilidade. A ausência de chave da IA permanece uma condição operacional, não um erro escondido pelo visual.

## 10. Checklist de aceitação

“Aprovado” se limita à evidência indicada. “Não verificado” não representa ausência de implementação. Não há aprovação integral de todos os critérios.

| Critério                                                       | Situação                             | Evidência/limite                                                  |
| -------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Tailwind integrado e utilizado                                 | Aprovado                             | Plugin Vite, módulos `@apply`, build e navegador                  |
| Direção de arte e temas implementados                          | Aprovado                             | Tokens e telas inspecionadas                                      |
| Todas as interfaces encontradas contempladas no código         | Aprovado                             | Inventário de 41 TSX e padrões compartilhados                     |
| Auditoria integral comprovadamente anterior a qualquer edição  | Não verificado                       | Rastreabilidade inicial de 40/41; complemento explicitado         |
| Componentes recorrentes padronizados                           | Aprovado                             | Fundação, conta, documentos, gestão e análise                     |
| Tokens centrais e manutenção modular                           | Aprovado                             | Entrada única, tokens e documentação                              |
| Hierarquia e espaçamentos                                      | Aprovado nas amostras                | Índices antes da fila, blocos e formulários conferidos            |
| Ícones, cores e estados                                        | Aprovado nas amostras                | Texto predomina; semântica e foco preservados                     |
| Responsividade em todas as telas/dimensões suportadas          | Não verificado integralmente         | Amostras reais em 320, 768 e 1280 px                              |
| Todos os estados interativos visualmente refinados em execução | Não verificado integralmente         | Cobertura de fonte e amostra de execução; casos listados acima    |
| Nenhuma função removida ou deliberadamente alterada            | Aprovado na revisão                  | AST/diffs e cenários executados                                   |
| Nenhuma funcionalidade nova no redesenho                       | Aprovado                             | Diff restrito à apresentação, dependências visuais e documentação |
| Nenhuma regressão conhecida introduzida                        | Aprovado nas verificações realizadas | Casos encontrados corrigidos; sem garantia exaustiva              |
| Compilação, tipos, lint e testes disponíveis pertinentes       | Aprovado                             | Comandos e contagens efetivamente executados acima                |
| Limitações e pendências documentadas                           | Aprovado                             | Seções 5, 7 e 9                                                   |

Capturas locais de QA ficam em `tmp/visual-*.png` (fora do Git), com dados sintéticos: início claro, auditoria noturna, comparação real a 768 px, início individual e entrega a 320 px. A aplicação entregue está em **http://localhost:5173/**; os serviços de QA são temporários e separados.
