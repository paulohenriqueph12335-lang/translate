# ADR-033 — Tipos documentais novos, terminologia nos dois sentidos e bateria de eficiência

- Estado: Accepted
- Data: 2026-10-28
- Relacionadas: [ADR-015](015-translation-modes.md), [ADR-016](016-automatic-review.md), [ADR-019](019-sworn-layout-models.md), [ADR-030](030-document-categories-and-queue-fencing.md)

## Contexto

O produto pediu que o sistema ficasse preparado para os seguintes documentos, do Brasil e dos países de maior peso:

- CNN (certidão negativa de naturalização);
- antecedentes criminais;
- atestados;
- certidões de conselho (CFM e CRM);
- divórcio;
- procuração;
- ementa;
- certidões do registro civil.

Também pediu uma bateria de testes com meta de 99%. Os níveis pedidos são 95% para o alerta e 90% para o crítico.

Antes desta decisão:

- esses documentos caíam em "Documento geral" ou eram confundidos;
- a procuração e o divórcio citam RG e certidão de casamento, por isso eram classificados como identidade ou casamento;
- o glossário só tinha o sentido português → estrangeiro, das skills.

## Decisão

### Sete tipos novos

Os tipos novos entram em `BODY_MODELS`:

| Tipo | Descrição | Rótulo e valor em tabela |
| --- | --- | --- |
| `naturalization_certificate` | CNN | sim |
| `criminal_record` | antecedentes criminais | sim |
| `medical_certificate` | atestado médico | não |
| `attestation` | outros atestados e declarações | não |
| `divorce` | sentença ou escritura de divórcio | não |
| `power_of_attorney` | procuração e substabelecimento | não |
| `syllabus` | ementa e plano de ensino | sim |

Cada tipo traz as palavras-chave nos cinco idiomas e o título no idioma de destino. Os tipos que já existiam ganharam as variantes estrangeiras:

- *Certificate of Live Birth*, *Entry of Birth*, *certificación literal*;
- *Good Standing*, GMC, *Ordre des médecins*, *Ordine dei Medici*, *Colegio de Médicos*, OAB.

A migração `0035` estende os `CHECK` das categorias. Ela também reclassifica pelo título as traduções antigas que estavam como "Documento geral" e tinham sido classificadas automaticamente. Uma escolha humana nunca é alterada.

### Ordem da classificação

1. O título do original.
2. A primeira linha de título em maiúsculas do começo do texto.
3. O começo do texto, por prioridade.

Na prioridade, o tipo mais específico vem antes do que ele costuma citar:

- apostila;
- CNN;
- antecedentes;
- atestado médico;
- conselho;
- procuração;
- divórcio;
- identidade e certidões;
- histórico;
- diploma;
- ementa;
- fatura;
- contrato;
- atestados e declarações soltos.

### Terminologia

`document-glossary.ts` tem os termos dos tipos novos e das certidões:

- do português para EN, FR, IT e ES;
- de EN, FR, IT e ES para o português.

Fontes e critérios estão em [tipos-documentais.md](../tipos-documentais.md). O `migrate` semeia esses termos junto com as skills, sem repetir: `SEEDED_GLOSSARY`, com `ON CONFLICT DO NOTHING`. Um termo ajustado por uma pessoa fica como está.

Termos sobrepostos deixaram de gerar alerta falso. Quando "Cartório de Registro Civil" já foi aplicado, "Cartório" e "Registro Civil" não são cobrados de novo. Isso vale na checagem (`checkDraft`) e na revisão automática, que não retraduz o trecho à toa.

### Bateria de eficiência

A bateria fica em `packages/core/src/benchmark`. São 66 documentos fictícios, com a estrutura dos reais, em duas partes:

- **Principal:** 47 documentos, 90 traduções.
- **Validação:** 19 documentos, 47 traduções. Foram escritos à parte e medidos antes de qualquer ajuste.

Cada documento passa por `draftFromFile`, o mesmo caminho do worker, com o glossário que a migração semeia. Os critérios conferidos são:

- tipo reconhecido;
- título no idioma de destino;
- cada termo-chave com tradução aprovada e presente no rascunho;
- números, datas e códigos;
- estrutura;
- blocos vazios;
- glossário em todo o texto;
- com provedor real, também tradução feita e idioma de destino.

As faixas são estas:

| Faixa | Eficiência |
| --- | --- |
| Meta | 99% ou mais |
| Abaixo da meta | entre 95% e 99% |
| Alerta | 95% ou menos |
| Crítico | 90% ou menos |

Os comandos são dois:

- `benchmark.test.ts` roda a bateria no CI com o tradutor simulado e exige 99%.
- `pnpm --filter @tradutor/api benchmark` usa o LibreTranslate do ambiente quando está no ar e grava o relatório com `--saida`. Abaixo de 95%, o comando termina com erro.

## Consequências

- Os resultados, de antes e depois dos ajustes, estão no relatório da bateria.
- O modo simulado não mede a fluência da tradução automática, que depende do provedor. Ele mede o que o sistema controla. A medição real roda no ambiente com o LibreTranslate.
- Documentos de órgãos ainda não cadastrados continuam podendo trazer termos sem tradução aprovada. A revisão aponta esses termos, e o glossário cresce em Ajustes.

## Alternativas consideradas

- **Um único tipo "certidão" com subtipos:** misturaria regras de diagramação diferentes e não resolveria a confusão entre procuração e identidade.
- **Glossário por tipo de documento:** mais preciso, mas exige mudar o schema e a tela. O glossário por par de idiomas, só com locuções fixas, atendeu à bateria.
- **Medir só com o provedor real:** o ambiente de desenvolvimento nem sempre tem os modelos. O CI precisa de uma verificação que não dependa de rede.
