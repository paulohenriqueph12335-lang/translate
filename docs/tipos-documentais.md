# Tipos documentais: CNN, antecedentes, atestados, conselhos, divórcio, procuração e ementa

Atualizado em 28/10/2026. Esta é a base de conhecimento que alimenta o sistema:

- os modelos de corpo em `packages/core/src/translation/body-models.ts`;
- o glossário em `packages/core/src/translation/document-glossary.ts`;
- a bateria de testes em `packages/core/src/benchmark`.

Os exemplos da bateria são fictícios. Seguem a estrutura e as fórmulas dos documentos reais, sem dados pessoais.

## Abrangência

- **Origem:** Brasil, Estados Unidos, Reino Unido, França, Itália e Espanha.
- **Idiomas:** os do sistema, ou seja, português, inglês, francês, italiano e espanhol.
- **Fora do escopo:** documentos em alemão, chinês, japonês e outros idiomas. O sistema não traduz esses idiomas, e eles exigiriam outro provedor e outro glossário.

## Como o sistema identifica o tipo

A identificação segue três passos, em ordem:

1. **Título do original:** o título detectado no PDF ou no Word.
2. **Linha de título:** sem título reconhecido, a primeira linha em maiúsculas que nomeia um tipo, entre as oito primeiras linhas do documento. É o caso de "ATESTADO MÉDICO" logo abaixo do timbre da clínica.
3. **Começo do texto:** se nenhuma linha resolver, o começo do texto, por ordem de prioridade.

Na ordem de prioridade, o tipo mais específico vem antes do que ele cita:

- A apostila cita o documento apostilado.
- A procuração, o divórcio e as certidões de antecedentes qualificam as pessoas com RG e citam a certidão de casamento.
- O atestado médico traz o CRM do médico.
- "Declaração" e "atestado", soltos, ficam por último.

A pessoa pode trocar o tipo na tradução, e a escolha humana prevalece (ADR-030).

## Tipos e o que caracteriza cada um

| Tipo (categoria)                                       | Brasil                                                                                                                                                                          | Outros países                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CNN, certidão negativa de naturalização (`naturalization_certificate`) | Ministério da Justiça e Segurança Pública, Secretaria Nacional de Justiça, Departamento de Migrações. Fórmula: "não foi localizado processo ou registro relativo à naturalização brasileira de…". Traz as variações de grafia pesquisadas. Os consulados italianos pedem a CNN apostilada e traduzida (cidadania *iure sanguinis*). | EUA: USCIS, "Certificate of Non-Existence of Naturalization Record".                                                                                                                                                                                                                     |
| Antecedentes criminais (`criminal_record`)             | Polícia Federal: "após pesquisa no SINIC… NÃO CONSTA condenação com trânsito em julgado", válida por 90 dias, com validação no portal da PF. Também a certidão judicial criminal negativa da Justiça Federal e o atestado de antecedentes da Polícia Civil dos estados.   | EUA: FBI, *Identity History Summary* ("no prior arrest data"). Reino Unido: ACRO *Police Certificate* ("No Live Trace") e DBS *Basic Certificate*. França: *bulletin n° 3 du casier judiciaire* ("Néant"). Itália: *Certificato del Casellario Giudiziale* (art. 24, D.P.R. 313/2002, "NULLA") e *Carichi Pendenti*. Espanha: *Certificado de Antecedentes Penales*, Registro Central de Penados ("no constan antecedentes penales"). |
| Atestado médico (`medical_certificate`)                | Resolução CFM nº 2.381/2024, que substituiu a 1.658/2002. O CID só aparece com autorização expressa do paciente ou justa causa. Traz os dias de afastamento, o CRM e o RQE.                                                                     | Reino Unido: *Statement of Fitness for Work* (fit note). França: *certificat médical*, *arrêt de travail*. Itália: *certificato medico*. Espanha: *certificado médico oficial*, do Consejo General de Colegios Oficiales de Médicos.                                                                    |
| Atestados e declarações (`attestation`)                | Declaração de matrícula, de residência, de vínculo e atestados que não são médicos nem de antecedentes.                                                                                       | *Affidavit*, *To whom it may concern*, *attestation sur l'honneur*, *dichiarazione*, *constancia*.                                                                                                                                                                                                 |
| Conselho profissional (`professional_certificate`)     | CRM e CFM: certidão de inscrição e regularidade, certidão negativa ético-profissional, RQE. Também CRO, COREN e OAB (Conselho Seccional).                                                                                             | EUA: *State Medical Board*, *Certificate of Good Standing*. Reino Unido: GMC, *Certificate of Current Professional Status*, válido por 3 meses. França: *Ordre des médecins*, *attestation d'inscription au tableau*. Itália: *Ordine dei Medici*, *iscrizione all'Albo*. Espanha: *Colegio Oficial de Médicos*, *certificado de colegiación*. |
| Divórcio (`divorce`)                                   | Escritura pública de divórcio consensual (art. 733 do CPC: sem filhos menores ou incapazes), sentença com trânsito em julgado, averbação no registro civil, partilha, pensão e guarda. O nome de solteira volta.                    | EUA: Califórnia, FL-180 *Judgment of Dissolution of Marriage* (Petitioner/Respondent); Nova York, *Judgment of Divorce*. Reino Unido: *Final Order*, antes *Decree Absolute*. França: *jugement de divorce*, "prononce le divorce", menção à margem do *acte de mariage*. Itália: "cessazione degli effetti civili del matrimonio", "annotazione". Espanha: *sentencia de divorcio*, *convenio regulador*. |
| Procuração (`power_of_attorney`)                       | Pública, lavrada no Tabelionato de Notas (livro e folha), ou particular com reconhecimento de firma. Partes: outorgante e outorgado. Fórmulas: "amplos e gerais poderes", substabelecer com ou sem reserva de poderes, "ad judicia et extra". Arts. 653 a 692 do Código Civil.                       | EUA: *Durable* ou *Special Power of Attorney*, *Attorney-in-Fact*, *Notary Public*. França: *procuration*, *mandant*/*mandataire*. Itália: *procura speciale* ou *generale*, "con promessa di rato e valido". **Atenção:** *Procura della Repubblica* é a promotoria, não uma procuração. Espanha: *escritura de poder*, "ante mí", *poderdante*/*apoderado*. |
| Ementa e plano de ensino (`syllabus`)                  | Disciplina, código, carga horária (teórica e prática), créditos, pré-requisitos, ementa, objetivos, conteúdo programático, critérios de avaliação, bibliografia básica e complementar.                                         | EUA e Reino Unido: *syllabus*, *course description*, *credit hours*, *learning outcomes*. França: *programme d'enseignement*, *volume horaire*, *crédits ECTS*. Itália: *programma del corso*, CFU, *settore scientifico-disciplinare*. Espanha: *guía docente*, *programa de la asignatura*, *créditos ECTS*. |
| Certidões do registro civil                            | Matrícula nacional (Provimento CNJ 63/2017, hoje no Provimento 149/2023): serventia, ano, tipo de livro, livro, folha, termo e dígitos verificadores. Também filiação, avós, averbações e selo digital.                                       | EUA: *Certificate of Live Birth*. Reino Unido: *Certified Copy of an Entry of Birth* (GRO). França: *copie intégrale*, *extrait avec/sans filiation*. Itália: *estratto per riassunto dell'atto*. Espanha: *certificación literal*. |

## Terminologia

O glossário semeado tem, além das skills de tradução (ADR-015):

- do português para inglês, francês, italiano e espanhol: órgãos, títulos, fórmulas de cartório, termos de divórcio, procuração e ementa;
- do inglês, francês, italiano e espanhol para o português: os nomes oficiais e as fórmulas dos documentos estrangeiros.

Regras do glossário:

- Entram só nomes oficiais, títulos e locuções fixas.
- Ficam de fora palavras soltas que mudam de sentido. Exemplos: "NULLA" (em "nulla osta" não é "nada consta") e "Procura" (pode ser a promotoria).
- Um termo já cadastrado, mesmo ajustado por alguém, não é trocado: o semeio é `ON CONFLICT DO NOTHING`.
- Formas femininas entram à parte, como "Outorgada", "Requerida" e "Apoderada".

## Referências

Normas e portais oficiais consultados:

- **Brasil:**
  - Polícia Federal (gov.br/pf, emissão e validação da certidão de antecedentes);
  - Ministério da Justiça e Segurança Pública (Departamento de Migrações);
  - Resolução CFM nº 2.381/2024;
  - Código de Processo Civil, art. 733;
  - Código Civil, arts. 653 a 692;
  - Provimentos CNJ 63/2017 e 149/2023.
- **EUA:** FBI (fbi.gov, *Identity History Summary Checks*); Judicial Council of California (formulário FL-180); USCIS.
- **Reino Unido:** ACRO Criminal Records Office (acro.police.uk); DBS; General Medical Council (gmc-uk.org); GOV.UK (*fit note*, *final order*).
- **França:** Casier judiciaire national (casier-judiciaire.justice.gouv.fr); Code de procédure pénale, art. 777; Code de procédure civile, art. 1082; Conseil national de l'Ordre des médecins.
- **Itália:** Ministero della Giustizia (giustizia.it); D.P.R. 313/2002, art. 24; Codice civile, arts. 1387 e seguintes; Ordini dei Medici (FNOMCeO).
- **Espanha:** Ministerio de Justicia (mjusticia.gob.es, modelo 790-006); Registro Central de Penados; Consejo General de Colegios Oficiales de Médicos.
