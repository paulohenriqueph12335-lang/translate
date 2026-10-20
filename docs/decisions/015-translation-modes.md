# ADR-015 — Modalidades de tradução, regras por idioma de destino e glossário das skills

- Estado: Accepted
- Data: 2026-10-20
- Relacionadas: [ADR-007](007-assisted-sworn-translation.md) (tradução juramentada assistida), [ADR-009](009-source-layout.md) (layout do original), [ADR-010](010-review-flow-without-ai.md) (fluxo de revisão), [ADR-014](014-translator-numbering-rules.md) (numeração)

## Contexto

Até aqui todo documento seguia como tradução juramentada (máscara, tradutor juramentado, número, livro e folha), só entre português e inglês. A organização trabalha com quatro modalidades e quatro idiomas estrangeiros, e mantém skills de tradução (ENG, FRA, ITA, ESP) com regras de formatação, datas, números, elementos visuais, nome do arquivo e glossário. Pediu-se:

- **Juramentada**: correção + tradução + revisão.
- **Certificada** e **técnica**: tradução + diagramação + revisão.
- **Simples**: tradução + revisão.
- O glossário preenchido com os termos das skills, organizado pelo idioma de destino.

As skills de correção, diagramação e revisão ainda não foram enviadas; seus checklists vêm da descrição recebida e são editáveis.

## Decisão

### Modalidades e etapas (`batches.translation_mode`, `translation_jobs.translation_mode`)

| Modalidade | Etapas | Conclusão |
| --- | --- | --- |
| `sworn` (juramentada) | Correção → Tradução → Revisão | Máscara do tradutor juramentado, número/livro/folha (ADR-012, ADR-014) |
| `certified` (certificada) | Tradução → Diagramação → Revisão | DOCX próprio com a declaração do tradutor; sem numeração |
| `technical` (técnica) | Tradução → Diagramação → Revisão | DOCX próprio; sem numeração |
| `simple` (simples) | Tradução → Revisão | DOCX próprio; sem numeração |

A modalidade é escolhida no envio (lote) e passa para cada tradução. A tradução é sempre automática, no layout do original; as etapas manuais (correção, diagramação, revisão) são **checklists** gravados em `translation_jobs.stage_checks` (quem confirmou e quando). "Pronta" responde `409` com `reason: 'checklist_incomplete'` enquanto houver item sem confirmar. A restrição `approved_is_complete` só exige número na juramentada.

### Idiomas

`pt`, `en`, `fr`, `it`, `es`, sempre com o português de um dos lados. Datas por extenso, separadores e modelos de abertura/fecho existem para os cinco. O LibreTranslate local carrega os cinco (`LT_LOAD_ONLY`).

### Regras por modalidade × idioma de destino (`translation_profiles`)

O padrão vem das skills e fica no código (`defaultRules`); o banco guarda só o que o Supervisor ou o Diretor mudou (`PUT /api/v1/translation-profiles/:mode/:target`, `rules: null` volta ao padrão, com auditoria `translation.profile_set` / `translation.profile_reset`). Ajuste inválido é ignorado e vale o padrão.

| Regra | Padrão das skills |
| --- | --- |
| Fonte | Calibri Light 10 (inglês); Times New Roman 10 (demais) |
| Sufixo do arquivo | ` - ENG`, `-FRA`, ` - ITA`, ` - ESP`, ` - POR`; o nome do original nunca muda |
| Datas | Por extenso no idioma de destino; italiano mantém como no original |
| Números e códigos | Exatamente como no original (simples converte o separador decimal) |
| Elementos visuais | Marcador entre colchetes (`[Brasão]`, `[Carimbo: …]`, `[Assinatura]`), sem nota descritiva |
| Bordas | Só nas tabelas do original; as linhas de parágrafo saíram do DOCX gerado |
| Instituições | Traduzidas; nomes próprios ficam |
| Outros idiomas no documento | Transcritos sem tradução |
| Declaração | Só certificada |

As checagens do rascunho seguem as regras: com marcadores, uma nota do tradutor vira erro `translator_note`; a conferência de números aceita a data já por extenso.

### Glossário das skills

`seedSkillGlossary` grava os termos das quatro skills (inglês 31, francês 9, italiano 24, espanhol 31) como termos da organização, `pt` → destino, com `origin` = `Skill traducao-xxx` e as alternativas na observação. Roda no `migrate` da API, é idempotente e precisa de um Diretor já criado. A tela do Glossário organiza os termos pelo idioma de destino.

## Consequências

- Certificada, técnica e simples não pedem tradutor juramentado nem número; o download sai com o nome do original mais o sufixo do idioma.
- Os testes que usam o modelo de referência (com notas do tradutor) aplicam um ajuste de perfil (`allowTranslatorNotes`), porque o padrão agora são marcadores.
- Termos curtos e genéricos do glossário (como "Oficial" ou "Matrícula") são aplicados onde aparecem; quem revisar o glossário pode removê-los ou restringi-los a uma equipe.
- Quando as skills de correção, diagramação e revisão chegarem, os checklists são ajustados pela tela "Regras de tradução", sem mudar código.

## Alternativas consideradas

- **Uma etapa de fluxo por estado** (estados `correcting`, `laying_out`): multiplicaria transições e permissões sem ganho; o checklist dá o mesmo controle dentro de `in_review`.
- **Regras só em código**: a organização precisa ajustar sem esperar uma versão nova.
- **Glossário por equipe**: as skills valem para a organização inteira.
