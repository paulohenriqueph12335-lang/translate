# ADR-008 — Tradução automática com provedores gratuitos e memória de tradução

- Estado: Accepted
- Data: 2026-10-17

## Contexto

O sistema precisa traduzir sozinho o que for necessário. O Claude (ADR-007) gera o rascunho mais completo (estrutura, notas do tradutor, tabelas), mas exige chave paga e liberação por equipe. A organização quer começar por opções gratuitas e acessíveis, sem abrir mão da revisão e da aprovação humanas.

## Decisão

### Provedores de tradução de texto

Uma interface `MachineTranslator` (`packages/core/src/translation/machine/`) traduz listas de trechos entre PT e EN. Implementações:

| Provedor | Onde roda | Custo | Ativação |
| --- | --- | --- | --- |
| **LibreTranslate** (`libretranslate/libretranslate:v1.9.6`, modelos Argos PT/EN) | serviço `translator` no Compose; o documento não sai da infraestrutura | gratuito, sem cota | `LIBRETRANSLATE_URL` no worker (padrão no Compose) |
| **DeepL API Free** | servidores da DeepL | gratuito até 500 mil caracteres/mês | `DEEPL_API_KEY` no worker **e** escolha explícita do Diretor (envio externo) |

O Diretor escolhe o provedor gratuito da organização em Configurações (`translation_settings.machine_provider`: `libretranslate`, `deepl` ou `none`). O padrão é `libretranslate`.

### Ordem de tentativa no worker

1. ~~**Claude**~~: removido pelo [ADR-010](010-review-flow-without-ai.md).
2. **Tradução automática gratuita**, se o provedor escolhido está disponível: o rascunho segue a estrutura lida do original (ADR-009: tabelas, mesclagens, títulos, assinaturas e notas) e cada trecho é traduzido.
3. **Manual**: o texto original com o glossário aplicado, com aviso do motivo.

### Proteções da tradução por trechos

- Antes de traduzir, datas numéricas e decimais são convertidos para o formato do idioma de destino, e os termos do glossário são aplicados; identificadores (RG, matrícula, CEP, telefone) não são tocados.
- Trechos sem letras (só números, códigos ou pontuação) não vão ao provedor.
- Cada bloco traduzido é marcado com a origem `machine`. Brasões, carimbos, marcas d'água e rodapés viram notas do tradutor a partir do layout (ADR-009); o revisor confere e completa a descrição.

### Memória de tradução (aprendizado)

- Na aprovação, cada par (trecho do original, tradução aprovada) dos blocos e células com origem conhecida entra em `translation_memory`, por par de idiomas.
- Antes de chamar qualquer provedor, o worker procura o trecho exato na memória; o que é encontrado não gasta cota e sai igual ao já aprovado. Trechos vindos da memória têm origem `memory`.
- A memória só aprende com traduções aprovadas por Líder ou Diretor e sem justificativa de exceção.

## Consequências

- A tradução automática passa a funcionar sem custo e sem chave, com qualidade de tradução de máquina; a revisão humana continua obrigatória e a aprovação, inalterada.
- O serviço LibreTranslate ocupa cerca de 1 GB de memória e baixa os modelos PT/EN na primeira execução (volume `translator_models`).
- O DeepL envia o texto para fora da infraestrutura; por isso depende da escolha explícita do Diretor e fica registrado na auditoria, como o Claude.

## Alternativas consideradas

MyMemory (cota anônima muito baixa e qualidade inferior); Google/Azure (exigem cartão e conta de nuvem, com cota gratuita limitada); LLM local via Ollama (sem custo, mas exige hardware e não tem a garantia de saída estruturada usada com o Claude — pode entrar depois como provedor adicional).
