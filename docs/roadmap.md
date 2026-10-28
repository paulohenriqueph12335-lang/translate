# Roadmap e critérios de conclusão

O roadmap normaliza as fases do plano mestre. Uma fase só avança quando seus critérios verificáveis passam; compilar sozinho não conclui uma fase.

## Estado em 28/10/2026

As fases 0 a 3 estão implementadas. A 4 (fila e recuperação), a 5 (OCR) e boa parte da 7 (idiomas, modalidades e glossário) também, com testes. Desde então entraram o redesign da interface, o tutorial, os tokens fixos e a recuperação de senha, a conclusão pelo responsável e os nomes no ZIP (ADR-031). Fastify, Zod, Vite e o SDK da AWS foram atualizados, e `pnpm audit --prod` não aponta vulnerabilidades.

Os registros abaixo de cada fase mostram como o sistema estava quando a fase foi entregue. Para o estado atual, veja [project-overview.md](project-overview.md), [architecture.md](architecture.md) e [data-model.md](data-model.md).

Próximos passos:

- recuperação de senha por e-mail e MFA;
- limitador de tentativas compartilhado entre instâncias da API;
- criptografia em repouso;
- imagens Docker de produção, sem `tsx watch` nem o servidor do Vite e sem rodar como root;
- healthchecks de todos os serviços;
- backup e restauração testados;
- limpeza de objetos órfãos no S3;
- divisão de `apps/api/src/http/routes.ts` por módulo.

## Fase 0 — Fundação local (em andamento)

Monorepositório, Docker, configuração, PostgreSQL, armazenamento local, API/worker/web mínimos e migrações.

**Aceite:** ambiente sobe via README; dados persistem após recriação dos containers sem remover volumes; migração idempotente e saúde API/banco funcionam; credenciais não são commitadas.

**Estado observado:** o usuário iniciou Compose com sucesso; Postgres e API reportaram saudáveis; worker/web iniciaram e o serviço pontual de migração encerrou. `corepack pnpm install` completou; o script `pnpm dev` foi corrigido após falhar ao chamar `pnpm` diretamente. A execução corrigida de `dev` ainda precisa ser confirmada. Integração S3, bucket, testes e CI ainda não estão comprovados.

## Fase 1 — Identidade, hierarquia e auditoria (implementada; aguardando aceite)

Cadastro pendente, login/sessões, primeiro Diretor provisionado com segurança, funções Diretor/Líder/Operador, equipes, autorização por objeto e trilha de auditoria.

**Aceite:** conta pública não acessa dados antes de aprovação; Diretor administra organização; Líder não ultrapassa escopo delegado; testes negativos de isolamento passam; sessões podem ser revogadas.

**Estado observado (2026-10-16):** decisões em ADR-003 (sessões/senhas), ADR-004 (bootstrap do Diretor) e ADR-005 (hierarquia). Migração `0002_identity` aplicada no ambiente Docker local; `apps/api/src/phase1.integration.test.ts` cobre cada critério acima contra PostgreSQL real (54 testes no total, incluindo políticas puras, candidatos de equipe e bloqueio de autoatribuição de cargos). Interface web verificada manualmente com Diretor e Líder. Fora do escopo desta fase: troca/recuperação de senha, MFA, limitador de taxa compartilhado entre instâncias e várias organizações.

## Fase 2 — Upload e armazenamento (implementada; aguardando aceite)

Validação segura de arquivos, lote até 100 itens, metadados, limites, objetos privados, estados e histórico.

**Aceite:** lote preserva estado individual; tamanhos e formatos são limitados; acesso indevido é negado; upload incompleto/falha não deixa item falsamente concluído.

**Estado observado (2026-10-17):** decisões no ADR-006. Migração `0005_batches_documents` aplicada no Docker local; o bucket privado é criado pela API e recusa acesso anônimo (403). `apps/api/src/phase2.integration.test.ts` cobre cada critério contra PostgreSQL e SeaweedFS reais, incluindo falhas de armazenamento injetadas (96 testes na API no total). Fluxo por papel revisado: Diretor envia lotes sem equipe e os direciona, Líder envia direto para a própria equipe e Operadores trabalham com todos os documentos da equipe (migração `0006_batch_routing`). Envio, recusas, download e isolamento verificados no navegador com arquivos sintéticos. Pendências conhecidas: limpeza de objetos órfãos e retenção (Fase 8); detecção de PDF protegido e inspeção profunda (Fases 3, 5 e 6).

## Fase 3 — Tradução juramentada assistida (implementada; aguardando aceite)

PDF digital, DOCX ou PPTX → rascunho na estrutura do original, traduzido automaticamente → revisão na prévia → conclusão pelo Líder ou Diretor → DOCX juramentado numerado ([ADR-007](decisions/007-assisted-sworn-translation.md)). O objetivo anterior, de traduzir DOCX preservando o layout, foi substituído pelo produto real: a tradução juramentada no modelo de `packages/core/fixtures/historico-escolar/`.

**Aceite:** o documento de referência percorre o fluxo completo; o DOCX gerado reproduz o modelo; números e datas do original são conferidos; nada é concluído sem ação de Líder ou Diretor.

**Estado observado (2026-10-17):** o gerador reproduz o texto do modelo parágrafo por parágrafo e, convertido para PDF, a mesma diagramação em 2 páginas; a extração do PDF fictício confere todos os números do rascunho de referência. `apps/api/src/phase3.integration.test.ts` cobre fila, lease, rascunho manual, revisões imutáveis, devolução, aprovação com numeração, justificativa obrigatória, glossário e aprendizado, com o Claude simulado (112 testes na API e 13 no pacote compartilhado). Fluxo verificado no navegador: Operador pede a tradução, o worker gera o rascunho, o Operador revisa e envia, o Diretor configura o tradutor e aprova, e o DOCX final é baixado. Revisão do mesmo dia: tradução automática ao armazenar (par de idiomas no lote), DOCX/PPTX como entrada e diagnóstico de worker/Claude na interface (migração `0008_auto_translation`; 118 testes na API e 14 no pacote compartilhado). Tradução automática gratuita (ADR-008): LibreTranslate local por padrão, DeepL Free opcional e memória de tradução que aprende com aprovações (migração `0009`; 123 testes na API e 19 no pacote compartilhado, um deles com o LibreTranslate real). Estrutura do original preservada (ADR-009): leitura do layout de PDF e DOCX (tabelas com mesclagens, títulos, alinhamento, negrito, assinaturas e notas de brasão, carimbo, marca d'água e rodapé), também no rascunho sem provedor, e checagem `untranslated` que impede aprovar sem justificativa um rascunho não traduzido; o DOCX da tradução gratuita, convertido para PDF, tem a mesma diagramação do modelo (123 testes na API e 25 no pacote compartilhado). Fluxo simplificado (ADR-010, migração `0010`): o Claude saiu do produto; todo envio é processado na hora; revisão pela prévia com edição no lugar; Operador marca como pronta, Líder/Diretor conclui ou pede para refazer (com reprocessamento opcional); aviso de tipo de documento novo; notificações; etiquetas no envio; área de Downloads com originais ligados às traduções; filtros em traduções, documentos e auditoria; barra lateral fixa. Fluxo verificado no navegador com Operador, Líder e Diretor (133 testes na API e 25 no pacote compartilhado). Hierarquia (ADR-011, migração `0011`, 2026-10-18): responsável por tradução (só ele e o Supervisor editam; Diretor autoriza e reatribui), Usuário envia, cotas anuais de numeração com alertas e bloqueio, pedidos de alteração/anulação de número com nova versão do DOCX e reversão pelo Diretor, painéis do Diretor e do Supervisor com CSV e impressão, auditoria por equipe para o Supervisor, Meu workspace e Histórico; cadastro sem mudança. Verificado no navegador com Diretor, Supervisor e Usuário (151 testes na API). Planilhas técnicas (ADR-013, 2026-10-18): tabelas exportadas do Excel (do tamanho da página, verticais só no cabeçalho, continuação sem bordas) e códigos que ficam como no original; a lista de memórias de 5 páginas é lida com 327 de 327 linhas e só cabeçalhos e notas vão ao provedor. Tradutores juramentados (ADR-012, migração `0012`, 2026-10-18): cadastro único mantido pelos Supervisores, máscara em Word de cada tradutor preenchida só nos marcadores (texto traduzido no formato da máscara, tabelas com mesclagens), PDF de referência, número digitado na conclusão (único por tradutor); máscaras só por upload, guardadas em edições numeradas por tradutor, e a tradução registra a edição usada (migração `0013`; sem campo de regras: elas serão programadas por tradutor); a tela de Configurações de tradução saiu (158 testes na API e 31 no pacote compartilhado). Pendências: regras de numeração programadas por tradutor (especificação a receber); OCR local de PDF digitalizado e imagens (Fase 5); notificações por e-mail.

## Fase 4 — Fila e recuperação

Persistência de trabalhos, checkpoints, idempotência, retentativas classificadas/limitadas, cancelamento e retomada.

**Aceite:** reiniciar worker não perde trabalho nem duplica saída; indisponibilidade do provedor não provoca repetição ilimitada.

## Fase 5 — PDF, imagem e OCR

PDF digital, renderização de PDF digitalizado, JPG/PNG com Tesseract, confiança OCR e avisos.

**Aceite:** caminhos digital e OCR são separados; baixa confiança ou layout não suportado exige revisão clara; arquivos temporários têm limpeza controlada.

## Fase 6 — PPTX

Texto de slides/caixas, referências de elemento, reconstrução, preservação de conteúdo não textual e sinalização de limites.

**Aceite:** slides e imagens compatíveis permanecem; caixas cortadas/objetos sem suporte geram avisos ou falha explícita.

## Fase 7 — Provedor, idiomas e glossário

Adaptador de tradução independente do fornecedor, idiomas suportados, glossários e política de envio externo.

Adiantado: francês, italiano e espanhol; modalidades juramentada, certificada, técnica e simples com regras por idioma de destino; glossário das skills ([ADR-015](decisions/015-translation-modes.md)). Pendente: checklists finais de correção, diagramação e revisão quando as skills correspondentes chegarem.

**Aceite:** limites de tamanho, cancelamento, erros tipados, respostas incompletas, segredos, custo e versão de configuração são tratados. Sem provedor local, o sistema não se declara offline.

## Fase 8 — Piloto e operação

Testes de segurança/carga, observabilidade, retenção, backup e restauração, documentação e revisão de implantação.

**Aceite:** restauração real de banco e objetos validada; falhas e tarefas travadas são observáveis; políticas operacionais e critérios do piloto aprovados.

## Checklist final do MVP

- [ ] Ambiente reproduzível e documentado.
- [ ] Cadastro pendente e aprovação segura.
- [ ] Diretor/Líder/Operador limitados ao escopo apropriado.
- [ ] Documentos isolados por proprietário, equipe e permissão.
- [ ] Lote até 100 com estado por item.
- [ ] DOCX completo e critérios estruturais aprovados.
- [ ] PDF digital, PDF OCR, JPG/PNG e PPTX cobertos por testes de referência.
- [ ] Falhas, retentativas e reinícios não perdem nem duplicam trabalho.
- [ ] Baixa confiança OCR e limitações estruturais geram avisos.
- [ ] Backup do PostgreSQL e dos objetos restaurado em teste.
- [ ] Testes automatizados, de segurança e integração documentados e aprovados.
