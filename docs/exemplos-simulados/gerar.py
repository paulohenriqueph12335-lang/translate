"""Gera os documentos simulados (fictícios) usados para testar tradução, diagramação, revisão e entrega.

Seis tipos, três exemplos de cada: certidão de nascimento, CIN (Carteira de Identidade Nacional), CNH, fatura de
cartão, certidão de conselho de medicina e apostila. Tudo é inventado: nomes, números, órgãos e endereços. Cada página
traz a marca d'água "DOCUMENTO FICTÍCIO – MODELO DE TESTE" e os números seguem padrões inválidos de propósito
(CPF 000.xxx.xxx-00, cartão 0000 ...). Rode com `python gerar.py` (precisa de reportlab) nesta pasta.
"""

import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'originais')
W, H = A4

title = ParagraphStyle('t', fontName='Helvetica-Bold', fontSize=13, alignment=1, spaceAfter=4)
subtitle = ParagraphStyle('s', fontName='Helvetica-Bold', fontSize=10, alignment=1, spaceAfter=2)
body = ParagraphStyle('b', fontName='Helvetica', fontSize=9.5, leading=13, alignment=4)
small = ParagraphStyle('sm', fontName='Helvetica', fontSize=7.5, leading=9, alignment=1, textColor=colors.HexColor('#444444'))
center = ParagraphStyle('c', fontName='Helvetica', fontSize=9.5, alignment=1)
GRID = TableStyle(
    [
        ('GRID', (0, 0), (-1, -1), 0.6, colors.black),
        ('FONT', (0, 0), (-1, -1), 'Helvetica', 8.5),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8e8e8')),
        ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 8.5),
    ]
)
LABELS = TableStyle(
    [
        ('GRID', (0, 0), (-1, -1), 0.6, colors.black),
        ('FONT', (0, 0), (0, -1), 'Helvetica-Bold', 8.5),
        ('FONT', (1, 0), (-1, -1), 'Helvetica', 8.5),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]
)


def watermark(canvas, _doc):
    canvas.saveState()
    canvas.setFont('Helvetica-Bold', 34)
    canvas.setFillColor(colors.Color(0.75, 0.1, 0.1, alpha=0.18))
    canvas.translate(W / 2, H / 2)
    canvas.rotate(35)
    canvas.drawCentredString(0, 0, 'DOCUMENTO FICTÍCIO – MODELO DE TESTE')
    canvas.restoreState()
    canvas.saveState()
    canvas.setFont('Helvetica', 7)
    canvas.drawCentredString(W / 2, 12 * mm, 'Documento simulado para testes do sistema de tradução. Sem validade jurídica.')
    canvas.restoreState()


def emblem(label='BRASÃO'):
    """Brasão desenhado como círculo com rótulo (vira marcador [Brasão] na tradução)."""
    t = Table([[label]], colWidths=[22 * mm], rowHeights=[22 * mm])
    t.setStyle(TableStyle([('FONT', (0, 0), (-1, -1), 'Helvetica', 6), ('ALIGN', (0, 0), (-1, -1), 'CENTER'), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))
    return t


def build(name, story):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=16 * mm, bottomMargin=20 * mm, title=name)
    doc.build(story, onFirstPage=watermark, onLaterPages=watermark)
    return path


def labels(rows, widths=(55 * mm, 115 * mm)):
    t = Table(rows, colWidths=list(widths))
    t.setStyle(LABELS)
    return t


def signature(name, role):
    return [Spacer(1, 10 * mm), Paragraph('_______________________________________', center), Paragraph(name, center), Paragraph(role, small)]


# ---------- Dados inventados ----------

PEOPLE = [
    dict(nome='MARIANA ALVES TEIXEIRA', pai='ROBERTO TEIXEIRA NUNES', mae='LUCIANA ALVES TEIXEIRA', nasc='14/03/2006', hora='08h35',
         local='Hospital Municipal Santa Clara', cidade='Vila Esperança', uf='EF', cpf='000.123.456-00', rg='00.123.456-0', sexo='Feminino',
         avop='JOSÉ NUNES e MARIA TEIXEIRA', avom='PEDRO ALVES e ANA ALVES'),
    dict(nome='LUCAS FERREIRA DOMINGUES', pai='ANDRÉ DOMINGUES COSTA', mae='PATRÍCIA FERREIRA DOMINGUES', nasc='02/11/1998', hora='22h10',
         local='Maternidade São Lucas', cidade='Porto Aurora', uf='PA', cpf='000.987.654-00', rg='00.987.654-1', sexo='Masculino',
         avop='CARLOS COSTA e IRENE DOMINGUES', avom='PAULO FERREIRA e LÍDIA FERREIRA'),
    dict(nome='BEATRIZ SOUZA MONTEIRO', pai='FERNANDO MONTEIRO LIMA', mae='CAROLINA SOUZA MONTEIRO', nasc='27/07/2011', hora='14h50',
         local='Hospital Regional do Vale', cidade='Serra Clara', uf='SC', cpf='000.555.222-00', rg='00.555.222-3', sexo='Feminino',
         avop='JOÃO LIMA e ROSA MONTEIRO', avom='ANTÔNIO SOUZA e HELENA SOUZA'),
]


def certidao(i, p):
    story = [
        emblem(),
        Paragraph('REPÚBLICA FICTÍCIA DO BRASIL', subtitle),
        Paragraph('REGISTRO CIVIL DAS PESSOAS NATURAIS', subtitle),
        Paragraph('CERTIDÃO DE NASCIMENTO', title),
        Paragraph(f'Cartório do 1º Ofício de Registro Civil de {p["cidade"]} – {p["uf"]}', center),
        Spacer(1, 4 * mm),
        Paragraph('NOME', subtitle),
        Paragraph(p['nome'], center),
        Paragraph(f'Matrícula: 000000 01 55 {2000 + i} 1 00012 {100 + i} 0000000-0{i}', small),
        Spacer(1, 3 * mm),
        labels(
            [
                ['Data de nascimento', p['nasc']],
                ['Hora', p['hora']],
                ['Local de nascimento', f'{p["local"]}, {p["cidade"]} – {p["uf"]}'],
                ['Sexo', p['sexo']],
                ['Filiação', f'{p["pai"]} e {p["mae"]}'],
                ['Avós paternos', p['avop']],
                ['Avós maternos', p['avom']],
                ['Data do registro', f'0{i + 1}/0{i + 4}/20{20 + i}'],
            ]
        ),
        Spacer(1, 4 * mm),
        Paragraph(
            'Certifico que a presente certidão reproduz fielmente os dados constantes do registro de nascimento lavrado neste '
            'cartório, no livro A-012, folha 0' + str(45 + i) + ', sob o termo nº 0' + str(1200 + i) + '. O referido é verdade e dou fé.',
            body,
        ),
        Spacer(1, 3 * mm),
        Paragraph('Averbações e anotações: não há.', body),
        Paragraph(f'{p["cidade"]}, 1{i} de dezembro de 2025.', center),
        *signature('ANA PAULA REGO FICTÍCIA', 'Oficial de Registro Civil – Escrevente Autorizada'),
        Spacer(1, 3 * mm),
        Paragraph('[CARIMBO] Cartório do 1º Ofício – Selo de fiscalização nº FIC-0000-' + str(1000 + i), small),
    ]
    return build(f'certidao-nascimento-{i + 1}.pdf', story)


def cin(i, p):
    story = [
        emblem(),
        Paragraph('REPÚBLICA FICTÍCIA DO BRASIL', subtitle),
        Paragraph('CARTEIRA DE IDENTIDADE NACIONAL', title),
        Paragraph('Instituto de Identificação do Estado Fictício', center),
        Spacer(1, 4 * mm),
        labels(
            [
                ['Nome', p['nome']],
                ['CPF', p['cpf']],
                ['Data de nascimento', p['nasc']],
                ['Naturalidade', f'{p["cidade"]}/{p["uf"]}'],
                ['Sexo', p['sexo']],
                ['Nacionalidade', 'Brasileira'],
                ['Filiação', f'{p["mae"]} / {p["pai"]}'],
                ['Órgão expedidor', f'SSP/{p["uf"]}'],
                ['Data de expedição', f'1{i}/0{i + 2}/2024'],
                ['Validade', f'1{i}/0{i + 2}/2034'],
                ['Registro geral (RG anterior)', p['rg']],
            ]
        ),
        Spacer(1, 4 * mm),
        Paragraph('Este documento é válido em todo o território nacional e tem fé pública. A assinatura do titular está no verso.', body),
        Paragraph('[QR CODE] Código de verificação: FIC-CIN-000' + str(i), small),
        *signature(p['nome'], 'Assinatura do titular'),
    ]
    return build(f'cin-{i + 1}.pdf', story)


def cnh(i, p):
    cats = ['B', 'AB', 'B'][i]
    story = [
        emblem(),
        Paragraph('REPÚBLICA FICTÍCIA DO BRASIL', subtitle),
        Paragraph('MINISTÉRIO FICTÍCIO DOS TRANSPORTES', subtitle),
        Paragraph('CARTEIRA NACIONAL DE HABILITAÇÃO', title),
        Paragraph('Departamento Estadual de Trânsito do Estado Fictício', center),
        Spacer(1, 4 * mm),
        labels(
            [
                ['Nome', p['nome']],
                ['Doc. identidade / Órg. emissor / UF', f'{p["rg"]} SSP {p["uf"]}'],
                ['CPF', p['cpf']],
                ['Data de nascimento', p['nasc']],
                ['Filiação', f'{p["pai"]}\n{p["mae"]}'],
                ['Permissão', '—'],
                ['Categoria', cats],
                ['Nº registro', f'0000{i}12345{i}'],
                ['Validade', f'0{i + 3}/0{i + 5}/2031'],
                ['1ª habilitação', f'1{i}/0{i + 1}/2019'],
                ['Observações', 'EAR – Exerce atividade remunerada' if i == 1 else 'A – Uso obrigatório de lentes corretivas'],
                ['Local de emissão', f'{p["cidade"]}, {p["uf"]}'],
                ['Data de emissão', f'0{i + 3}/0{i + 5}/2021'],
            ],
            widths=(65 * mm, 105 * mm),
        ),
        Spacer(1, 4 * mm),
        Paragraph('Documento de porte obrigatório ao conduzir veículo automotor. Válido como documento de identificação em todo o território nacional.', body),
        *signature('DIRETOR FICTÍCIO DO DETRAN', 'Assinatura do emissor'),
    ]
    return build(f'cnh-{i + 1}.pdf', story)


def fatura(i, p):
    compras = [
        [
            ['Data', 'Descrição', 'Cidade', 'Valor (R$)'],
            ['03/09', 'SUPERMERCADO BOM PREÇO', 'VILA ESPERANÇA', '412,37'],
            ['05/09', 'POSTO DE COMBUSTÍVEL ESTRELA', 'VILA ESPERANÇA', '238,90'],
            ['11/09', 'FARMÁCIA SAÚDE TOTAL', 'VILA ESPERANÇA', '87,45'],
            ['18/09', 'LIVRARIA LETRAS – PARC 02/05', 'PORTO AURORA', '129,98'],
            ['22/09', 'RESTAURANTE SABOR CASEIRO', 'VILA ESPERANÇA', '156,00'],
        ],
        [
            ['Data', 'Descrição', 'Cidade', 'Valor (R$)'],
            ['01/10', 'COMPANHIA AÉREA FICTÍCIA – PARC 01/10', 'PORTO AURORA', '1.249,90'],
            ['04/10', 'HOTEL MAR AZUL', 'SERRA CLARA', '980,00'],
            ['09/10', 'LOJA DE ELETRÔNICOS ALFA', 'PORTO AURORA', '2.399,00'],
            ['15/10', 'ASSINATURA DE STREAMING', 'INTERNET', '39,90'],
        ],
        [
            ['Data', 'Descrição', 'Cidade', 'Valor (R$)'],
            ['02/11', 'MERCADO VIZINHANÇA', 'SERRA CLARA', '98,76'],
            ['07/11', 'ACADEMIA CORPO EM FORMA', 'SERRA CLARA', '129,90'],
            ['13/11', 'PADARIA PÃO QUENTE', 'SERRA CLARA', '23,50'],
            ['20/11', 'ESCOLA DE IDIOMAS – PARC 03/12', 'SERRA CLARA', '310,00'],
            ['25/11', 'IOF COMPRA INTERNACIONAL', '—', '12,64'],
        ],
    ][i]
    total = ['1.024,70', '4.668,80', '574,80'][i]
    t = Table(compras, colWidths=[18 * mm, 80 * mm, 40 * mm, 32 * mm])
    t.setStyle(GRID)
    story = [
        Paragraph('BANCO FICTÍCIO S.A.', subtitle),
        Paragraph('FATURA DO CARTÃO DE CRÉDITO', title),
        Spacer(1, 3 * mm),
        labels(
            [
                ['Titular', p['nome']],
                ['Cartão', f'0000 •••• •••• 00{i}{i}'],
                ['Vencimento', ['10/10/2025', '10/11/2025', '10/12/2025'][i]],
                ['Valor total da fatura', f'R$ {total}'],
                ['Pagamento mínimo', ['R$ 153,71', 'R$ 700,32', 'R$ 86,22'][i]],
                ['Limite total', ['R$ 5.000,00', 'R$ 12.000,00', 'R$ 3.500,00'][i]],
            ]
        ),
        Spacer(1, 4 * mm),
        Paragraph('LANÇAMENTOS DO PERÍODO', subtitle),
        t,
        Spacer(1, 4 * mm),
        Paragraph(
            'Encargos em caso de atraso: multa de 2,00% sobre o valor em atraso e juros de mora de 1,00% ao mês. '
            'O pagamento de valor inferior ao mínimo caracteriza atraso. Juros do rotativo: 14,90% ao mês (CET anual de 427,91%).',
            body,
        ),
        Paragraph('Central de atendimento fictícia: 0000 000 0000. Pague pelo aplicativo ou em qualquer agência.', small),
    ]
    return build(f'fatura-cartao-{i + 1}.pdf', story)


def cfm(i, p):
    medicos = [
        ('DRA. HELENA CASTRO VIANA', '000123', 'Clínica Médica', '15/02/2012'),
        ('DR. RAFAEL MOURA TAVARES', '000456', 'Pediatria', '03/08/2015'),
        ('DRA. JULIANA PIRES ARAÚJO', '000789', 'Cardiologia', '21/05/2009'),
    ][i]
    story = [
        emblem('SÍMBOLO'),
        Paragraph('CONSELHO FICTÍCIO DE MEDICINA DO ESTADO FICTÍCIO', subtitle),
        Paragraph('CERTIDÃO DE INSCRIÇÃO E REGULARIDADE', title),
        Spacer(1, 4 * mm),
        Paragraph(
            f'O Conselho Fictício de Medicina certifica, para os devidos fins, que <b>{medicos[0]}</b> encontra-se inscrito(a) neste '
            f'Conselho sob o número CRM-FIC {medicos[1]}, desde {medicos[3]}, estando em situação regular, sem processo ético-profissional '
            'em andamento e quite com as anuidades até a presente data.',
            body,
        ),
        Spacer(1, 3 * mm),
        labels(
            [
                ['Inscrição', f'CRM-FIC {medicos[1]}'],
                ['Situação', 'Ativa – regular'],
                ['Especialidade registrada', medicos[2]],
                ['RQE', f'00{i + 1}{i + 2}'],
                ['Data da inscrição', medicos[3]],
            ]
        ),
        Spacer(1, 4 * mm),
        Paragraph('Esta certidão tem validade de 90 (noventa) dias a contar da data de emissão e pode ser verificada no portal fictício do Conselho.', body),
        Paragraph(f'Emitida em {["05/09/2025", "18/10/2025", "02/12/2025"][i]}. Código de autenticidade: FIC-{i}A2B-3C4D.', center),
        *signature('PRESIDENTE FICTÍCIO DO CONSELHO', 'Presidente'),
        Paragraph('[CARIMBO] Conselho Fictício de Medicina – Secretaria', small),
    ]
    return build(f'certidao-conselho-medicina-{i + 1}.pdf', story)


def apostila(i, p):
    docs = ['Certidão de Nascimento', 'Diploma de Graduação', 'Certidão de Casamento'][i]
    rows = [
        ['APOSTILLE', '(Convention de La Haye du 5 octobre 1961)'],
        ['1. País:', 'República Fictícia do Brasil'],
        ['O presente documento público', ''],
        ['2. foi assinado por', 'ANA PAULA REGO FICTÍCIA'],
        ['3. na qualidade de', 'Oficial de Registro Civil'],
        ['4. tem o selo/carimbo de', f'Cartório do 1º Ofício de {p["cidade"]}'],
        ['Reconhecido', ''],
        ['5. em', f'{p["cidade"]} – {p["uf"]}'],
        ['6. no dia', ['10/12/2025', '11/12/2025', '12/12/2025'][i]],
        ['7. por', 'Serventia Extrajudicial Fictícia'],
        ['8. sob o nº', f'FIC{i}2025000{4500 + i}'],
        ['9. Selo/carimbo', '[CARIMBO]'],
        ['10. Assinatura', '[ASSINATURA ELETRÔNICA]'],
    ]
    t = Table(rows, colWidths=[60 * mm, 110 * mm])
    t.setStyle(LABELS)
    story = [
        Paragraph('APOSTILA', title),
        Paragraph('Convenção sobre a Eliminação da Exigência de Legalização de Documentos Públicos Estrangeiros', center),
        Spacer(1, 4 * mm),
        t,
        Spacer(1, 4 * mm),
        Paragraph(f'Tipo de documento: {docs}. Nome do titular: {p["nome"]}.', body),
        Paragraph(
            'Esta Apostila apenas certifica a autenticidade da assinatura, a função ou cargo exercido pelo signatário do documento '
            'e, quando cabível, a autenticidade do selo ou carimbo aposto no documento. Ela não certifica o conteúdo do documento '
            'para o qual foi emitida.',
            body,
        ),
        Paragraph(f'Verifique em: verificacao-ficticia.exemplo/apostila – código FIC-AP-{i}9{i}8', small),
    ]
    return build(f'apostila-{i + 1}.pdf', story)


if __name__ == '__main__':
    made = []
    for i, person in enumerate(PEOPLE):
        for make in (certidao, cin, cnh, fatura, cfm, apostila):
            made.append(make(i, person))
    print(f'{len(made)} documentos em {OUT}')
