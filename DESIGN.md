# Design da interface web

Direção aprovada para `apps/web` (protótipo de 2026-10-25): **mesa de conferência editorial**. A interface usa grafite e cinza-azulado, e as ações principais são pretas. Não há verde. Listas e painéis não usam caixas: as seções começam com uma linha fina, as listas usam placas fantasma que aparecem ao passar o mouse, e os números ficam em réguas. A marca da interface é a **linha do fluxo**, com seis trechos (Envio, Tradução, Revisão, Prévia em Word, Conclusão e Word final). Ela aparece em três escalas: na linha da lista, no cabeçalho do detalhe e na régua proporcional do "Agora".

O produto e seus papéis estão em [PRODUCT.md](PRODUCT.md). O contrato visual está em [.impeccable/briefs/web-app.md](.impeccable/briefs/web-app.md). Os valores estão em [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css).

## Estrutura

- **Menu lateral grafite fixo** (15,5rem), com os grupos Visão geral, Operação e Gestão. Cada área tem um ícone de traço fino. A área ativa tem fundo grafite claro e ícone azul-aço. "Minha conta" (Notificações, Configurações e Sair) fica no pé do menu.
- **Barra superior compacta**:
  - pesquisa global (**Ctrl+K**, ⌘K ou **/**), que abre a paleta de telas e documentos;
  - sino com painel suspenso, em duas abas: "Precisa de você" e "Atualizações", com link para a lista completa;
  - alternância de tema;
  - menu da conta: nome, e-mail, papel, Configurações e Sair.
- **Celular** (até 800px): o menu lateral dá lugar a uma barra inferior com três áreas e "Mais". "Mais" abre uma folha com as demais áreas, Notificações, Configurações e Sair. A pesquisa vira um ícone na barra superior.
- **Carregando**: uma linha fina sob a barra superior, sem caixa, aparece enquanto há requisições visíveis. A consulta periódica de notificações não aciona a linha. Onde antes havia "Carregando…", fica um indicativo pequeno de três pontos, com `role="status"`.
- **Atalhos de teclado** (`shortcuts.tsx`): no máximo duas teclas.
  - **G** e depois a letra da área: I, T, H, E, A, D, N, U, C e Z.
  - **N** para Nova tradução, **B** para o sino, **T** para o tema, **[** e **]** para trocar de aba.
  - **Ctrl+S** salva na revisão; **?** mostra a lista.
  - Ao passar o mouse ou focar uma ação com atalho, uma dica mostra as teclas. No menu lateral, a dica fica ao lado.
- **Ajustes, Administração, Tutorial e Configurações** usam um menu secundário à esquerda. As demais áreas usam abas com sublinhado que desliza.
- **Tutorial** (em "Minha conta", para todos os papéis): uma seção por assunto, com "Para que serve", passos numerados, fotos reais das telas (`apps/web/public/tutorial/`) e o botão "Abrir esta tela". As seções seguem o papel da pessoa.

## Cor e temas

As variáveis legadas (`--paper`, `--sheet`, `--rule`, `--ok`, `--menu-*`, `--chart-*`) continuam como apelidos dos papéis novos. Os nomes semânticos para utilidades Tailwind são: `bg-canvas`, `bg-surface`, `bg-ghost`, `text-ink`, `text-ink-2`, `text-muted`, `text-accent` e `border-line`.

| Papel                      | Claro     | Escuro    |
| -------------------------- | --------- | --------- |
| Mesa (`--canvas`)          | `#f6f8fa` | `#111418` |
| Superfície (`--surface`)   | `#ffffff` | `#191c20` |
| Placa fantasma (`--ghost`) | `#eaeef3` | `#1e2227` |
| Linha (`--rule`)           | `#dce0e5` | `#2a2e33` |
| Texto (`--ink`)            | `#1a1e25` | `#eef0f3` |
| Texto 2 (`--ink-2`)        | `#424850` | `#c0c4cb` |
| Texto apagado (`--muted`)  | `#5d646c` | `#a0a5ac` |
| Ação (`--primary`)         | `#000000` | `#f2f4f6` |
| Azul-aço (`--accent`)      | `#3c5b8a` | `#91b4e1` |
| Menu (`--menu-bg`)         | `#161a1f` | `#0a0c10` |
| Aviso (`--warn`)           | `#804d18` | `#e7b369` |
| Erro (`--danger`)          | `#aa2a27` | `#f08f87` |
| Juramentada (`--plum`)     | `#71426d` | `#cf9fc9` |

Regras de cor:

- **Concluído é azul-aço**, nunca verde. `--ok` aponta para o acento.
- Aviso, erro e ameixa têm fundos suaves próprios e sempre vêm acompanhados de texto.
- Os pares de texto e fundo foram medidos e passam WCAG AA nos dois temas. Exemplos: texto apagado sobre a mesa, 5,6:1 no claro e 7,5:1 no escuro; azul-aço sobre a mesa, 6,5:1 no claro e 8,6:1 no escuro.

**Gráficos**: a paleta categórica tem ordem fixa e foi validada para daltonismo no claro e no escuro.

| Série      | Claro     | Escuro    |
| ---------- | --------- | --------- |
| Principal  | `#4e78c7` | `#5695e0` |
| Comparação | `#af7528` | `#bd871c` |
| Terceira   | `#744276` | `#9e5598` |
| Contexto   | `#c6ccd3` | `#3a3f46` |

- Os desfechos (acerto, refeita, justificada) seguem a mesma ordem.
- O mapa de calor usa uma rampa de um tom só, em azul-aço, com passos próprios no escuro.
- Toda série tem legenda ou rótulo direto, dica ao passar o mouse e tabela equivalente.

## Tipografia

Uma família só: **Schibsted Grotesk Variable**, instalada como dependência local (`@fontsource-variable/schibsted-grotesk`).

- Corpo de 15px, entrelinha 1,5.
- Títulos na mesma letra, mais pesados (740–780), com espaçamento negativo e quebra equilibrada.
- Rótulos de 13–14px. Nada de 11px no texto de trabalho.
- Números com `tabular-nums`, sem fonte monoespaçada.
- Tamanhos grandes com teto (2026-10-28), em `tokens.css`. Crescem com a tela só até o limite:

  | Token | Uso | Tamanho |
  | --- | --- | --- |
  | `--text-title` | títulos de tela | 22–28px |
  | `--text-figure` | números dos quadros | 24–32px |
  | `--text-figure-lg` | total do painel Agora | 28–36px |
  | `--text-display` | tela de entrada | 24–32px |

- Valor em palavras num quadro de número ("Sem conclusões") usa o tamanho de texto (18px).
- Gráficos desenham na largura real do espaço: o texto dos eixos fica em 12px em qualquer tela.

### Celular

- Nada passa da borda da tela.
- Abas e submenus quebram em linhas.
- Tabelas viram cartões, com o nome da coluna acima de cada valor (`table-labels.ts`). A prévia do documento fica como o original.

## Forma

- Botões em pílula. O primário é preto (claro no tema escuro). O secundário tem um anel fino. O fantasma não tem contorno.
- Raios de 10px nos controles, 12px nos painéis e 16px nas janelas.
- Sombra só em janelas, menus e dicas. Painéis não têm sombra.
- Situações aparecem em pílulas suaves.
- **Sem cartões**. Um `.card` é só um agrupamento que começa numa linha fina. Listas usam linhas com divisória e uma placa fantasma que se materializa (desfoque e opacidade) ao passar o mouse.
- Números ficam em réguas com divisões finas.
- Filtros formam uma linha corrida, sem painel em volta.
- Movimento de 120–240ms com `cubic-bezier(0.2, 0, 0, 1)`. Menus e painéis aparecem como fantasmas (desfoque, opacidade e um leve deslocamento). Tudo respeita `prefers-reduced-motion`.

## Telas

- **Início**:
  - régua de números com variação;
  - "Agora", com régua proporcional da fila por etapa, total grande e últimos eventos;
  - gráficos em grade, separados por linha de topo.
- **Traduções**:
  - fases como régua de seis trechos com contagem;
  - lista corrida em que cada linha traz a linha do fluxo em miniatura, a situação em texto e a ação.
- **Detalhe**:
  - título grande e a linha do fluxo com a etapa atual em azul-aço;
  - original e Word lado a lado, com a moldura da própria folha;
  - módulos recolhíveis com seta que gira;
  - entrega final em fundo azul-aço suave;
  - barra **Próximo passo** (`NextStepBar.tsx`) presa no pé da tela, com filete azul-aço. Ela mostra a etapa atual, o que falta e as ações: conferência, Reprovar…, Aprovar e concluir, Concluir, Assumir, Salvar e baixar o Word final. Os botões que levam a outra parte da tela rolam até ela.
- **Nova tradução**: quatro etapas numeradas, ligadas por uma linha. A sequência é real.
  - Os botões Voltar, Continuar e Cancelar ficam presos no pé da tela, com "Etapa X de 4" e o que falta.
  - A cada etapa, a tela volta para o topo do formulário e o foco vai para a etapa atual.
- **Notificações**: lista corrida. As não lidas levam um ponto azul-aço e título mais forte.
- **Entrada**: tela dividida. A metade da marca, em grafite, traz o nome, a frase do produto e a linha do fluxo. A outra metade traz o formulário na mesa.

## Word, PDF e geometria dinâmica

A folha do Word e a página do PDF continuam **brancas** nos dois temas, com as fontes e medidas do arquivo real. Estilos calculados a partir dos dados continuam dinâmicos:

- larguras e células mescladas das tabelas do documento;
- canvas do PDF, página e zoom;
- percentuais de envio;
- barras, séries, coordenadas e intensidade dos gráficos;
- posição de listas flutuantes.

## Implementação

Tailwind CSS 4.3.3 entra pelo `@tailwindcss/vite`. A única entrada de estilos é [`apps/web/src/style.css`](apps/web/src/style.css).

| Arquivo                     | Responsabilidade                                                                  |
| --------------------------- | --------------------------------------------------------------------------------- |
| `styles/tokens.css`         | Primitivos (grafite, aço), papéis semânticos dos dois temas, gráficos e movimento |
| `styles/foundation.css`     | Base, tipografia, campos, foco e movimento reduzido                               |
| `styles/domain.css`         | Regras de domínio preservadas (folha do documento, máscaras, numeração)           |
| `styles/components.css`     | Estrutura, barra superior, paleta, sino, botões, abas, listas e celular           |
| `styles/account.css`        | Entrada, configurações, notificações, confirmação e avisos                        |
| `styles/documents.css`      | Envio, lista, fases, linha do fluxo, comparação e entrega                         |
| `styles/administration.css` | Equipes, tradutores, numeração e administração                                    |
| `styles/analytics.css`      | Início, gráficos, "Agora", relatórios e minha fila                                |
| `styles/tutorial.css`       | Tutorial: passos, fotos e problemas comuns                                        |

Componentes de estrutura:

- `icons.tsx`: ícones de traço fino;
- `CommandPalette.tsx`: Ctrl+K;
- `shortcuts.tsx` e `shortcut-keys.ts`: atalhos, dica e lista de atalhos;
- `BellPanel.tsx`: sino;
- `LoadingLine` e `LoadingHint` em `ui.tsx`;
- `FlowGlyph` em `Flow.tsx`;
- `Tutorial.tsx` e `styles/tutorial.css`;
- `pdf-polyfills.ts` e `pdf-worker.ts`: complementos para o PDF.js 6 em navegadores sem os recursos mais novos do JavaScript.

## Acessibilidade e preservação funcional

A reconstrução é visual. Endpoints, permissões, requisições, regras, validações, fluxo de aprovação, confirmações e documentos gerados não mudam. A interface preserva:

- nomes acessíveis, `aria-*`, foco visível e navegação por teclado (a paleta navega por setas, Enter e Esc, e os menus fecham com Esc);
- estados de carregamento, vazio e erro;
- área de toque de 44px em telas de toque.
