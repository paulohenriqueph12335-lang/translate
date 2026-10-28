# Estratégia de testes

Testes devem ser acrescentados junto com a funcionalidade e usar documentos sintéticos ou fixtures autorizadas, sem dados pessoais reais.

## Camadas planejadas

| Tipo        | Verifica                                                      |
| ----------- | ------------------------------------------------------------- |
| Unitário    | Regras, validação, transições de estado e políticas de acesso |
| Integração  | API/worker com PostgreSQL e armazenamento S3                  |
| Contrato    | Esquemas e adaptadores de provedor/formatos                   |
| Segurança   | Isolamento de usuários/equipes, upload, sessão e downloads    |
| Documental  | Texto, estilos, tabelas, imagens, slides e conteúdo protegido |
| Recuperação | Retomada, idempotência, falhas e limites de retentativa       |
| E2E         | Fluxo de cadastro/aprovação até download                      |
| Carga       | Concorrência, CPU, memória, tamanho de lote e documentos      |

## Fluxo operacional e pares reais (ADR-025)

Os testes novos usam dados sintéticos e bancos descartáveis separados:

- `apps/api/src/audit-search-upgrade.integration.test.ts`: autorização de Diretor/Líder/Operador, 65 erros contados além da página, isolamento de equipes, protocolo com múltiplos tokens sem acento, causas, fases, idiomas, pendências e espera entre conclusão e primeiro download.
- `apps/api/src/batch-protocols.integration.test.ts`: protocolo/justificativa, escolha de inspeção para remessas grandes, colisões de nomes, ZIP Word/PDF, acesso, falhas de leitura/conversão e registro atômico dos downloads com reautorização.
- `apps/api/src/pattern-trials.integration.test.ts`: histórico persistido do ensaio, identidade por digest, decisão única por revisão, fases e motivo, três reprovações, quarto processamento bloqueado, novo formato com diferença estrutural e Word regenerado; ausência de conteúdo/binário/nome do arquivo no banco. Inclui revalidação do layout final e substituição de um preset pendente quando o resultado continua igual.
- `apps/api/src/lifecycle-upgrade.integration.test.ts`: inspeção vinculada à revisão, fases reprovadas, terceira reprovação, novo formato estrutural, confirmação de documento pronto, alterações de idioma e aceitação das 20 direções no banco.
- `packages/core/src/translation/machine/multilingual-live.test.ts`: teste opt-in sem banco, que usa o LibreTranslate local real. Sem a opção explícita, fica pulado e não acrescenta dependência de rede à suíte normal.

Para executar apenas auditoria/pesquisa, a partir de `apps/api`, com PostgreSQL e S3 locais ativos:

```powershell
node --env-file-if-exists=../../.env --import tsx --test src/audit-search-upgrade.integration.test.ts src/modules/search/search-tokens.test.ts
```

Para comprovar os pares **FR→ES e ES→IT** com DOCX sintético, da raiz do repositório:

```powershell
$env:RUN_LIVE_TRANSLATION_TESTS = 'true'
$env:LIVE_LIBRETRANSLATE_URL = 'http://localhost:15050'
$env:LIVE_TRANSLATION_EVIDENCE_DIR = (Join-Path (Get-Location) 'tmp/multilingual-live')
Push-Location packages/core
node --import tsx --test src/translation/machine/multilingual-live.test.ts
Pop-Location
Remove-Item Env:RUN_LIVE_TRANSLATION_TESTS
Remove-Item Env:LIVE_LIBRETRANSLATE_URL
Remove-Item Env:LIVE_TRANSLATION_EVIDENCE_DIR
```

O teste consulta `/languages`, chama o adaptador real, cria um DOCX original, executa `extractFile → draftFromFile → renderPlainDocx` e extrai o texto do Word final para conferir conteúdo e par. Exige origem `machine`, tradução sem memória e nenhuma falha do provedor. Não usa IA nem documento real. Se a execução explícita não encontrar o serviço/par, falha; não transforma indisponibilidade em sucesso.

Em **2026-10-24**, os dois casos reais passaram. O Word FR→ES continha “Hola, este documento confirma la recepción del pago.” e o ES→IT continha “Ciao, questo documento conferma la ricezione del pagamento.”. As evidências JSON registram a resposta do provedor e o texto gerado. São dois pares verificados de um catálogo com 20 direções possíveis; não constituem validação de qualidade de todos os documentos ou de todos os pares.

Na mesma data, um ensaio local de migração partiu do schema até `0024`, com três trabalhos concluídos e seis eventos históricos de download, e aplicou `0025` a `0028`. Conferiu exclusão de eventos anteriores à aprovação e de `inline=true`, primeiro/último download, contagem e preservação da atividade histórica. A segunda execução não aplicou novas migrações. Eventos legados de PDF sem indicação `inline` permanecem indistinguíveis de entregas para baixar e podem compor o marco histórico.

### Registro de QA automatizado — 28/10/2026

Depois dos tokens fixos, da recuperação de senha, da conclusão pelo responsável, dos nomes no ZIP e da atualização de Fastify, Zod, Vite e do SDK da AWS (ADR-031):

- API: 324 aprovados. Inclui `password-recovery.integration.test.ts` com 7 casos e `archive-names.test.ts`.
- Core: 73 aprovados e 1 pulado (o provedor real, que é opt-in).
- Web: 25 aprovados.
- `pnpm audit --prod` não encontrou vulnerabilidades.

### Registro final de QA automatizado — 24/10/2026

| Execução                    | Aprovados | Alcance                                                                        |
| --------------------------- | --------: | ------------------------------------------------------------------------------ |
| API completa                |       311 | Serviços/HTTP, autorização, banco e armazenamento; execução com concorrência 2 |
| Core                        |        74 | Regras, extração, tradução, revisão e geração documental                       |
| Web                         |        25 | Notificações, idiomas, upload e salvamento de arquivos                         |
| Provedor local real, opt-in |         2 | FR→ES e ES→IT com DOCX sintético e Word gerado, sem IA                         |

Os casos dedicados estão incluídos nos 311 testes da API; não devem ser somados novamente. A execução completa encerrou com zero falhas e zero testes pulados. Inclui notificações agrupadas/canais, indicadores individuais e de qualidade, classificação, disputa entre workers, retomada concorrente de upload e manifesto de entrega. Os dois casos do provedor real são uma execução explícita anterior separada.

As regras de remessas grandes permanecem: decisão explícita a partir de **20 arquivos**, amostra dos **primeiros até 10 documentos elegíveis** e conferência vinculada à revisão vigente. Os limites de ZIP permanecem **100 traduções**, **50 MiB por arquivo** e **128 MiB no conteúdo total**. A auditoria da entrega só é gravada após todos os arquivos estarem preparados, a reautorização concluir e os recibos de revisão/chave/SHA corresponderem aos artefatos vigentes, com os eventos individuais/agrupados na mesma transação. Alteração durante a preparação retorna `409 artifact_changed`; falha antes do commit desfaz o registro completo. O recebimento pelo navegador e o salvamento em disco não são confirmados por esses marcos.

A comparação usa o visualizador PDF.js local, sem plugin PDF, com página anterior/próxima, ajuste/zoom e texto da página. A validação visual local usou contas e documentos sintéticos em banco separado: pesquisa por protocolo no Início, ampliação de painéis, relatório de tempos do Líder, fases, renderização real do original e Word, zoom, aprovação, registro de novo formato após três reprovações e filtro de emergências. O navegador baixou Word com ordinal `(01)` e ZIPs Word/PDF; a inspeção dos pacotes confirmou as duas saídas distintas nas pastas `ABC-10003/FR-ES/Word` e `PDF`.

Na continuação, o diálogo de confirmação da aplicação foi validado com Cancelar, Escape e foco inicial em Cancelar. Recarregar preservou o estado sem reprovação; confirmar registrou uma devolução e retornou à revisão. Também foram verificados pesquisa por justificativa sem protocolo, aprovação de ensaio após regeneração, classificação auditada, busca de idiomas por “FRA ESP”, Word e ZIP na própria fase de entrega e layout a 320 px. A opção de download padrão baixou Word e ZIP reais do laboratório. O seletor nativo de pasta e a escrita têm testes com adaptadores; não houve validação manual do diálogo do Explorer nem da exibição nativa do Windows neste navegador de testes. Não se afirma cobertura E2E completa ou validação de todas as resoluções.

O teste de escala usa 30 documentos e seis workers com provedor determinístico. Comprova isolamento das tentativas e ausência de publicação duplicada; não mede a capacidade real de OCR, LibreTranslate, armazenamento e conversor. Os limites continuam sujeitos à memória disponível, pois originais e pacotes são materializados no servidor. As migrações `0029`–`0032` cobrem preferências/canais, categorias, inspeção de novas revisões legadas e UUID por tentativa de upload.

## Critérios por alteração

- Build TypeScript, tipos e lint aprovados.
- Testes do comportamento alterado e integração correspondente aprovados.
- Migrações validadas em banco limpo e persistente.
- Alterações de acesso incluem casos permitidos e negados.
- Alterações de extrator/reconstrutor incluem regressão de fixtures.
- Sem segredo, arquivo real ou conteúdo sensível nos artefatos de teste/log.

## Estado atual

A API tem testes unitários das políticas, senhas e limitador, e testes de integração da Fase 1 (`apps/api/src/phase1.integration.test.ts`) contra PostgreSQL real, com casos permitidos e negados. Cada arquivo usa um banco descartável `tradutor_test_<nome>` no PostgreSQL local (`localhost:5433` ou `POSTGRES_PORT`, credenciais do `.env`) ou `TEST_DATABASE_URL`. Os testes da Fase 2 (`phase2.integration.test.ts`) usam o S3 local em `localhost:8333` com um bucket descartável `tradutor-test-<nome>` (credenciais `S3_ACCESS_KEY`/`S3_SECRET_KEY` ou os padrões do Compose) e injetam falhas de armazenamento pela interface `ObjectStorage`. Os arquivos de teste são amostras sintéticas geradas em código (`samples` em `src/test/helpers.ts`). Com o Compose em execução, rode `corepack pnpm test`. A Fase 3 tem testes de fidelidade em `packages/core` (o DOCX gerado é comparado parágrafo por parágrafo com `fixtures/historico-escolar/esperado.docx`, e as checagens usam o PDF fictício `original.pdf`) e o teste de integração `apps/api/src/phase3.integration.test.ts`. O fluxo do ADR-010 (etiquetas, aviso de tipo novo, notificações, pronta/concluir/refazer com reprocessamento, filtros, busca de documentos com as traduções geradas e filtros da auditoria) está em `apps/api/src/review-flow.integration.test.ts`. O plano de hierarquia (ADR-011: responsável, assumir e reatribuir, cotas, pedidos de número, painéis e auditoria da equipe) está em `apps/api/src/hierarchy.integration.test.ts`, e as políticas em `modules/access/policy.test.ts`. A máscara do tradutor (ADR-012) é testada em `packages/core/src/translation/mask/fill-mask.test.ts` (marcadores partidos pelo Word, fonte do parágrafo `{{texto}}`, tabelas com mesclagens, prévia e recusa sem `{{texto}}`) e o cadastro e a conclusão com tradutor em `apps/api/src/translators.integration.test.ts`. A tradução gratuita é testada com provedor simulado e, se o serviço local responder em `127.0.0.1:15050` (ou `LIBRETRANSLATE_TEST_URL`), também com o LibreTranslate real traduzindo o histórico fictício inteiro sem perder números; sem o serviço, esse teste é pulado. A leitura do layout (ADR-009) é testada em `packages/core/src/translation/layout/layout.test.ts` com os dois PDFs fictícios (tabelas, mesclagens, seções, alinhamento, assinaturas e notas) e com o DOCX do modelo. Planilhas técnicas (ADR-013) usam `fixtures/planilha-tecnica/planilha-ficticia.pdf`, gerado por `gerar.py` com dados inventados: tabela do tamanho da página, verticais só no cabeçalho, continuação sem bordas e códigos que não podem ir ao provedor. Os modelos em `fixtures/` são documentos fictícios de simulação. A CI sobe PostgreSQL e SeaweedFS e executa build, tipos, lint e testes. O ambiente local que o usuário iniciou comprovou saúde de API/PostgreSQL e execução do migrador, mas não substitui a suíte de testes de aceite.

As regras de numeração por tradutor (ADR-014) têm testes unitários em `apps/api/src/modules/numbering/rules.test.ts` (Walter, Patricia, Carla, estoque, Antonio, Vivian e leitura de CSV) e de integração em `apps/api/src/numbering-rules.integration.test.ts` (planilhas, livro que trava e troca sozinho, 2 usos em protocolos diferentes, protocolo zerado, teto da assinatura, reserva, bloqueio, avisos e painel).

As modalidades (ADR-015) têm testes unitários em `packages/core/src/translation/profiles.test.ts` (datas por idioma, números como no original, nome do arquivo, etapas e ajuste inválido) e de integração em `apps/api/src/modes.integration.test.ts` (regras por idioma, ajuste e volta ao padrão pelo Supervisor, checklist antes de "Pronta", conclusão certificada sem numeração com sufixo `-FRA` e glossário das skills sem duplicar).

A revisão automática (ADR-016) tem testes unitários em `packages/core/src/translation/review.test.ts` (detecção dos cinco idiomas, retradução do trecho no idioma errado, números e datas devolvidos ao formato, glossário, marcadores, terceiro idioma transcrito) e `machine/proper-names.test.ts` (pessoas, cidades, endereços, "S.A.", maiúsculas e ordinais), e de integração em `apps/api/src/auto-review.integration.test.ts` (no processamento, pelo botão e antes de "Pronta").

O fluxo automático e os padrões de documento (ADR-017) têm teste de integração em `apps/api/src/automatic-flow.integration.test.ts`: envio com máscara e tradutor, checklist automático, prévia com o número previsto em Word e PDF (conversor falso), aprovação do Usuário seguida da conclusão pela liderança, numeração automática com as páginas do original, juramentada sem máscara, histórico de padrões e teste sem gravar (imagem e arquivo desconhecido como "ainda não consegue").

O OCR (ADR-018) tem testes unitários em `packages/core/src/translation/ocr.test.ts` (linhas e colunas a partir do TSV do Tesseract e funcionamento sem Tesseract instalado); o teste de integração do fluxo automático confere que um arquivo sem texto lido não tem o checklist confirmado pela revisão automática. O OCR de verdade é conferido no Docker, onde o Tesseract está instalado.

Os modelos de diagramação (ADR-019) têm testes unitários em `packages/core/src/translation/models.test.ts` (tipo do documento, reparo de tabela sem perder texto, rótulo e valor, tipo preenchido, as quatro molduras como máscaras válidas no idioma da tradução, bilíngue) e de integração em `apps/api/src/frame-models.integration.test.ts` (lista e prévia dos modelos, máscara gerada do modelo e tradução em francês concluída com a moldura em francês). A fonte e o tamanho da regra são conferidos em `look.test.ts`.

A diagramação construída (ADR-020) tem testes unitários em `packages/core/src/translation/layout-composer.test.ts`: papéis de cada parte, documento desconhecido composto de dois conhecidos de tipos diferentes (campos em tabela na largura aprendida, centralização, título e tipo, sem mudar texto), OCR com linhas partidas e rótulo alongado pela tradução, formatação do original que prevalece e nada muda sem conhecimento. Exemplos reais de tipos novos (PDF e imagem) em `docs/exemplos-simulados/novos-tipos`.

O Gerenciamento AI (ADR-021) tem testes unitários em `packages/core/src/ai/governance.test.ts` (ordem do prompt, sem chave, resposta com campo a mais ou fora do escopo barrada, glossário sem texto completo, diagramação sem mudar texto) e de integração com um Gemini falso em `apps/api/src/ai.integration.test.ts`: só Líder e Diretor configuram, só o Diretor liga, o Líder limita só a própria equipe, pessoa limitada é negada, IA fora do ar não trava, combinação só vale aprovada na prévia, sem mudar o texto, e entra no conhecimento; sem chave, a IA fica indisponível e o resto segue.

A configuração inicial e a conta de teste (ADR-004, revisão de 2026-10-22) estão em `apps/api/src/setup.integration.test.ts`: código anunciado sem Diretor, código errado e senha curta recusados, Diretor de teste criado e já conectado, configuração fechada com Diretor existente, quem pode excluir, e exclusão que derruba a sessão, libera o e-mail, guarda a auditoria e reabre a configuração com código novo. As contas de demonstração (Líder e Usuário de teste na Equipe de Teste, exclusão de todas de uma vez e recriação com os mesmos e-mails) estão em `setup-demo.integration.test.ts`.

### Simulação e carga no sistema local

As configurações pessoais ([ADR-024](decisions/024-personal-settings.md)) são cobertas por `apps/api/src/account-settings.integration.test.ts`: padrões, persistência e isolamento das preferências, PATCH concorrente, validação, autenticação/CSRF, senha atual incorreta, política da senha nova, limite de tentativas, auditoria sem segredos, preservação da sessão atual e revogação das outras, inclusive com login concorrente. `apps/web/src/notification-policy.test.ts` cobre baseline silenciosa, deduplicação, intervalos de 5/15/60 minutos, leitura antes do aviso e cache por usuário ou indisponível. Rode `corepack pnpm --filter @tradutor/web test` para esses testes da interface. Temas claro/noturno, persistência após recarga, sincronização entre abas, desativação e formulário de senha foram conferidos no navegador com uma conta fictícia em banco separado, em desktop e largura de 320 px.

Com o Compose no ar e as contas de teste em `docs/exemplos-simulados/.credenciais-simulacao.json` (fora do Git):

```bash
cd packages/core && node --import tsx scripts/simular-documentos.ts
```

envia os 18 documentos fictícios de `docs/exemplos-simulados/originais`, conclui e salva o Word de cada um em `traduzidos/`, com `relatorio.json`. E

```bash
cd packages/core && node --import tsx scripts/teste-carga.ts 20
```

mede a API (1 a 32 clientes, parando no p95 de 1,5 s, em 2% de erros ou em 85% de CPU de um contêiner) e a fila (20 documentos), gravando `teste-carga.json`.
