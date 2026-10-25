# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Equipes de tradução juramentada no Brasil, em computador de escritório durante o expediente:

- **Usuário** (operador): envia documentos, revisa a prévia em Word e marca como pronta; vê só o próprio trabalho e o histórico.
- **Supervisor** (Líder de equipe): acompanha a equipe, conclui ou pede para refazer, cuida da numeração, dos tradutores juramentados, do glossário, das regras e da IA.
- **Diretor**: tudo isso para a organização inteira, mais cadastros e usuários.

## Product Purpose

Traduzir documentos (certidões, históricos, CNH, contratos e outros) com tradução automática, revisão automática e diagramação juramentada, até o Word final numerado. Sucesso é a tradução sair certa de primeira, na estrutura do original e com o número da Tradução Pública correto.

## Positioning

Um sistema feito para a tradução juramentada brasileira: número da Tradução Pública, livro e folha por tradutor, máscara do tradutor, glossário das skills e revisão humana obrigatória antes de concluir.

## Operating Context

- Fluxo: envio → leitura e tradução automáticas → "Para revisar" → Pronta → Concluir (numera e gera o Word) ou Refazer.
- Convenções do documento juramentado que o sistema reproduz: "Tradução Pública nº … – Livro nº … – Folha …", notas do tradutor entre colchetes ("[Assinatura ilegível]", "[Nota do tradutor: …]"), linhas em branco fechadas com traços de inutilização.
- Idiomas: português, inglês, francês, italiano e espanhol.

## Capabilities and Constraints

- Monorepo: API (Fastify), worker e interface web (React + Vite) em `apps/web`.
- Mudanças de identidade visual ficam só no front; backend e banco não mudam.
- IA (Gemini) opcional e limitada; o sistema funciona sem ela.

## Brand Commitments

- Nome do produto: Tradutor Documental.
- Paleta aprovada pelo responsável (2026-10-25): grafite e cinza-azulado, ações em preto, nada verde; concluído é azul-aço.
- Personalidade editorial: uma família tipográfica (Schibsted Grotesk), sem cartões, linhas finas e listas fluidas com efeito fantasma.
- Assinatura visual: a linha do fluxo do documento (Envio → Tradução → Revisão → Prévia em Word → Conclusão → Word final).
- Marcação de tradução juramentada discreta (ameixa suave), sempre com texto.
- Linguagem de comunicação contemporânea, com todas as referências visuais vindas da tradução juramentada.

## Evidence on Hand

Documentos fictícios de simulação em `docs/exemplos-simulados` e `packages/core/fixtures`. Não há logotipo, fotografia ou depoimentos; não inventar.

## Product Principles

- O documento manda: a interface mostra o documento como ele vai sair.
- Nada é concluído sem uma pessoa da liderança.
- Cada papel vê só o que usa.
- O processo segue mesmo quando a IA ou a tradução automática param.
