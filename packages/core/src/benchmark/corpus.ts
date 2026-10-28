import type { BodyModel } from '../translation/body-models.js';
import type { Language } from '../translation/draft.js';

/**
 * Bateria de documentos fictícios dos tipos pesquisados em 28/10/2026 (docs/tipos-documentais.md). Os textos seguem a
 * estrutura e as fórmulas dos documentos reais de cada país, com nomes, números e códigos inventados (todos marcados
 * como FICTÍCIOS). Nenhum dado pessoal real.
 *
 * `keyTerms`: termos do original que um tradutor juramentado precisa verter sempre do mesmo jeito (órgãos, títulos,
 * fórmulas fixas). A bateria confere que cada um tem tradução aprovada no glossário e que ela aparece no rascunho.
 */
export interface BenchmarkSample {
  id: string;
  country: 'BR' | 'US' | 'UK' | 'FR' | 'IT' | 'ES';
  category: BodyModel;
  source: Language;
  targets: Language[];
  text: string;
  keyTerms: string[];
}

const FROM_BRAZIL: Language[] = ['en', 'fr', 'it', 'es'];

export const BENCHMARK_CORPUS: BenchmarkSample[] = [
  // ───────────── Brasil ─────────────
  {
    id: 'br-cnn',
    country: 'BR',
    category: 'naturalization_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `MINISTÉRIO DA JUSTIÇA E SEGURANÇA PÚBLICA
SECRETARIA NACIONAL DE JUSTIÇA
DEPARTAMENTO DE MIGRAÇÕES
CERTIDÃO NEGATIVA DE NATURALIZAÇÃO
Nº 0458/2026 – FICTÍCIA
CERTIFICO, para os devidos fins, que após pesquisa nos sistemas deste Departamento de Migrações, não foi localizado processo ou registro relativo à naturalização brasileira de:
Nome: GIUSEPPE ROSSI FICTÍCIO
Data de nascimento: 12/03/1931
Naturalidade: Treviso, Itália
Filiação: ANTONIO ROSSI e MARIA BIANCHI
Variações de grafia pesquisadas: GIUSEPPE ROSSI, JOSÉ ROSSI
Não consta pedido de naturalização em nome do requerente.
Esta certidão é válida por 90 (noventa) dias.
Brasília, 15 de outubro de 2026.
Código de Validação: 7F3A-91C2-0D44
A autenticidade do documento pode ser conferida no endereço www.gov.br/validacao-ficticia.`,
    keyTerms: [
      'Ministério da Justiça e Segurança Pública',
      'Secretaria Nacional de Justiça',
      'Departamento de Migrações',
      'Certidão Negativa de Naturalização',
      'naturalização brasileira',
      'Naturalidade',
      'Filiação',
      'Não consta',
      'Esta certidão é válida por',
      'Código de Validação',
      'A autenticidade do documento',
    ],
  },
  {
    id: 'br-antecedentes-pf',
    country: 'BR',
    category: 'criminal_record',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `MINISTÉRIO DA JUSTIÇA E SEGURANÇA PÚBLICA
POLÍCIA FEDERAL
CERTIDÃO DE ANTECEDENTES CRIMINAIS
Nº 2026.0912.3345 – FICTÍCIA
A POLÍCIA FEDERAL CERTIFICA, após pesquisa no Sistema Nacional de Informações Criminais (SINIC), que, até a presente data, NÃO CONSTA condenação com trânsito em julgado em nome de:
Nome: MARIANA COSTA FICTÍCIA
CPF: 000.123.456-78
Data de nascimento: 04/07/1990
Filiação: PEDRO COSTA e ANA LIMA
Esta certidão é válida por 90 (noventa) dias a partir da data de emissão.
Certidão emitida em 20/10/2026 às 14:32.
Código de Validação: PF-2026-AB12CD
A autenticidade do documento pode ser verificada em servicos.pf.gov.br/validacao-ficticia.`,
    keyTerms: [
      'Ministério da Justiça e Segurança Pública',
      'Polícia Federal',
      'Certidão de Antecedentes Criminais',
      'Sistema Nacional de Informações Criminais',
      'trânsito em julgado',
      'Não consta',
      'CPF',
      'Filiação',
      'Esta certidão é válida por',
      'Certidão emitida',
      'Código de Validação',
      'A autenticidade do documento',
    ],
  },
  {
    id: 'br-atestado-medico',
    country: 'BR',
    category: 'medical_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `CLÍNICA MÉDICA FICTÍCIA LTDA.
ATESTADO MÉDICO
Atesto, para os devidos fins, que o Sr. JOÃO PEREIRA FICTÍCIO, portador do CPF 111.222.333-44, esteve sob meus cuidados profissionais em 14/10/2026 e necessita de 5 (cinco) dias de afastamento de suas atividades, a partir desta data.
CID J11, informado com autorização expressa do paciente, conforme a Resolução CFM nº 2.381/2024.
São Paulo, 14 de outubro de 2026.
[Assinatura]
Dra. HELENA SOUZA FICTÍCIA
Conselho Regional de Medicina do Estado de São Paulo – CRM-SP 123456
Registro de Qualificação de Especialista (RQE) nº 98765`,
    keyTerms: ['Atestado Médico', 'CPF', 'Conselho Regional de Medicina', 'Registro de Qualificação de Especialista'],
  },
  {
    id: 'br-declaracao-matricula',
    country: 'BR',
    category: 'attestation',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `UNIVERSIDADE FEDERAL FICTÍCIA
SECRETARIA DE REGISTRO ACADÊMICO
DECLARAÇÃO
Declaramos, para os devidos fins, que LUCAS ALMEIDA FICTÍCIO, matrícula nº 2021004455, está regularmente matriculado no 8º período do curso de Engenharia Civil desta Universidade, no período letivo 2026/2, com carga horária semanal de 24 horas.
Por ser verdade, firmamos a presente declaração.
Recife, 3 de setembro de 2026.
[Carimbo]
MARIA DAS GRAÇAS FICTÍCIA
Secretária de Registro Acadêmico`,
    keyTerms: ['Carga Horária'],
  },
  {
    id: 'br-crm-regularidade',
    country: 'BR',
    category: 'professional_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `CONSELHO REGIONAL DE MEDICINA DO ESTADO DO RIO DE JANEIRO
CERTIDÃO DE INSCRIÇÃO E REGULARIDADE
Nº 55.321/2026 – FICTÍCIA
CERTIFICAMOS que o médico abaixo identificado encontra-se inscrito neste Conselho Regional de Medicina, em situação regular, até a presente data.
Nome: RAFAEL MONTEIRO FICTÍCIO
CRM-RJ: 52.123456-7
Inscrição Principal: 10/02/2012
Especialidade: Cardiologia – RQE nº 34567
Situação: Ativo
Certidão emitida em 22/10/2026, válida por 30 (trinta) dias.
Código de Validação: CRMRJ-7781-XY`,
    keyTerms: ['Conselho Regional de Medicina', 'Certidão de Inscrição', 'Certidão emitida', 'Código de Validação'],
  },
  {
    id: 'br-cfm-etico',
    country: 'BR',
    category: 'professional_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `CONSELHO FEDERAL DE MEDICINA
CERTIDÃO NEGATIVA ÉTICO-PROFISSIONAL
Nº 9.876/2026 – FICTÍCIA
Certificamos que, nos registros do Conselho Federal de Medicina, não consta processo ético-profissional transitado em julgado contra o médico RAFAEL MONTEIRO FICTÍCIO, inscrito no Conselho Regional de Medicina do Estado do Rio de Janeiro sob o nº 52.123456-7.
Brasília, 22 de outubro de 2026.
Código de Validação: CFM-2026-4455`,
    keyTerms: [
      'Conselho Federal de Medicina',
      'Certidão Negativa Ético-Profissional',
      'Conselho Regional de Medicina',
      'Não consta',
      'Código de Validação',
    ],
  },
  {
    id: 'br-escritura-divorcio',
    country: 'BR',
    category: 'divorce',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `REPÚBLICA FEDERATIVA DO BRASIL
2º TABELIONATO DE NOTAS DE CURITIBA – FICTÍCIO
ESCRITURA PÚBLICA DE DIVÓRCIO CONSENSUAL
Livro 1234, Folha 056
SAIBAM quantos esta virem que, aos 10 (dez) dias do mês de agosto de 2026, perante mim, Tabelião de Notas, compareceram as partes CARLOS MENDES FICTÍCIO, CPF 222.333.444-55, e BEATRIZ MENDES FICTÍCIA, CPF 333.444.555-66, casados sob o regime de comunhão parcial de bens, conforme certidão de casamento matrícula 012345 01 55 2010 2 00010 123 0004567 89.
As partes declaram que não há filhos menores ou incapazes e requerem a lavratura da presente escritura, nos termos do art. 733 do Código de Processo Civil.
Partilha de bens: o imóvel matrícula nº 45.678 caberá integralmente à divorcianda.
A divorcianda voltará a usar o nome de solteira BEATRIZ ALVES FICTÍCIA.
Pensão alimentícia: dispensada por ambas as partes.
O conteúdo é verdadeiro. Dou fé.
[Assinatura]
Tabelião de Notas`,
    keyTerms: [
      'Tabelionato de Notas',
      'Escritura Pública de Divórcio Consensual',
      'Tabelião de Notas',
      'CPF',
      'regime de comunhão parcial de bens',
      'Partilha de bens',
      'nome de solteira',
      'Pensão alimentícia',
      'Dou fé',
    ],
  },
  {
    id: 'br-sentenca-divorcio',
    country: 'BR',
    category: 'divorce',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `PODER JUDICIÁRIO
TRIBUNAL DE JUSTIÇA DO ESTADO DE MINAS GERAIS – FICTÍCIO
2ª VARA DE FAMÍLIA E SUCESSÕES DA COMARCA DE BELO HORIZONTE
Processo nº 5001234-56.2025.8.13.0024
Ação: Divórcio Litigioso
Requerente: ANDRÉ SOUZA FICTÍCIO
Requerida: LÚCIA SOUZA FICTÍCIA
SENTENÇA
Vistos etc. Diante do exposto, JULGO PROCEDENTE o pedido e DECRETO o divórcio das partes, com fundamento no art. 226, § 6º, da Constituição Federal.
A guarda compartilhada dos filhos menores fica mantida, e a pensão alimentícia é fixada em 30% (trinta por cento) do salário mínimo.
Após o trânsito em julgado, expeça-se mandado de averbação ao Cartório de Registro Civil.
Belo Horizonte, 5 de maio de 2026.
[Assinatura eletrônica]
Juiz de Direito`,
    keyTerms: [
      'Vara de Família e Sucessões',
      'Divórcio Litigioso',
      'Requerente',
      'Requerida',
      'Guarda compartilhada',
      'Pensão alimentícia',
      'trânsito em julgado',
      'Averbação',
      'Cartório de Registro Civil',
    ],
  },
  {
    id: 'br-procuracao-publica',
    country: 'BR',
    category: 'power_of_attorney',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `REPÚBLICA FEDERATIVA DO BRASIL
1º TABELIONATO DE NOTAS DE PORTO ALEGRE – FICTÍCIO
PROCURAÇÃO PÚBLICA
Livro 567-P, Folha 089
OUTORGANTE: ROBERTO LIMA FICTÍCIO, brasileiro, divorciado, engenheiro, CPF 444.555.666-77, residente em Porto Alegre/RS.
OUTORGADA: FERNANDA LIMA FICTÍCIA, brasileira, solteira, advogada, inscrita na Ordem dos Advogados do Brasil sob o nº 98.765.
PODERES: amplos e gerais poderes para representar o Outorgante perante o Consulado-Geral da Itália, requerer certidões, assinar requerimentos e praticar todos os atos necessários ao reconhecimento da cidadania italiana, podendo substabelecer com reserva de poderes.
O conteúdo é verdadeiro. Dou fé.
[Selo]
Escrevente Autorizado`,
    keyTerms: [
      'Tabelionato de Notas',
      'Procuração',
      'Outorgante',
      'Outorgada',
      'CPF',
      'Ordem dos Advogados do Brasil',
      'amplos e gerais poderes',
      'com reserva de poderes',
      'Dou fé',
      'Escrevente',
    ],
  },
  {
    id: 'br-procuracao-ad-judicia',
    country: 'BR',
    category: 'power_of_attorney',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `PROCURAÇÃO AD JUDICIA ET EXTRA
OUTORGANTE: SILVIA RAMOS FICTÍCIA, brasileira, casada, professora, CPF 555.666.777-88.
OUTORGADO: MARCOS VIEIRA FICTÍCIO, advogado inscrito na Ordem dos Advogados do Brasil, Seção de São Paulo, sob o nº 123.456.
PODERES: os da cláusula ad judicia et extra, para o foro em geral, em qualquer juízo, instância ou tribunal, podendo propor ações, transigir, desistir, receber e dar quitação, e substabelecer sem reserva de poderes.
São Paulo, 1º de setembro de 2026.
[Assinatura]
Reconhecimento de firma por autenticidade no 3º Tabelionato de Notas – FICTÍCIO.`,
    keyTerms: [
      'Procuração Ad Judicia',
      'Outorgante',
      'Outorgado',
      'CPF',
      'Ordem dos Advogados do Brasil',
      'sem reserva de poderes',
      'Reconhecimento de firma',
      'Tabelionato de Notas',
    ],
  },
  {
    id: 'br-plano-de-ensino',
    country: 'BR',
    category: 'syllabus',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `UNIVERSIDADE FEDERAL FICTÍCIA
PLANO DE ENSINO
Disciplina: Cálculo Diferencial e Integral I
Código: MAT101
Carga Horária: 90 horas (60 teóricas e 30 práticas)
Créditos: 6
Pré-requisitos: não há
Ementa: Funções reais de uma variável. Limites e continuidade. Derivadas e aplicações. Integrais definidas e indefinidas.
Objetivo Geral: capacitar o estudante a resolver problemas de taxas de variação e de áreas.
Conteúdo Programático: 1. Funções; 2. Limites; 3. Derivadas; 4. Integrais.
Critérios de Avaliação: duas provas escritas (peso 4 cada) e listas de exercícios (peso 2).
Bibliografia Básica: STEWART, J. Cálculo. Vol. 1. 8. ed. São Paulo: Cengage, 2016.
Bibliografia Complementar: GUIDORIZZI, H. L. Um curso de cálculo. Vol. 1. 6. ed. Rio de Janeiro: LTC, 2018.`,
    keyTerms: [
      'Plano de Ensino',
      'Disciplina',
      'Carga Horária',
      'Pré-requisitos',
      'Ementa',
      'Objetivo Geral',
      'Conteúdo Programático',
      'Critérios de Avaliação',
      'Bibliografia Básica',
      'Bibliografia Complementar',
    ],
  },
  {
    id: 'br-nascimento',
    country: 'BR',
    category: 'birth_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `REPÚBLICA FEDERATIVA DO BRASIL
REGISTRO CIVIL DAS PESSOAS NATURAIS
CERTIDÃO DE NASCIMENTO
Nome: ANA CLARA OLIVEIRA FICTÍCIA
CPF: 666.777.888-99
Matrícula: 104539 01 55 2015 1 00123 045 0012345 12
Data de nascimento: 21 de janeiro de 2015
Local de nascimento: Hospital Municipal Fictício, Campinas/SP
Sexo: Feminino
Filiação: JORGE OLIVEIRA FICTÍCIO e PAULA SANTOS FICTÍCIA
Avós paternos: JOSÉ OLIVEIRA e MARIA OLIVEIRA
Avós maternos: ANTÔNIO SANTOS e LUZIA SANTOS
Averbações: não consta.
O conteúdo é verdadeiro. Dou fé.
Campinas, 2 de outubro de 2026.
Oficial de Registro Civil
Selo Digital de Emissão Digital: AB12345-XYZ`,
    keyTerms: [
      'Registro Civil das Pessoas Naturais',
      'Certidão de Nascimento',
      'CPF',
      'Matrícula',
      'Filiação',
      'Avós paternos',
      'Avós maternos',
      'Averbações',
      'Não consta',
      'Dou fé',
      'Oficial de Registro Civil',
    ],
  },
  {
    id: 'br-casamento-averbado',
    country: 'BR',
    category: 'marriage_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `REPÚBLICA FEDERATIVA DO BRASIL
REGISTRO CIVIL DAS PESSOAS NATURAIS
CERTIDÃO DE CASAMENTO
Matrícula: 104539 01 55 2010 2 00045 210 0004567 33
Cônjuges: CARLOS MENDES FICTÍCIO e BEATRIZ ALVES FICTÍCIA
Data do casamento: 18 de dezembro de 2010
Regime de bens: regime de comunhão parcial de bens
Averbação: Divórcio consensual lavrado por escritura pública em 10/08/2026, no 2º Tabelionato de Notas de Curitiba. A cônjuge voltou a usar o nome de solteira.
O conteúdo é verdadeiro. Dou fé.
Oficial de Registro Civil`,
    keyTerms: [
      'Registro Civil das Pessoas Naturais',
      'Certidão de Casamento',
      'Matrícula',
      'regime de comunhão parcial de bens',
      'Averbação',
      'Divórcio Consensual',
      'Tabelionato de Notas',
      'nome de solteira',
      'Dou fé',
      'Oficial de Registro Civil',
    ],
  },
  {
    id: 'br-obito',
    country: 'BR',
    category: 'death_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `REPÚBLICA FEDERATIVA DO BRASIL
REGISTRO CIVIL DAS PESSOAS NATURAIS
CERTIDÃO DE ÓBITO
Nome: ANTÔNIO ROSSI FICTÍCIO
Matrícula: 104539 01 55 1998 4 00012 033 0000987 21
Data do óbito: 3 de março de 1998
Naturalidade: Treviso, Itália
Filiação: GIUSEPPE ROSSI e MARIA BIANCHI
Causa da morte: insuficiência cardíaca
Averbações: não consta.
O conteúdo é verdadeiro. Dou fé.
Oficial de Registro Civil`,
    keyTerms: [
      'Registro Civil das Pessoas Naturais',
      'Certidão de Óbito',
      'Matrícula',
      'Naturalidade',
      'Filiação',
      'Averbações',
      'Não consta',
      'Dou fé',
    ],
  },

  // ───────────── Estados Unidos ─────────────
  {
    id: 'us-fbi',
    country: 'US',
    category: 'criminal_record',
    source: 'en',
    targets: ['pt'],
    text: `U.S. Department of Justice
Federal Bureau of Investigation
Criminal Justice Information Services Division
IDENTITY HISTORY SUMMARY
Request No. 2026-FICT-778899
The fingerprints submitted for JOHN A. SAMPLE (FICTITIOUS), date of birth 07/14/1985, were searched against the FBI Next Generation Identification system.
Result: a search of the fingerprints revealed no prior arrest data at the FBI.
This response is valid only for the individual identified above. Issued on October 9, 2026.
[Seal]
Criminal Justice Information Services Division`,
    keyTerms: [
      'Federal Bureau of Investigation',
      'Criminal Justice Information Services',
      'Identity History Summary',
      'no prior arrest data',
    ],
  },
  {
    id: 'us-uscis-non-naturalization',
    country: 'US',
    category: 'naturalization_certificate',
    source: 'en',
    targets: ['pt'],
    text: `U.S. Department of Homeland Security
U.S. Citizenship and Immigration Services
CERTIFICATE OF NON-EXISTENCE OF NATURALIZATION RECORD
File No. FICT-0001-2026
I certify that, after a diligent search of the records of U.S. Citizenship and Immigration Services, no record of naturalization was found for MARIO VERDI (FICTITIOUS), born on 05/02/1920 in Lucca, Italy.
Issued on September 30, 2026.
[Seal]
Records Officer`,
    keyTerms: ['Certificate of Non-Existence of Naturalization Record', 'U.S. Citizenship and Immigration Services'],
  },
  {
    id: 'us-dissolution-fl180',
    country: 'US',
    category: 'divorce',
    source: 'en',
    targets: ['pt'],
    text: `SUPERIOR COURT OF CALIFORNIA, COUNTY OF SAN DIEGO
Case No. 26FL001234 (FICTITIOUS)
Petitioner: EMILY SAMPLE
Respondent: DAVID SAMPLE
JUDGMENT OF DISSOLUTION OF MARRIAGE
The court orders that the marital status is terminated and the parties are restored to the status of single persons on June 30, 2026.
Child custody and visitation are ordered as set forth in the attached agreement.
Spousal support: reserved for both parties.
Date: July 1, 2026
[Signature]
Judicial Officer`,
    keyTerms: ['Superior Court', 'Petitioner', 'Respondent', 'Judgment of Dissolution of Marriage', 'Spousal support'],
  },
  {
    id: 'us-durable-poa',
    country: 'US',
    category: 'power_of_attorney',
    source: 'en',
    targets: ['pt'],
    text: `DURABLE POWER OF ATTORNEY
State of Florida, County of Orange
I, LINDA SAMPLE (FICTITIOUS), hereby appoint ROBERT SAMPLE as my Attorney-in-Fact, to act in my name in all matters before the Consulate General of Brazil, including signing documents and receiving certificates.
This Power of Attorney shall not be affected by subsequent disability or incapacity of the principal.
Signed on August 12, 2026.
[Signature]
Sworn to and subscribed before me by means of physical presence.
Notary Public, State of Florida
My commission expires: 03/15/2029`,
    keyTerms: ['Durable Power of Attorney', 'Attorney-in-Fact', 'Power of Attorney', 'Notary Public'],
  },
  {
    id: 'us-board-good-standing',
    country: 'US',
    category: 'professional_certificate',
    source: 'en',
    targets: ['pt'],
    text: `STATE MEDICAL BOARD OF OHIO (FICTITIOUS)
CERTIFICATE OF GOOD STANDING
This is to certify that SARAH SAMPLE, M.D., holds License No. 35.012345 to practice medicine and surgery in the State of Ohio, issued on 06/01/2015.
License status: Active. No disciplinary action has been taken against this license.
Issued on October 2, 2026.
[Seal]
Executive Director`,
    keyTerms: ['State Medical Board', 'Certificate of Good Standing'],
  },
  {
    id: 'us-syllabus',
    country: 'US',
    category: 'syllabus',
    source: 'en',
    targets: ['pt'],
    text: `FICTITIOUS STATE UNIVERSITY
COURSE SYLLABUS
Course: BIO 201 – Cell Biology
Credit Hours: 4
Contact Hours: 60
Prerequisites: BIO 101
Course Description: Structure and function of prokaryotic and eukaryotic cells, membranes, organelles and cell division.
Learning Outcomes: students will describe cell structures and explain the cell cycle.
Required Reading: ALBERTS, B. Molecular Biology of the Cell. 7th ed. New York: Norton, 2022.
Recommended Reading: LODISH, H. Molecular Cell Biology. 9th ed. New York: Freeman, 2021.`,
    keyTerms: [
      'Syllabus',
      'Credit Hours',
      'Contact Hours',
      'Prerequisites',
      'Course Description',
      'Learning Outcomes',
      'Required Reading',
      'Recommended Reading',
    ],
  },
  {
    id: 'us-live-birth',
    country: 'US',
    category: 'birth_certificate',
    source: 'en',
    targets: ['pt'],
    text: `STATE OF NEW YORK – DEPARTMENT OF HEALTH
CERTIFICATE OF LIVE BIRTH
Certificate No. 2026-FICT-004455
Child's name: OLIVIA SAMPLE (FICTITIOUS)
Date of birth: 03/22/2026
Place of birth: Albany, New York
Sex: Female
Mother's name: EMMA SAMPLE
Father's name: NOAH SAMPLE
Date filed: 03/25/2026
[Seal]
Registrar of Vital Statistics`,
    keyTerms: ['Certificate of Live Birth', 'Registrar of Vital Statistics'],
  },
  {
    id: 'us-medical',
    country: 'US',
    category: 'medical_certificate',
    source: 'en',
    targets: ['pt'],
    text: `FICTITIOUS FAMILY CLINIC
MEDICAL CERTIFICATE
This is to certify that MICHAEL SAMPLE was examined on 10/06/2026 and is unfit for work from 10/06/2026 to 10/10/2026 due to a medical condition.
He may return to work on 10/13/2026 without restrictions.
[Signature]
JANE SAMPLE, M.D.
License No. 123456`,
    keyTerms: ['Medical Certificate'],
  },

  // ───────────── Reino Unido ─────────────
  {
    id: 'uk-acro',
    country: 'UK',
    category: 'criminal_record',
    source: 'en',
    targets: ['pt'],
    text: `ACRO Criminal Records Office
POLICE CERTIFICATE
Reference: ACRO/2026/FICT/12345
Surname: SAMPLE
Forename(s): GEORGE WILLIAM (FICTITIOUS)
Date of birth: 11/09/1979
A search of the Police National Computer has revealed:
No Live Trace
This certificate is valid on the date of issue: 14 October 2026.
[Seal]`,
    keyTerms: ['Criminal Records Office', 'Police Certificate', 'No Live Trace', 'Police National Computer'],
  },
  {
    id: 'uk-gmc',
    country: 'UK',
    category: 'professional_certificate',
    source: 'en',
    targets: ['pt'],
    text: `GENERAL MEDICAL COUNCIL
CERTIFICATE OF CURRENT PROFESSIONAL STATUS (CERTIFICATE OF GOOD STANDING)
GMC reference number: 7012345 (FICTITIOUS)
Name: Dr OLIVER SAMPLE
The doctor named above is registered with a licence to practise and holds specialist registration in General Surgery.
There are no current fitness to practise investigations or sanctions.
This certificate is valid for three months from 1 October 2026.
[Signature]
Registrar`,
    keyTerms: ['General Medical Council', 'Certificate of Good Standing', 'licence to practise', 'fitness to practise'],
  },
  {
    id: 'uk-final-order',
    country: 'UK',
    category: 'divorce',
    source: 'en',
    targets: ['pt'],
    text: `IN THE FAMILY COURT AT BIRMINGHAM
Case number: FICT26D01234
Applicant: CHARLOTTE SAMPLE (FICTITIOUS)
Respondent: HENRY SAMPLE
FINAL ORDER (DIVORCE)
Referring to the conditional order made on 2 April 2026, the court orders that the marriage solemnised on 15 June 2012 between the applicant and the respondent is dissolved.
Dated 5 September 2026
[Seal]`,
    keyTerms: ['Family Court', 'Respondent', 'Final Order', 'Conditional Order'],
  },
  {
    id: 'uk-fit-note',
    country: 'UK',
    category: 'medical_certificate',
    source: 'en',
    targets: ['pt'],
    text: `STATEMENT OF FITNESS FOR WORK
Patient's name: AMELIA SAMPLE (FICTITIOUS)
I assessed your case on: 7 October 2026
and, because of the following condition: acute bronchitis
I advise you that you are not fit for work.
This will be the case for 10 days.
Doctor's signature: [Signature]
Date of statement: 7 October 2026`,
    keyTerms: ['Statement of Fitness for Work'],
  },

  // ───────────── França ─────────────
  {
    id: 'fr-casier',
    country: 'FR',
    category: 'criminal_record',
    source: 'fr',
    targets: ['pt'],
    text: `MINISTÈRE DE LA JUSTICE
CASIER JUDICIAIRE NATIONAL
BULLETIN N° 3
Extrait du casier judiciaire concernant :
Nom : DUPONT (FICTIF)
Prénoms : Camille Marie
Né(e) le : 14/02/1988 à Lyon
Néant
Délivré le 12 octobre 2026, à Nantes.
[Cachet]`,
    keyTerms: ['Ministère de la Justice', 'Casier judiciaire national', 'Casier judiciaire', 'Néant'],
  },
  {
    id: 'fr-naissance',
    country: 'FR',
    category: 'birth_certificate',
    source: 'fr',
    targets: ['pt'],
    text: `RÉPUBLIQUE FRANÇAISE
MAIRIE DE BORDEAUX (FICTIVE)
ACTE DE NAISSANCE
COPIE INTÉGRALE
N° 1234
Le dix mars deux mille quinze, à huit heures, est né à Bordeaux : Lucas Martin (FICTIF), du sexe masculin, de Pierre Martin et de Julie Bernard, son épouse.
Dressé le 11 mars 2015, sur la déclaration du père, par Nous, Sophie Laurent, Officier de l'état civil.
Mentions marginales : néant.
Pour copie conforme, délivrée le 5 octobre 2026.`,
    keyTerms: ['Acte de naissance', 'Copie intégrale', "Officier de l'état civil", 'Mentions marginales', 'Néant'],
  },
  {
    id: 'fr-divorce',
    country: 'FR',
    category: 'divorce',
    source: 'fr',
    targets: ['pt'],
    text: `TRIBUNAL JUDICIAIRE DE PARIS (FICTIF)
JUGEMENT DE DIVORCE
Juge aux affaires familiales
RG n° 26/01234
Entre : Madame Claire DURAND, demanderesse
Et : Monsieur Paul DURAND, défendeur
PAR CES MOTIFS, le juge aux affaires familiales prononce le divorce des époux, mariés le 20 juin 2009 à Paris.
Ordonne que la mention du divorce soit portée en marge de l'acte de mariage des époux.
Fait à Paris, le 3 juillet 2026.
[Signature]`,
    keyTerms: ['Tribunal judiciaire', 'Jugement de divorce', 'Juge aux affaires familiales', 'Acte de mariage'],
  },
  {
    id: 'fr-procuration',
    country: 'FR',
    category: 'power_of_attorney',
    source: 'fr',
    targets: ['pt'],
    text: `PROCURATION
Je soussigné(e), Monsieur Antoine LEROY (FICTIF), né le 2 mai 1975 à Lille, mandant,
donne pouvoir à Madame Inès LEROY, mandataire,
de me représenter auprès du Consulat général du Brésil à Paris afin de demander et de retirer tout certificat ou tout document me concernant.
Fait à Paris, le 1er octobre 2026.
[Signature]
Signature légalisée par Maître Hélène ROBERT, Notaire.`,
    keyTerms: ['Procuration', 'Mandant', 'Mandataire', 'Notaire'],
  },
  {
    id: 'fr-certificat-medical',
    country: 'FR',
    category: 'medical_certificate',
    source: 'fr',
    targets: ['pt'],
    text: `CABINET MÉDICAL FICTIF
CERTIFICAT MÉDICAL
Je soussigné, Docteur Marc PETIT, certifie avoir examiné ce jour Madame Léa GIRARD (FICTIVE), née le 9 septembre 1992.
Son état de santé justifie un arrêt de travail de 7 jours, du 6 au 12 octobre 2026 inclus.
Certificat établi à la demande de l'intéressée et remis en main propre.
Fait à Toulouse, le 6 octobre 2026.
[Signature]
Inscrit au tableau de l'Ordre des médecins de la Haute-Garonne sous le n° 31/12345.`,
    keyTerms: ['Certificat médical', 'Arrêt de travail', 'Ordre des médecins'],
  },
  {
    id: 'fr-ordre-medecins',
    country: 'FR',
    category: 'professional_certificate',
    source: 'fr',
    targets: ['pt'],
    text: `CONSEIL NATIONAL DE L'ORDRE DES MÉDECINS
ATTESTATION D'INSCRIPTION AU TABLEAU
Le Conseil national de l'Ordre des médecins atteste que le Docteur Julien MOREAU (FICTIF), numéro RPPS 10001234567, est inscrit au tableau de l'Ordre des médecins depuis le 15 janvier 2014 et n'a fait l'objet d'aucune sanction disciplinaire.
Fait à Paris, le 8 octobre 2026.
[Cachet]`,
    keyTerms: ["Conseil national de l'Ordre des médecins", "Attestation d'inscription au tableau", 'Ordre des médecins'],
  },
  {
    id: 'fr-programme',
    country: 'FR',
    category: 'syllabus',
    source: 'fr',
    targets: ['pt'],
    text: `UNIVERSITÉ FICTIVE DE STRASBOURG
PROGRAMME D'ENSEIGNEMENT
Intitulé : Droit des contrats
Volume horaire : 36 heures (24 h CM et 12 h TD)
Crédits ECTS : 6
Prérequis : Introduction au droit
Contenu : formation du contrat, effets du contrat, inexécution et responsabilité contractuelle.
Modalités d'évaluation : examen écrit final (100 %).
Bibliographie : TERRÉ, F. Droit civil. Les obligations. 13e éd. Paris : Dalloz, 2022.`,
    keyTerms: ["Programme d'enseignement", 'Volume horaire', 'Crédits ECTS', 'Prérequis', "Modalités d'évaluation"],
  },
  {
    id: 'fr-attestation-honneur',
    country: 'FR',
    category: 'attestation',
    source: 'fr',
    targets: ['pt'],
    text: `ATTESTATION SUR L'HONNEUR
Je soussignée, Madame Nadia BLANC (FICTIVE), née le 3 avril 1981 à Marseille, demeurant 12 rue des Fleurs, 13001 Marseille, atteste sur l'honneur ne pas avoir été naturalisée dans un autre pays.
Fait pour servir et valoir ce que de droit.
Fait à Marseille, le 2 octobre 2026.
[Signature]`,
    keyTerms: ["Attestation sur l'honneur"],
  },

  // ───────────── Itália ─────────────
  {
    id: 'it-casellario',
    country: 'IT',
    category: 'criminal_record',
    source: 'it',
    targets: ['pt'],
    text: `MINISTERO DELLA GIUSTIZIA
CASELLARIO GIUDIZIALE
CERTIFICATO DEL CASELLARIO GIUDIZIALE
(ART. 24 D.P.R. 14/11/2002 N. 313)
Cognome: BIANCHI (FITTIZIO)
Nome: LUCA
Data di nascita: 18/05/1984
Luogo di nascita: Torino
Nel Casellario Giudiziale risulta: NULLA
Nella banca dati del Casellario Europeo risulta: NULLA
Torino, 9 ottobre 2026
[Timbro]
Il Responsabile del Servizio`,
    keyTerms: ['Ministero della Giustizia', 'Certificato del Casellario Giudiziale', 'Casellario Giudiziale', 'Casellario Europeo'],
  },
  {
    id: 'it-nascita',
    country: 'IT',
    category: 'birth_certificate',
    source: 'it',
    targets: ['pt'],
    text: `COMUNE DI LUCCA (FITTIZIO)
UFFICIO DELLO STATO CIVILE
ESTRATTO PER RIASSUNTO DELL'ATTO DI NASCITA
Anno 1920, Parte I, Numero 145
Cognome e nome: VERDI MARIO
Data di nascita: 5 febbraio 1920
Luogo di nascita: Lucca
Padre: VERDI GIOVANNI
Madre: NERI ANNA
Annotazioni: nessuna
Lucca, 30 settembre 2026
[Timbro]
L'Ufficiale dello Stato Civile`,
    keyTerms: ['Ufficio dello Stato Civile', "Estratto per riassunto dell'atto di nascita", 'Ufficiale dello Stato Civile'],
  },
  {
    id: 'it-divorzio',
    country: 'IT',
    category: 'divorce',
    source: 'it',
    targets: ['pt'],
    text: `TRIBUNALE ORDINARIO DI MILANO (FITTIZIO)
SEZIONE NONA CIVILE
SENTENZA N. 1234/2026
Il Tribunale, definitivamente pronunciando, dichiara la cessazione degli effetti civili del matrimonio concordatario celebrato a Milano il 12 settembre 2005 tra ROSSI MARCO e VERDI GIULIA.
Ordina all'Ufficiale dello Stato Civile del Comune di Milano di procedere all'annotazione della presente sentenza.
Sentenza passata in giudicato il 15 luglio 2026.
Milano, 20 luglio 2026
[Timbro]
Il Cancelliere`,
    keyTerms: [
      'Tribunale Ordinario',
      'Cessazione degli effetti civili del matrimonio',
      'Ufficiale dello Stato Civile',
      'passata in giudicato',
    ],
  },
  {
    id: 'it-procura',
    country: 'IT',
    category: 'power_of_attorney',
    source: 'it',
    targets: ['pt'],
    text: `PROCURA SPECIALE
Il sottoscritto ROSSI MARCO (FITTIZIO), nato a Milano il 3 marzo 1978, codice fiscale RSSMRC78C03F205X,
nomina e costituisce suo procuratore speciale il signor ROSSI LUIGI, affinché in suo nome e per suo conto richieda certificati presso gli uffici del Brasile.
Il tutto con promessa di rato e valido.
Milano, 2 ottobre 2026
[Firma]
Autenticazione della firma a cura del Notaio dott. Paolo GALLI.`,
    keyTerms: ['Procura speciale', 'con promessa di rato e valido', 'Notaio'],
  },
  {
    id: 'it-certificato-medico',
    country: 'IT',
    category: 'medical_certificate',
    source: 'it',
    targets: ['pt'],
    text: `CERTIFICATO MEDICO
Si certifica che la signora FERRARI ELENA (FITTIZIA), nata a Bologna il 21 aprile 1990, è stata visitata in data odierna e presenta una sindrome influenzale.
Si prescrivono 5 giorni di riposo, dal 6 al 10 ottobre 2026.
Bologna, 6 ottobre 2026
[Firma]
Dott. ROMANO FABIO
Iscritto all'Ordine dei Medici Chirurghi e degli Odontoiatri di Bologna al n. 12345`,
    keyTerms: ['Certificato medico', 'Ordine dei Medici Chirurghi e degli Odontoiatri'],
  },
  {
    id: 'it-albo',
    country: 'IT',
    category: 'professional_certificate',
    source: 'it',
    targets: ['pt'],
    text: `ORDINE DEI MEDICI CHIRURGHI E DEGLI ODONTOIATRI DELLA PROVINCIA DI ROMA (FITTIZIO)
CERTIFICATO DI ISCRIZIONE ALL'ALBO
Si certifica che il dott. COLOMBO ANDREA, nato a Roma il 9 gennaio 1982, risulta iscritto all'Albo dei Medici Chirurghi di questa provincia dal 14 febbraio 2009 al n. 54321.
A suo carico non risultano provvedimenti disciplinari in corso.
Roma, 8 ottobre 2026
[Timbro]
Il Presidente`,
    keyTerms: ['Ordine dei Medici Chirurghi e degli Odontoiatri', "Iscrizione all'Albo"],
  },
  {
    id: 'it-programma',
    country: 'IT',
    category: 'syllabus',
    source: 'it',
    targets: ['pt'],
    text: `UNIVERSITÀ DEGLI STUDI FITTIZIA DI PADOVA
PROGRAMMA DEL CORSO
Insegnamento: Diritto privato
Settore scientifico-disciplinare: IUS/01
Crediti formativi universitari: 9 CFU
Ore di lezione: 72
Contenuti: persone fisiche e giuridiche, beni, obbligazioni, contratti, responsabilità civile.
Testi di riferimento: TORRENTE, A. Manuale di diritto privato. 26ª ed. Milano: Giuffrè, 2023.`,
    keyTerms: ['Programma del corso', 'Settore scientifico-disciplinare', 'Crediti formativi universitari', 'Ore di lezione'],
  },

  // ───────────── Espanha ─────────────
  {
    id: 'es-antecedentes',
    country: 'ES',
    category: 'criminal_record',
    source: 'es',
    targets: ['pt'],
    text: `MINISTERIO DE JUSTICIA
REGISTRO CENTRAL DE PENADOS
CERTIFICADO DE ANTECEDENTES PENALES
N.º de certificado: 2026/FICT/556677
Nombre: LUCÍA GARCÍA FERNÁNDEZ (FICTICIA)
Fecha de nacimiento: 30/11/1987
Lugar de nacimiento: Sevilla
DNI: 00000000-T
CERTIFICO: que, consultado el Registro Central de Penados, no constan antecedentes penales a nombre de la persona arriba indicada.
Madrid, 10 de octubre de 2026
[Sello]`,
    keyTerms: [
      'Ministerio de Justicia',
      'Registro Central de Penados',
      'Certificado de Antecedentes Penales',
      'no constan antecedentes penales',
    ],
  },
  {
    id: 'es-nacimiento',
    country: 'ES',
    category: 'birth_certificate',
    source: 'es',
    targets: ['pt'],
    text: `REGISTRO CIVIL DE VALENCIA (FICTICIO)
CERTIFICACIÓN LITERAL DE NACIMIENTO
Tomo 00123, Página 045, Sección 1.ª
Nombre: PABLO MARTÍNEZ LÓPEZ
Fecha de nacimiento: 8 de agosto de 2012
Lugar de nacimiento: Valencia
Padre: JAVIER MARTÍNEZ RUIZ
Madre: ELENA LÓPEZ SANZ
Observaciones: ninguna
Valencia, 4 de octubre de 2026
[Sello]
El Encargado del Registro Civil`,
    keyTerms: ['Certificación literal de nacimiento', 'Encargado del Registro Civil'],
  },
  {
    id: 'es-divorcio',
    country: 'ES',
    category: 'divorce',
    source: 'es',
    targets: ['pt'],
    text: `JUZGADO DE PRIMERA INSTANCIA N.º 5 DE BARCELONA (FICTICIO)
Procedimiento: Divorcio de mutuo acuerdo 123/2026
SENTENCIA N.º 456/2026
FALLO: Se decreta la disolución por divorcio del matrimonio contraído por D. JORDI PUIG y D.ª MARTA VIDAL el 3 de mayo de 2008, con todos los efectos legales.
Se aprueba el convenio regulador presentado por las partes.
Firme esta resolución, comuníquese al Registro Civil para su inscripción.
Barcelona, 15 de junio de 2026
[Firma]`,
    keyTerms: ['Juzgado de Primera Instancia', 'Divorcio de mutuo acuerdo', 'Convenio regulador'],
  },
  {
    id: 'es-poder',
    country: 'ES',
    category: 'power_of_attorney',
    source: 'es',
    targets: ['pt'],
    text: `ESCRITURA DE PODER ESPECIAL
NÚMERO MIL DOSCIENTOS TREINTA Y CUATRO (1.234)
En Madrid, a 6 de octubre de 2026.
Ante mí, ÁLVARO SANZ (FICTICIO), Notario del Ilustre Colegio de Madrid,
COMPARECE: D.ª ISABEL MORENO, mayor de edad, con DNI 11111111-H, en calidad de poderdante,
y OTORGA poder especial a favor de D. RAÚL MORENO, apoderado, para que en su nombre solicite y retire documentos en el Consulado General de Brasil.
Leída esta escritura, la otorgante la firma conmigo, el Notario, de todo lo cual doy fe.
[Firma]`,
    keyTerms: ['Escritura de poder', 'Poder especial', 'Ante mí', 'Notario', 'Poderdante', 'Apoderado'],
  },
  {
    id: 'es-certificado-medico',
    country: 'ES',
    category: 'medical_certificate',
    source: 'es',
    targets: ['pt'],
    text: `CONSEJO GENERAL DE COLEGIOS OFICIALES DE MÉDICOS
CERTIFICADO MÉDICO OFICIAL
El médico que suscribe, Dr. CARLOS NAVARRO (FICTICIO), colegiado n.º 28/123456,
CERTIFICA: que D.ª ANA TORRES, de 45 años de edad, reconocida en el día de hoy, no padece enfermedad infectocontagiosa ni impedimento físico o psíquico para el ejercicio de su actividad.
Y para que conste, firmo el presente en Madrid, a 7 de octubre de 2026.
[Firma]`,
    keyTerms: ['Certificado médico oficial'],
  },
  {
    id: 'es-colegiacion',
    country: 'ES',
    category: 'professional_certificate',
    source: 'es',
    targets: ['pt'],
    text: `ILUSTRE COLEGIO OFICIAL DE MÉDICOS DE MADRID (FICTICIO)
CERTIFICADO DE COLEGIACIÓN
D. LUIS ORTEGA, Secretario General del Colegio Oficial de Médicos de Madrid,
CERTIFICA: que D.ª PAULA REYES, con DNI 22222222-J, figura inscrita en este Colegio con el número 28/654321 desde el 1 de marzo de 2015, en situación de ejerciente, sin que conste sanción disciplinaria alguna.
Madrid, 9 de octubre de 2026
[Sello]`,
    keyTerms: ['Colegio Oficial de Médicos', 'Certificado de colegiación'],
  },
  {
    id: 'es-programa',
    country: 'ES',
    category: 'syllabus',
    source: 'es',
    targets: ['pt'],
    text: `UNIVERSIDAD FICTICIA DE SALAMANCA
GUÍA DOCENTE
PROGRAMA DE LA ASIGNATURA
Asignatura: Anatomía Humana I
Créditos ECTS: 9
Requisitos previos: ninguno
Contenidos: osteología, artrología, miología y anatomía topográfica del aparato locomotor.
Sistema de evaluación: examen teórico (60 %) y examen práctico (40 %).
Bibliografía básica: ROUVIÈRE, H. Anatomía humana. 11.ª ed. Barcelona: Elsevier, 2005.`,
    keyTerms: ['Guía docente', 'Programa de la asignatura', 'Requisitos previos'],
  },
];

/**
 * Bateria de validação: documentos escritos à parte, com outras redações e outros órgãos, que não foram usados para
 * ajustar o glossário nem as regras. Mede se o sistema acerta o que ainda não viu.
 */
export const BENCHMARK_HOLDOUT: BenchmarkSample[] = [
  {
    id: 'v-br-certidao-justica-federal',
    country: 'BR',
    category: 'criminal_record',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `PODER JUDICIÁRIO
JUSTIÇA FEDERAL DA 3ª REGIÃO – FICTÍCIA
CERTIDÃO JUDICIAL CRIMINAL NEGATIVA
Certidão nº 2026.000123456 – FICTÍCIA
CERTIFICAMOS que, pesquisando os registros de distribuição de ações criminais, NADA CONSTA contra:
Nome: PAULO HENRIQUE TESTE FICTÍCIO
CPF: 123.456.789-00
A presente certidão é expedida gratuitamente e tem validade de 30 (trinta) dias.
Certidão emitida em 21/10/2026.
Código de Validação: JF3-9988-7766`,
    keyTerms: ['Certidão Judicial Criminal Negativa', 'Nada consta', 'CPF', 'Certidão emitida', 'Código de Validação'],
  },
  {
    id: 'v-br-atestado-policia-civil',
    country: 'BR',
    category: 'criminal_record',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `SECRETARIA DA SEGURANÇA PÚBLICA
POLÍCIA CIVIL DO ESTADO DE SÃO PAULO – FICTÍCIA
INSTITUTO DE IDENTIFICAÇÃO RICARDO GUMBLETON DAUNT
ATESTADO DE ANTECEDENTES CRIMINAIS
Atestamos, para fins de comprovação junto a órgão estrangeiro, que, consultados os arquivos deste Instituto de Identificação, NADA CONSTA em nome de:
Nome: RENATA CAMPOS FICTÍCIA
RG: 12.345.678-9
Data de nascimento: 15/08/1993
Este atestado é válido por 90 (noventa) dias a contar da data de emissão.
Emitido em 18/10/2026.`,
    keyTerms: ['Atestado de Antecedentes Criminais', 'Instituto de Identificação', 'Nada consta'],
  },
  {
    id: 'v-br-cnn-requerimento',
    country: 'BR',
    category: 'naturalization_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `MINISTÉRIO DA JUSTIÇA E SEGURANÇA PÚBLICA
SECRETARIA NACIONAL DE JUSTIÇA
DEPARTAMENTO DE MIGRAÇÕES
DIVISÃO DE NACIONALIDADE E NATURALIZAÇÃO
CERTIDÃO
Certifico que, revendo os assentamentos deste Departamento de Migrações, não consta registro de naturalização brasileira em nome de ANGELO FERRARI FICTÍCIO, filho de LUIGI FERRARI e TERESA COLOMBO, nascido em Padova, Itália, em 02/09/1899.
Certidão Negativa de Naturalização expedida a pedido da parte interessada, para fins de reconhecimento de cidadania italiana.
Brasília, 20 de outubro de 2026.
Código de Validação: MJ-CNN-2026-5566`,
    keyTerms: [
      'Ministério da Justiça e Segurança Pública',
      'Secretaria Nacional de Justiça',
      'Departamento de Migrações',
      'Não consta',
      'naturalização brasileira',
      'Certidão Negativa de Naturalização',
      'Código de Validação',
    ],
  },
  {
    id: 'v-br-atestado-aptidao',
    country: 'BR',
    category: 'medical_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `HOSPITAL FICTÍCIO DE CLÍNICAS
ATESTADO DE SAÚDE
Atesto que a Sra. CAROLINA DIAS FICTÍCIA, CPF 987.654.321-00, foi por mim examinada em 16/10/2026 e encontra-se em boas condições de saúde física e mental, apta para o trabalho e para viagens internacionais.
Porto Alegre, 16 de outubro de 2026.
[Assinatura]
Dr. FERNANDO LOPES FICTÍCIO
CRM-RS 54321`,
    keyTerms: ['CPF'],
  },
  {
    id: 'v-br-cro',
    country: 'BR',
    category: 'professional_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `CONSELHO REGIONAL DE ODONTOLOGIA DE MINAS GERAIS – FICTÍCIO
CERTIDÃO DE REGULARIDADE
Certificamos que a cirurgiã-dentista LARISSA FONSECA FICTÍCIA encontra-se inscrita neste Conselho sob o nº CRO-MG 45.678, com inscrição principal ativa desde 05/03/2016, sem débitos e sem processo ético em andamento.
Certidão emitida em 19/10/2026, válida por 60 (sessenta) dias.
Código de Validação: CROMG-2026-1122`,
    keyTerms: ['Certidão de Regularidade', 'Certidão emitida', 'Código de Validação'],
  },
  {
    id: 'v-br-homologacao-divorcio',
    country: 'BR',
    category: 'divorce',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `PODER JUDICIÁRIO DO ESTADO DO RIO DE JANEIRO – FICTÍCIO
1ª VARA DE FAMÍLIA DA COMARCA DA CAPITAL
Processo nº 0012345-67.2026.8.19.0001
Ação: Divórcio Consensual
Requerentes: TIAGO BARROS FICTÍCIO e JULIANA BARROS FICTÍCIA
SENTENÇA
HOMOLOGO o acordo celebrado entre as partes e DECRETO o divórcio do casal, para que produza seus jurídicos e legais efeitos. A partilha de bens observará o acordo de fls. 25/27. A requerente voltará a usar o nome de solteira JULIANA ROCHA FICTÍCIA.
Transitada em julgado, expeça-se mandado de averbação.
Rio de Janeiro, 12 de março de 2026.
[Assinatura eletrônica]
Juíza de Direito`,
    keyTerms: ['Divórcio Consensual', 'Partilha de bens', 'nome de solteira', 'Averbação'],
  },
  {
    id: 'v-br-substabelecimento',
    country: 'BR',
    category: 'power_of_attorney',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `SUBSTABELECIMENTO
Pelo presente instrumento, MARCOS VIEIRA FICTÍCIO, advogado inscrito na Ordem dos Advogados do Brasil sob o nº 123.456, substabelece, com reserva de poderes, na pessoa de ALINE COSTA FICTÍCIA, advogada inscrita na Ordem dos Advogados do Brasil sob o nº 654.321, os poderes que lhe foram conferidos por SILVIA RAMOS FICTÍCIA na procuração datada de 01/09/2026.
São Paulo, 15 de outubro de 2026.
[Assinatura]`,
    keyTerms: ['Substabelecimento', 'Ordem dos Advogados do Brasil', 'com reserva de poderes', 'Procuração'],
  },
  {
    id: 'v-br-ementa-disciplina',
    country: 'BR',
    category: 'syllabus',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `FACULDADE DE DIREITO FICTÍCIA
EMENTA DA DISCIPLINA
Disciplina: Direito Civil I – Parte Geral
Carga Horária: 72 horas
Ementa: Pessoa natural e pessoa jurídica. Domicílio. Bens. Fatos e negócios jurídicos. Prescrição e decadência.
Bibliografia Básica: GONÇALVES, C. R. Direito civil brasileiro. Vol. 1. 20. ed. São Paulo: Saraiva, 2022.`,
    keyTerms: ['Disciplina', 'Carga Horária', 'Ementa', 'Bibliografia Básica'],
  },
  {
    id: 'v-br-casamento-breve',
    country: 'BR',
    category: 'marriage_certificate',
    source: 'pt',
    targets: FROM_BRAZIL,
    text: `REPÚBLICA FEDERATIVA DO BRASIL
REGISTRO CIVIL DAS PESSOAS NATURAIS
CERTIDÃO DE CASAMENTO
Matrícula: 112233 01 55 2019 2 00031 101 0012233 44
Nomes dos cônjuges: DIEGO RAMOS FICTÍCIO e PRISCILA NUNES FICTÍCIA
Regime de bens: regime de separação total de bens
Averbações: não consta.
O conteúdo é verdadeiro. Dou fé.
Oficial de Registro Civil`,
    keyTerms: [
      'Registro Civil das Pessoas Naturais',
      'Certidão de Casamento',
      'Matrícula',
      'regime de separação total de bens',
      'Averbações',
      'Não consta',
      'Dou fé',
      'Oficial de Registro Civil',
    ],
  },
  {
    id: 'v-us-ny-divorce',
    country: 'US',
    category: 'divorce',
    source: 'en',
    targets: ['pt'],
    text: `SUPREME COURT OF THE STATE OF NEW YORK, COUNTY OF KINGS
Index No. 12345/2026 (FICTITIOUS)
Plaintiff: MARIA SAMPLE
Defendant: CARLOS SAMPLE
JUDGMENT OF DIVORCE
ORDERED AND ADJUDGED that the marriage between the plaintiff and the defendant is dissolved by reason of the irretrievable breakdown of the relationship for a period of at least six months.
Entered: April 8, 2026
[Seal]
County Clerk`,
    keyTerms: ['Judgment of Divorce', 'Plaintiff', 'Defendant', 'County Clerk'],
  },
  {
    id: 'v-us-state-police',
    country: 'US',
    category: 'criminal_record',
    source: 'en',
    targets: ['pt'],
    text: `TEXAS DEPARTMENT OF PUBLIC SAFETY (FICTITIOUS)
CRIMINAL HISTORY RECORD INFORMATION
CRIMINAL BACKGROUND CHECK
Name searched: DANIEL SAMPLE
Date of birth: 02/17/1980
Result: No criminal history record found.
Date of search: 10/11/2026
[Seal]`,
    keyTerms: [],
  },
  {
    id: 'v-us-specific-poa',
    country: 'US',
    category: 'power_of_attorney',
    source: 'en',
    targets: ['pt'],
    text: `SPECIAL POWER OF ATTORNEY
KNOW ALL PERSONS BY THESE PRESENTS that I, KAREN SAMPLE (FICTITIOUS), do hereby appoint THOMAS SAMPLE as my true and lawful Attorney-in-Fact to apply for and obtain Brazilian civil registry certificates on my behalf.
In witness whereof, I have signed this instrument on September 3, 2026.
[Signature]
Notary Public, State of New Jersey`,
    keyTerms: ['Power of Attorney', 'Attorney-in-Fact', 'Notary Public'],
  },
  {
    id: 'v-uk-dbs',
    country: 'UK',
    category: 'criminal_record',
    source: 'en',
    targets: ['pt'],
    text: `DISCLOSURE AND BARRING SERVICE
BASIC CERTIFICATE
Certificate number: 001234567890 (FICTITIOUS)
Applicant name: SOPHIE SAMPLE
Date of birth: 22/01/1991
Date of issue: 13 October 2026
Police records of convictions: NONE RECORDED
[Seal]`,
    keyTerms: ['Disclosure and Barring Service'],
  },
  {
    id: 'v-uk-birth',
    country: 'UK',
    category: 'birth_certificate',
    source: 'en',
    targets: ['pt'],
    text: `CERTIFIED COPY OF AN ENTRY OF BIRTH
GENERAL REGISTER OFFICE (FICTITIOUS)
Registration district: Westminster
1. Date and place of birth: 4 March 2018, London
2. Name and surname: ARTHUR SAMPLE
3. Sex: Male
4. Name and surname of father: JAMES SAMPLE
5. Name and surname of mother: ISLA SAMPLE
Signature of registrar: [Signature]
CAUTION: THERE ARE OFFENCES RELATING TO FALSIFYING OR ALTERING A CERTIFICATE`,
    keyTerms: ['Certified Copy of an Entry of Birth', 'General Register Office'],
  },
  {
    id: 'v-fr-mariage',
    country: 'FR',
    category: 'marriage_certificate',
    source: 'fr',
    targets: ['pt'],
    text: `RÉPUBLIQUE FRANÇAISE
ACTE DE MARIAGE
EXTRAIT AVEC FILIATION
Le 14 juin 2014, à Lyon, ont contracté mariage : Thomas BERNARD (FICTIF), né le 2 mai 1986 à Lyon, et Chloé MARTIN (FICTIVE), née le 9 août 1988 à Grenoble.
Mentions marginales : divorcés par jugement du tribunal judiciaire de Lyon du 10 janvier 2025.
Délivré par l'officier de l'état civil, le 1er octobre 2026.`,
    keyTerms: ['Acte de mariage', 'Extrait avec filiation', 'Mentions marginales', 'Tribunal judiciaire', "Officier de l'état civil"],
  },
  {
    id: 'v-fr-attestation-medecin',
    country: 'FR',
    category: 'medical_certificate',
    source: 'fr',
    targets: ['pt'],
    text: `CERTIFICAT MÉDICAL DE NON CONTRE-INDICATION
Je soussignée, Docteure Anne ROUX (FICTIVE), certifie avoir examiné Monsieur Hugo FAURE, né le 12 décembre 1995, et n'avoir constaté aucune contre-indication à la pratique du sport.
Fait à Nice, le 9 octobre 2026.
[Signature]`,
    keyTerms: ['Certificat médical'],
  },
  {
    id: 'v-it-casellario-carichi',
    country: 'IT',
    category: 'criminal_record',
    source: 'it',
    targets: ['pt'],
    text: `PROCURA DELLA REPUBBLICA PRESSO IL TRIBUNALE DI NAPOLI (FITTIZIO)
CERTIFICATO DEI CARICHI PENDENTI
Si certifica che a carico di ESPOSITO GENNARO, nato a Napoli il 10/10/1975, risulta: NULLA.
Napoli, 7 ottobre 2026
[Timbro]
Il Funzionario`,
    keyTerms: ['Procura della Repubblica', 'Certificato dei Carichi Pendenti'],
  },
  {
    id: 'v-it-matrimonio',
    country: 'IT',
    category: 'marriage_certificate',
    source: 'it',
    targets: ['pt'],
    text: `COMUNE DI VENEZIA (FITTIZIO)
ESTRATTO PER RIASSUNTO DELL'ATTO DI MATRIMONIO
Anno 2011, Parte I, Numero 88
Gli sposi: GALLO DAVIDE e CONTI SARA hanno contratto matrimonio in Venezia il 24 settembre 2011.
Annotazioni: con sentenza del Tribunale Ordinario di Venezia, passata in giudicato il 3 marzo 2024, è stata dichiarata la cessazione degli effetti civili del matrimonio.
Venezia, 2 ottobre 2026
L'Ufficiale dello Stato Civile`,
    keyTerms: [
      'Atto di matrimonio',
      'Tribunale Ordinario',
      'passata in giudicato',
      'Cessazione degli effetti civili del matrimonio',
      'Ufficiale dello Stato Civile',
    ],
  },
  {
    id: 'v-es-poder-general',
    country: 'ES',
    category: 'power_of_attorney',
    source: 'es',
    targets: ['pt'],
    text: `PODER GENERAL PARA PLEITOS
En Sevilla, a 2 de octubre de 2026.
Ante mí, MERCEDES GIL (FICTICIA), Notario del Ilustre Colegio de Andalucía,
comparece D. ANTONIO DÍAZ, poderdante, quien otorga poder general a favor de D.ª ROSA DÍAZ, apoderada, para que le represente ante cualesquiera juzgados y tribunales.
Doy fe.
[Firma]`,
    keyTerms: ['Poder general', 'Ante mí', 'Notario', 'Poderdante', 'Apoderado'],
  },
  {
    id: 'v-es-defuncion',
    country: 'ES',
    category: 'death_certificate',
    source: 'es',
    targets: ['pt'],
    text: `REGISTRO CIVIL DE ZARAGOZA (FICTICIO)
CERTIFICADO DE DEFUNCIÓN
Nombre: JOSÉ RUIZ PÉREZ
Fecha de defunción: 11 de mayo de 2021
Lugar de defunción: Zaragoza
Zaragoza, 6 de octubre de 2026
[Sello]
El Encargado del Registro Civil`,
    keyTerms: ['Certificado de defunción', 'Encargado del Registro Civil'],
  },
];
