# Roadmap e critérios de conclusão

O roadmap normaliza as fases do plano mestre. Uma fase só avança quando seus critérios verificáveis passam; compilar sozinho não conclui uma fase.

## Fase 0 — Fundação local (em andamento)

Monorepositório, Docker, configuração, PostgreSQL, armazenamento local, API/worker/web mínimos e migrações.

**Aceite:** ambiente sobe via README; dados persistem após recriação dos containers sem remover volumes; migração idempotente e saúde API/banco funcionam; credenciais não são commitadas.

**Estado observado:** o usuário iniciou Compose com sucesso; Postgres e API reportaram saudáveis; worker/web iniciaram e o serviço pontual de migração encerrou. `corepack pnpm install` completou; o script `pnpm dev` foi corrigido após falhar ao chamar `pnpm` diretamente. A execução corrigida de `dev` ainda precisa ser confirmada. Integração S3, bucket, testes e CI ainda não estão comprovados.

## Fase 1 — Identidade, hierarquia e auditoria (implementada; aguardando aceite)

Cadastro pendente, login/sessões, primeiro Diretor provisionado com segurança, funções Diretor/Líder/Operador, equipes, autorização por objeto e trilha de auditoria.

**Aceite:** conta pública não acessa dados antes de aprovação; Diretor administra organização; Líder não ultrapassa escopo delegado; testes negativos de isolamento passam; sessões podem ser revogadas.

**Estado observado (2026-10-16):** decisões em ADR-003 (sessões/senhas), ADR-004 (bootstrap do Diretor) e ADR-005 (hierarquia). Migração `0002_identity` aplicada no ambiente Docker local; `apps/api/src/phase1.integration.test.ts` cobre cada critério acima contra PostgreSQL real (41 testes no total, incluindo políticas puras). Interface web verificada manualmente com Diretor e Líder. Fora do escopo desta fase: troca/recuperação de senha, MFA, limitador de taxa compartilhado entre instâncias e várias organizações.

## Fase 2 — Upload e armazenamento

Validação segura de arquivos, lote até 100 itens, metadados, limites, objetos privados, estados e histórico.

**Aceite:** lote preserva estado individual; tamanhos e formatos são limitados; acesso indevido é negado; upload incompleto/falha não deixa item falsamente concluído.

## Fase 3 — Primeiro fluxo documental (DOCX)

Extração, segmentos, tradução via interface de provedor, reconstrução, download e comparação estrutural.

**Aceite:** documento de referência percorre o fluxo completo; estilos/tabelas suportados são verificados; texto/números protegidos e conteúdo sem tradução são tratados explicitamente.

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
