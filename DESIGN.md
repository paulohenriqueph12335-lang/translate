# Design

<!-- Sistema visual da interface web (apps/web). Produto em PRODUCT.md; direção em .impeccable/briefs/web-app.md. -->

## Ideia

Papel e tinta da tradução juramentada, em linguagem contemporânea. Cada traço vem de uma convenção do documento
juramentado:

| Convenção do documento | Na interface |
| --- | --- |
| Notas do tradutor entre colchetes ("[Assinatura ilegível]") | Marca `[—]` e etiquetas de situação: `[Para revisar]`, `[Concluída]` |
| Traço de inutilização que fecha o espaço em branco | Linha tracejada que fecha o título de cada área e o formulário de entrada |
| "Tradução Pública nº … – Livro … – Folha …" | Números, contadores e indicadores em mono tabular |
| Tinta preta sobre papel | Menu e ações em preto, chão off-white, estrutura em cinzas |

## Cor

Estratégia: restrita. Sem cor de marca; cor só para estado. Tema único claro (uso em escritório, durante o expediente).

| Token | Valor | Uso |
| --- | --- | --- |
| `--ink` | `#121212` | Menu, botão principal, texto, aba e item ativos |
| `--ink-2` | `#2d2c2a` | Hover do preto |
| `--paper` | `#f3f1ec` | Chão da aplicação |
| `--sheet` | `#fbfaf7` | Folhas: cartões, listas, tabelas, campos |
| `--gray-50` / `--gray-100` | `#f0eee9` / `#e8e5df` | Cabeçalho de tabela, trilhos, fundos discretos |
| `--rule` | `#dcd8d0` | Filetes de 1px |
| `--gray-300` / `--gray-500` | `#c4bfb6` / `#8a857c` | Bordas de controle; colchetes e traços |
| `--muted` | `#5f5b55` | Texto secundário (6:1 sobre o papel) |
| `--on-ink` / `--on-ink-muted` | `#f3f1ec` / `#a6a198` | Texto sobre o preto |
| `--ok` · `--warn` · `--danger` (+ `-bg`, `-line`) | `#2f6a45` · `#7a5712` · `#9b3027` | Estados: concluída, alerta, erro |

Gráficos: série 1 tinta `#121212`, série 2 cinza `#8a857c`, série 3 cinza claro `#c4bfb6`, "Outros" `#dcd8d0`.

A prévia do documento (`.paper`) não segue esta paleta: ela reproduz o Word como vai sair.

## Tipografia

- **Schibsted Grotesk** (`--sans`) para tudo: títulos 30px/700 (40px na entrada), corpo 15px, rótulos de tabela 11.5px
  maiúsculos com 0.06em.
- **Geist Mono** (`--mono`) só para medida: números dos painéis, contadores, a linha "TRADUÇÃO PÚBLICA" da marca,
  código e dicas de gráfico.
- Números tabulares só onde há números; a fonte alarga a pontuação em modo tabular.

## Forma

- Cantos de 4px (`--radius`), 2px em contadores, segmentos e etiquetas; filetes de 1px; sem sombras decorativas.
- Menu lateral preto; item ativo invertido (off-white com texto preto).
- **Ações entre colchetes:** a ação comum não tem caixa; o texto fica entre colchetes desenhados (1.5px, cinza) que se
  fecham sobre a palavra e escurecem no hover. A ação principal é uma barra de tinta reta com seta que avança e o traço
  de inutilização correndo por baixo no hover. Ações discretas e links são só texto.
- Abas sublinhadas em preto; filtros segmentados com o ativo em preto.
- Avisos planos com filete na cor do estado; nada de faixa colorida grossa à esquerda.
- Foco: contorno de 2px em preto. Seleção de texto em preto com texto off-white.
- Movimento: estados em 160–220ms com `cubic-bezier(0.16, 1, 0.3, 1)`; troca de área e de aba entra em 280ms; avisos ao
  vivo entram em 320ms e o traço de inutilização embaixo encolhe até o aviso sumir. Com `prefers-reduced-motion`, sem
  deslocamentos; cor e transparência continuam.
- Responsivo: menu lateral acima de 800px (220px entre 801 e 1100px); no celular, barra superior com a marca e barra de
  navegação embaixo, rótulos curtos e alvos de 44px em telas de toque; nada mais largo que a tela.
- Notificações: aviso no canto da tela e pop-up do Windows (Notification API, com permissão do navegador).
