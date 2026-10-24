# Interface web — contrato visual

Produto: Tradutor Documental, descrito em [PRODUCT.md](../../PRODUCT.md). Escopo desta reconstrução: apresentação da aplicação inteira, preservando comportamento, permissões, integrações e documentos gerados.

## Direção confirmada

Aplicação corporativa elegante e discreta, com grafite, verde sóbrio e branco. Temas claro e escuro recebem o mesmo cuidado de hierarquia, contraste e densidade. Títulos em Source Serif 4 Variable; corpo e controles em Inter Variable, com corpo base de 13px. Texto predomina e os ícones são poucos e funcionais.

A interface é compacta: bordas finas, espaçamento coerente, cantos de 6px nos controles, 8px nos painéis e 10px nos diálogos, com pouca sombra. A identidade anterior baseada em papel de fundo, preto, colchetes e traços ornamentais foi substituída por esta direção.

## Primeiro contato e trabalho diário

O menu reúne áreas por grupos reconhecíveis. Título, contexto e ação principal ficam claros. Os dashboards dão espaço aos gráficos e destacam os índices e seus períodos. Filtros e ações secundárias se mantêm compactos e legíveis.

Documentos aparecem em **blocos individuais**: identidade e protocolo em destaque, metadados alinhados e ações claramente associadas. A escolha confirmada é a opção C, com cartões individuais. A revisão de traduções dá predominância à comparação entre original e Word, mantendo inspeção obrigatória, erros, numeração e bloqueios nas condições existentes.

Formulários, tabelas, cartões, detalhes e diálogos recebem uma composição consistente. Carregamento, erro, vazio, desabilitação, seleção, reprovação e conclusão fazem parte da direção visual e devem ser considerados em cada área.

## Documento e funcionalidade

Word e PDF exibem a folha branca real, inclusive no modo escuro. Fontes impressas, alinhamento, tabelas, células mescladas e proporções não recebem o estilo tipográfico da aplicação. Canvas e zoom, progresso, posições de dicas e dimensões calculadas por dados conservam sua geometria dinâmica.

Nenhum novo endpoint, fluxo, regra ou validação faz parte desta reconstrução. Requisições, callbacks, permissões, confirmações e acessibilidade existentes devem ser preservados.

## Sistema de implementação

Tailwind CSS 4.3.3 via Vite. Uma entrada central `apps/web/src/style.css` importa Tailwind, tokens, base, módulos de domínio e `LanguagePairPicker.css`. A divisão de estilos é `tokens`, `foundation`, `domain`, `components`, `account`, `documents`, `administration` e `analytics`.

Os valores de tema e aliases legados estão em `styles/tokens.css`; os componentes usam utilidades semânticas e composição de layout. [DESIGN.md](../../DESIGN.md) registra os critérios de manutenção.

## Evidência e conclusão

A auditoria de código está em [visual-audit.md](../../docs/design/visual-audit.md). O registro separa a leitura anterior às edições da conferência complementar e não afirma execução de todos os estados.

A validação de navegador e a aceitação ainda precisam ser documentadas com evidências em `docs/design/visual-validation.md`. Esta documentação não declara a reconstrução validada ou aceita.
