# ADR-028 — Revisão persistida dos ensaios de novos formatos

- Estado: Accepted
- Data: 2026-10-24
- Relacionadas: [ADR-017](017-automatic-flow-patterns.md), [ADR-025](025-operational-document-flow.md)

## Contexto

Comparar original e Word no teste de um novo tipo de documento não era suficiente: a aprovação/reprovação ficava somente na tela. Era necessário persistir a decisão, as fases com falha e o controle de três reprovações também no ensaio, preservando a característica de não armazenar seu arquivo ou conteúdo.

## Decisão

A migração `0028_pattern_trial_reviews` cria `pattern_trials`, `pattern_trial_reviews` e `pattern_trial_formats`. O ensaio é identificado pelo SHA-256 do arquivo, par de idiomas, modalidade, proprietário e contexto de equipe. O contexto é a primeira associação de equipe por ordem de identificador; para o Diretor, fica sem equipe. Reenviar o mesmo arquivo no mesmo contexto recupera o ensaio existente.

O banco guarda identificadores, digests, propriedades estruturais de layout sem textos e o histórico de decisões/formatos. Não guarda o binário, nome do arquivo, texto extraído, tradução nem rascunho integral. Comentários e justificativas são os textos fornecidos deliberadamente na revisão. O arquivo original continua disponível na sessão do navegador para a comparação; o servidor usa armazenamento temporário somente durante a análise e o remove.

Original e Word são apresentados lado a lado. Para PDFs, a UI usa PDF.js local com worker empacotado, navegação por página, zoom/ajuste à largura e texto da página, sem depender do plugin PDF do navegador. O Word é convertido em PDF no servidor antes de ser exibido. Imagens continuam sendo mostradas como imagens; formato indisponível ou erro de renderização recebe uma indicação explícita.

O ensaio oferece quatro opções reais de diagramação: estrutura do original, esquerda, justificado e centralizado. O preset escolhido altera o alinhamento dos parágrafos, títulos e células antes de gerar o Word. A identidade da revisão usa um digest do resultado e das propriedades que afetam a renderização. Reexecutar sem produzir alteração preserva a revisão e a decisão existentes; não zera as reprovações e não cria tentativas artificiais.

Cada revisão pode receber uma decisão, associada ao número exato da revisão. Aprovação não aceita fases falhas. Reprovação exige comentário e ao menos uma fase entre correção, tradução, diagramação e revisão. Decisão duplicada ou revisão desatualizada retorna conflito. A decisão do ensaio não aprova traduções de produção.

Três revisões distintas reprovadas consecutivamente bloqueiam uma quarta geração antes de chamar o provedor. Para continuar, o usuário informa nome, motivo e outra opção de diagramação. O servidor aplica essa opção às propriedades estruturais conhecidas e exige que o resultado seja diferente do layout anterior; apenas renomear ou escolher uma opção equivalente não libera nova tentativa. O registro aumenta a geração de formato, reinicia a sequência e marca `requiresRegeneration`. A inspeção continua bloqueada até gerar o Word com o preset registrado e comparar a nova revisão.

A geração também compara o layout **efetivamente produzido** com o anterior. Se mudanças do analisador/conhecimento fizerem o resultado continuar igual, a operação não cria outra revisão e mantém `requiresRegeneration`. O usuário pode substituir a opção pendente por outra diagramação e gerar novamente; o formulário permanece disponível para evitar um fluxo sem saída.

O proprietário, o Diretor e o Líder da equipe do ensaio podem consultar/decidir; outras pessoas recebem recurso não encontrado. A UI recarrega o histórico pelo servidor. Após recarregar o navegador e reenviar um arquivo bloqueado, a resposta de conflito devolve o estado do ensaio, permitindo registrar a nova formatação sem reexecutar o processamento bloqueado.

Eventos `pattern.trial_generated`, `pattern.trial_approved`, `pattern.trial_rejected`, `pattern.review_blocked` e `pattern.format_registered` mantêm revisão, geração, fases, justificativa e responsável na auditoria. O bloqueio tem gravidade crítica. Nenhum desses eventos inclui conteúdo do documento.

## Contratos

- `POST /api/v1/document-patterns/test`: recebe o arquivo temporário e o par/modalidade, com `layoutPreset` opcional; devolve a prévia e o estado `trial`.
- `GET /api/v1/document-patterns/trials/:id`: devolve estado e histórico de decisões.
- `POST /api/v1/document-patterns/trials/:id/inspect`: recebe `baseRevision`, decisão, fases e comentário.
- `POST /api/v1/document-patterns/trials/:id/formats`: recebe revisão, nome, explicação e preset; a geração posterior usa o preset persistido.

## Consequências e verificação

O controle de tentativas sobrevive à sessão e distingue aprovação humana do resultado técnico do analisador. O ensaio continua sem criar documento ou tradução de produção. As opções de ajuste disponíveis são presets estruturais de alinhamento; a edição detalhada da documentação continua na área de traduções.

`apps/api/src/pattern-trials.integration.test.ts` verifica recuperação por digest, resultado inalterado sem nova revisão, acesso, fases/motivo, conflito, três reprovações, bloqueio antes do provedor, diferença estrutural obrigatória e Word regenerado com alinhamento conferido no XML. Também consulta as três tabelas e confirma que nome, texto original e tradução sintéticos não foram persistidos. Os sete casos incluem a base de layout alterada entre registro e geração, com recusa do resultado igual e substituição do preset pendente. Esses casos passaram na execução final dos 265 testes da API em 2026-10-24.
