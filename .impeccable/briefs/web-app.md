# Interface web — contrato visual

Produto: Tradutor Documental, descrito em [PRODUCT.md](../../PRODUCT.md). Escopo desta reconstrução: só a apresentação da aplicação inteira (`apps/web`), preservando comportamento, permissões, rotas, integrações, dados e documentos gerados. Backend e banco não mudam.

Modo da superfície: **Operate**. A pessoa vem cumprir tarefas; o mundo visual entra por tipo, paleta, densidade e um movimento de assinatura, nunca pela organização das telas ou pelos controles.

## Direction contract

Situação: proposta de 2026-10-25, a partir do questionário respondido pelo responsável; a aprovação acontece pelo protótipo de três telas (Início, lista de traduções, detalhe) antes de qualquer mudança no sistema.

THESIS: a mesa de conferência. O documento é o protagonista e a interface é a mesa onde ele passa pelas etapas. Recusa o painel SaaS de cartões e tabelas: listas fluidas de linhas fantasmas, números editoriais e gráficos assentados no próprio plano, sem moldura.

OWN-WORLD: grafite azulado (menu `#161a1f`, mesa `#f6f8fa`, folha e janela `#ffffff`), tinta `#1a1e25`, azul-aço `#3c5b8a` só para foco, seleção e série em destaque, preto puro `#000000` para comprometer (concluir, enviar, salvar); ocre `#af7528` e ameixa `#744276` só em dados. Nada verde. Schibsted Grotesk como família única (corpo 15px, títulos 700–800, algarismos tabulares em colunas). Pílulas para ações e situações, cantos 8/12px, sombra só no que flutua, ícones de traço 1,5px.

STORY: quem opera entende em segundos o que está com ele e em que etapa cada documento está, confia que nada se perde, compara original e Word lado a lado, conclui com ou sem tradutor juramentado e entrega.

FIRST VIEWPORT: menu grafite fixo à esquerda com os grupos Visão geral, Operação e Gestão; barra superior compacta com busca (Ctrl+K), sino, tema e pessoa. Início do Diretor: título, período e equipe à direita; quatro números com variação (44–56px) numa linha; tendência semanal em largura total; linha "Agora" com as etapas proporcionais; grade de gráficos em duas colunas. Lista: abas de etapa com contadores, uma linha de busca e filtros, linhas de duas linhas; "Nova tradução" em pílula preta no topo à direita. Detalhe: título, linha do fluxo compacta, original e Word como folhas brancas lado a lado, painel de conclusão destacado à direita.

FORM: 1ª da minha lista — lista fantasma com a linha do fluxo como movimento de assinatura: o andamento desenhado como uma linha segmentada de seis trechos em três escalas (linha da lista, cabeçalho do detalhe, distribuição "Agora" no Início). Gramática de movimento "fantasma": placas e menus que se materializam (opacidade e desfoque de 4px para 0, 160–200ms); a linha que muda pisca uma vez em azul-aço. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Pedidos do responsável que valem para todas as telas

- Sem verde em lugar nenhum; "concluído" é azul-aço com ícone de confirmação e texto.
- Sem tabelas e sem cartões artificiais na apresentação; resultados e gráficos sem tabela visível (a tabela existe só para leitores de tela).
- Carregamento discreto, sem caixa: uma linha fina no topo e um indicativo pequeno que só aparece enquanto carrega; o conteúdo anterior fica esmaecido em vez de piscar.
- Mudanças suaves (150–200ms) e respeito a "reduzir movimento".
- Edições em painel lateral; avisos no canto inferior direito; notificações pelo sino com link para a lista completa.
- Usuário (operador) vê pouco e foca em "minha fila", com gráficos chamativos e sem cartões.
- Desktop primeiro, tudo funcionando no celular (barra inferior); contraste WCAG AA em claro e escuro.

## Documento e funcionalidade

Word e PDF exibem a folha branca real, inclusive no modo escuro. Fontes impressas, alinhamento, tabelas do documento, células mescladas e proporções não recebem o estilo tipográfico da aplicação. Canvas e zoom, progresso, posições de dicas e dimensões calculadas por dados conservam sua geometria dinâmica.

Nenhum novo endpoint, fluxo, regra ou validação faz parte desta reconstrução. Requisições, callbacks, permissões, confirmações e acessibilidade existentes devem ser preservados.

## Sistema de implementação

Tailwind CSS 4.3.3 via Vite. Uma entrada central `apps/web/src/style.css` importa Tailwind, tokens, base, módulos de domínio e `LanguagePairPicker.css`. Os tokens em três camadas (primitivo, semântico, componente) ficam em `styles/tokens.css` e são expostos ao Tailwind por `@theme inline`; o tema escuro usa `data-theme="dark"`. [DESIGN.md](../../DESIGN.md) registra os critérios de manutenção e será reescrito ao final desta reconstrução.
