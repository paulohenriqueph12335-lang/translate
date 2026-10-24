# Design da interface web

Direção confirmada para `apps/web`: uma aplicação corporativa discreta, compacta e clara para o trabalho documental. Grafite, verde sóbrio e branco sustentam a hierarquia. O conteúdo, os indicadores e a próxima ação recebem mais atenção que a decoração.

O produto e seus papéis estão em [PRODUCT.md](PRODUCT.md). O contrato visual está em [.impeccable/briefs/web-app.md](.impeccable/briefs/web-app.md). O inventário e o diagnóstico da auditoria estão em [docs/design/visual-audit.md](docs/design/visual-audit.md). A validação de execução será registrada separadamente em `docs/design/visual-validation.md`.

## Identidade e hierarquia

- Títulos em **Source Serif 4 Variable**, com peso 600 e entrelinha curta; corpo e controles em **Inter Variable**.
- Corpo base de **13px**, entrelinha 1,55. Rótulos e metadados usam uma escala compacta, mantendo os textos de trabalho legíveis.
- Texto predominante. Ícones ficam restritos a funções que se beneficiam deles e conservam nome acessível.
- Menu organizado por grupos de trabalho e administração, com item ativo reconhecível por forma, contraste e texto.
- Documentos em **blocos individuais** compactos: nome e protocolo identificam o documento; situação, idiomas, equipe, responsável e tempos têm alinhamento consistente; as ações ficam claramente associadas ao bloco.
- Dashboards reservam áreas maiores para gráficos e dão prioridade aos índices, seus rótulos e períodos. Filtros e ações secundárias ocupam menos espaço.
- Bordas finas, cantos discretos e pouca sombra. Colchetes ornamentais, traços decorativos e botões com metáforas de tinta deixam de definir a interface.

## Cor e temas

[`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css) é a fonte dos valores. As variáveis legadas `--ink`, `--paper`, `--sheet` e `--rule` continuam como aliases para os componentes existentes. As utilidades Tailwind usam nomes semânticos: `bg-canvas`, `bg-surface`, `text-ink`, `text-muted`, `text-accent` e `border-line`.

| Papel                              | Tema claro | Tema escuro |
| ---------------------------------- | ---------- | ----------- |
| Fundo da aplicação (`--paper`)     | `#f4f6f4`  | `#141d17`   |
| Superfície (`--sheet`)             | `#ffffff`  | `#1c2820`   |
| Superfície elevada (`--raised`)    | `#fafcfb`  | `#233128`   |
| Texto principal (`--ink`)          | `#222e27`  | `#e8efe9`   |
| Texto secundário (`--muted`)       | `#59685f`  | `#a6b8ac`   |
| Borda (`--rule`)                   | `#dce4de`  | `#34483a`   |
| Acento (`--accent`)                | `#28634d`  | `#91cbaa`   |
| Texto sobre acento (`--on-accent`) | `#ffffff`  | `#132e20`   |
| Menu (`--menu-bg`)                 | `#18251e`  | `#101b14`   |

Os dois temas devem oferecer a mesma hierarquia, densidade, ações e estados. A aparência acompanha a preferência da conta ou do sistema conforme a opção existente. Fundos, texto, bordas, controles, menus, notificações e gráficos recebem tokens próprios para cada tema.

Verde é o acento de interação. Sucesso, aviso e erro mantêm tokens semânticos independentes e identificação textual. Um bloqueio, uma reprovação ou uma falha técnica não podem depender apenas da cor. O texto sobre acento usa `--on-accent`, inclusive no tema escuro.

Os gráficos usam verde, neutros e cores de estado. Nomes legados como `--chart-blue` permanecem por compatibilidade, mas o valor atual é verde. Séries comparadas conservam legenda e diferenciação de traço ou forma; mapas de calor usam a rampa de tokens do tema. A equivalência em tabela e os controles existentes de período e comparação permanecem disponíveis.

Contraste de texto, controles, foco e estados deve ser verificado nos dois temas durante a validação. Esta documentação define a direção e os critérios; não certifica uma medição ou uma aceitação de navegador.

## Tipografia e medidas

| Uso                           | Direção                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| Corpo                         | Inter Variable, 13px, entrelinha 1,55                              |
| Títulos                       | Source Serif 4 Variable, peso 600, escala conforme o nível         |
| Controles e rótulos           | Inter, com densidade compacta e nomes claros                       |
| Índices                       | Valor forte, números tabulares e contexto próximo                  |
| Código e referências técnicas | Cascadia Code, Consolas ou fallback monoespaçado                   |
| Documento impresso            | Fonte e medidas do documento real; não herda a escala da aplicação |

As fontes variáveis são dependências locais do web app. Contadores e índices não precisam de uma fonte monoespaçada: `font-variant-numeric: tabular-nums` mantém comparabilidade sem aumentar o ruído.

Os raios centrais são **6px** para controles, **8px** para painéis e **10px** para diálogos. A borda estrutural é de 1px. Espaçamento parte de unidades de 4px, com grupos próximos de 8–16px e separação maior entre assuntos. Sombra serve apenas à separação discreta de superfícies e sobreposições.

## Composição das telas

A tela deve apresentar título, contexto breve e ação principal com uma ordem consistente. Formulários agrupam campos relacionados; filtros se alinham e quebram linha em larguras pequenas; ações secundárias permanecem reconhecíveis. A reconstrução visual conserva as condições de abertura dos detalhes e dos diálogos existentes.

Na tradução, as quatro etapas de entrada e as fases de produção continuam com seus rótulos, ordem, estados e bloqueios. A comparação original × Word ocupa a área principal quando necessária. Conferência obrigatória, erros, pedidos para refazer, numeração e bloqueios por reprovação continuam expostos nas condições funcionais existentes.

Listas documentais usam cartões individuais e mantêm seleção, etiquetas, filtros, paginação e entrega associados ao documento. Tabelas que precisam continuar tabulares preservam cabeçalhos e rolagem própria, sem cortar ações em telas estreitas. O tema não deve ocultar conteúdo com `overflow` para compensar um problema de largura.

## Word, PDF e geometria dinâmica

A folha do Word e a página renderizada do PDF continuam **brancas** nos dois temas, com texto, fontes, alinhamentos, tabelas e proporções do arquivo real. O ambiente da comparação acompanha o tema; o conteúdo impresso conserva sua aparência documental.

Estilos calculados a partir dos dados permanecem dinâmicos:

- larguras de colunas, alinhamento e células mescladas das tabelas do documento;
- dimensões e resolução do canvas PDF, página selecionada e zoom;
- percentuais de upload e processamento;
- barras, séries, coordenadas, cores por intensidade e dicas dos gráficos;
- posição das listas flutuantes e outros controles ancorados.

Esses estilos não devem ser substituídos por utilidades fixas. Em particular, forçar `width: 100%` no canvas eliminaria o comportamento de zoom. A remoção de estilos inline estáticos não autoriza alterar a geometria gerada por dados.

## Implementação e manutenção

Tailwind CSS **4.3.3** é integrado ao Vite por `@tailwindcss/vite`. [`apps/web/src/style.css`](apps/web/src/style.css) é a única entrada de estilos da aplicação, incluindo o CSS do seletor de idiomas.

| Arquivo                     | Responsabilidade                                               |
| --------------------------- | -------------------------------------------------------------- |
| `styles/tokens.css`         | Paletas, fontes, raios e aliases semânticos dos temas          |
| `styles/foundation.css`     | Base, tipografia, campos, foco e movimento reduzido            |
| `styles/domain.css`         | Regras documentais e estruturais preservadas do domínio        |
| `styles/components.css`     | Shell, navegação e componentes compartilhados                  |
| `LanguagePairPicker.css`    | Campo pesquisável, lista flutuante e estados do par de idiomas |
| `styles/account.css`        | Autenticação, conta, preferências, notificações e confirmação  |
| `styles/documents.css`      | Entrada, cartões documentais, fluxo, comparação e entrega      |
| `styles/administration.css` | Equipes, tradutores, numeração e administração                 |
| `styles/analytics.css`      | Dashboards, gráficos, auditoria, relatórios e workspace        |

Os módulos referenciam Tailwind e os tokens com `@reference` e usam camadas `base` ou `components`. Utilidades de layout e espaçamento podem compor a marcação. Tokens e controles compartilhados devem ser corrigidos na origem, evitando sucessivas camadas de sobrescrita por tela.

## Acessibilidade e preservação funcional

Preservar rótulos, nomes acessíveis, foco visível, navegação por teclado, `aria-*`, feedbacks, estados de carregamento, desabilitação, erros e vazios. Diálogos mantêm fechamento, cancelamento, foco e prevenção de cliques repetidos. Movimento respeita `prefers-reduced-motion`.

Esta reconstrução é visual: não altera endpoints, permissões, regras, requisições, callbacks, validações, fluxo de aprovação, confirmações ou conteúdo gerado. A auditoria de código e a validação real têm registros separados; a conclusão visual depende das evidências de execução.
