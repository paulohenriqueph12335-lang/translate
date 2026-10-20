"""Gera planilha-ficticia.pdf: lista técnica no formato de planilha exportada (ADR-013), com dados inventados.

Reproduz o que dificulta a leitura desses PDFs: recorte do tamanho da página (caminho sem desenho), bordas
desenhadas como retângulos finos preenchidos, linhas verticais só no cabeçalho, continuação da tabela na página
seguinte sem bordas verticais, e uma segunda seção curta. Rode com `python gerar.py` nesta pasta.
"""

import os

WIDTHS = [50, 110, 48, 24, 46, 86, 44, 53, 48, 48]
X0 = 18.5
XS = [X0]
for w in WIDTHS:
    XS.append(XS[-1] + w)
HEADERS = ['Vendors', 'Part No.', 'Size', 'SS/DS', 'Chip Brand', 'Chip NO.', 'Timing', 'Voltage']
ROW = 10.5
SIZE = 5.5

ROWS_1333 = [
    ['ACMEMEM', 'AC3U1333C2G9', '2GB', 'SS', 'ACMEMEM', '3CCD-1509HNA1126L', '9-9-9-24-33', '1.5V'],
    ['ACMEMEM', 'AC3U1333C2G9-BP', '2GB', 'SS', 'N/A', 'N/A', '9-9-9-24-33', '1.5V'],
    ['Brava', 'BR02GFA33C9NBGC', '2GB', 'DS', 'Brava', 'BM5D5808APQSBG', '9-9-9-24-33', '1.5V'],
    ['CORVO', 'CMX16GX3M2A1333C9(Ver7.21)', '8GB', 'DS', 'N/A', 'N/A', '9-9-9-24', '1.50V'],
    ['CORVO', 'TW3X4G1333C9D G', '4GB(2 x 2GB)', 'DS', 'N/A', 'N/A', '9-9-9-24', '1.50V'],
    ['DELTAX', 'DX3-10666CL8D(XMP)', '4GB(2 x 2GB)', 'DS', 'N/A', 'Heat-Sink Package', '8-8-8-24', 'XMP 1.35V'],
]
ROWS_1333_CONT = [
    ['DELTAX', 'DX3-1333C9D-16GSL', '8G', 'DS', 'N/A', 'Heat-Sink Package', '9-9-9-24', '1.35V'],
    ['Elmo', 'EL2P2G64CB8HC9N', '2GB', 'SS', 'Elmo', 'N2CB2G80GN-CG', '9-9-9-24-33', '1.5V'],
    ['FORTIS', 'FT1333D3N9/4G', '4GB', 'SS', 'KTC', 'D2568JENCNGD9U', '', '1.5V'],
    ['FORTIS', 'FT1333D3N9/4G-SP', '4GB', 'DS', 'FORTIS', 'D2568JENCPGD9U', '9-9-9-24-33', '1.5V'],
]
ROWS_1600 = [
    ['GALANT', 'GL3U1600C11-8G', '8GB', 'DS', 'N/A', 'N/A', '11-11-11-28', '1.50V'],
    ['HELIX', 'HX316C10F/8', '8GB', 'DS', 'HELIX', 'H5TQ4G83AFR', '10-10-10-27', '1.5V'],
]
NOTES = [
    ('1 DIMM', ': Supports one module inserted in any slot as Single-channel memory configuration'),
    ('2 DIMM', ': Supports 2 modules inserted into both the blue or black slots as two pairs of Dual-channel memory configuration'),
]

def esc(text):
    return text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')

def width(text, size):
    return len(text) * size * 0.52

class Page:
    def __init__(self):
        self.ops = ['q 18.96 57 556.32 729.7 re W n']  # recorte do tamanho da área útil, sem desenho

    def fill(self, x1, y1, x2, y2, gray=0.0):
        self.ops.append(f'{gray:.2f} g {x1:.2f} {y1:.2f} {x2 - x1:.2f} {y2 - y1:.2f} re f')

    def hline(self, y, x1=XS[0], x2=XS[-1]):
        self.fill(x1, y - 0.25, x2, y + 0.25)

    def vline(self, x, y1, y2):
        self.fill(x - 0.25, y1, x + 0.25, y2)

    def text(self, value, x, y, size=SIZE, bold=False):
        self.ops.append(f'0 g BT /{"F2" if bold else "F1"} {size} Tf {x:.2f} {y:.2f} Td ({esc(value)}) Tj ET')

    def centered(self, value, x1, x2, y, size=SIZE, bold=False):
        self.text(value, (x1 + x2) / 2 - width(value, size) / 2, y, size, bold)

    def stream(self):
        return ('\n'.join(self.ops) + '\nQ').encode('cp1252')

def section(page, top, title, rows, header=True):
    """Desenha título, cabeçalho de duas linhas e linhas de dados; devolve o y da base da tabela."""
    y = top
    if header:
        page.fill(XS[0], y - ROW, XS[-1], y, 0.85)
        page.centered(title, XS[1], XS[-1], y - ROW + 3, 7, True)
        page.hline(y)
        page.hline(y - ROW)
        page.vline(XS[0], y - ROW, y)
        page.vline(XS[-1], y - ROW, y)
        page.vline(XS[1], y - ROW, y)
        y -= ROW
        top2 = y
        page.fill(XS[0], y - 2 * ROW, XS[-1], y, 0.75)
        for index, name in enumerate(HEADERS):
            page.centered(name, XS[index], XS[index + 1], y - ROW - 3, SIZE, True)
        page.centered('DIMM socket support (Optional)', XS[8], XS[10], y - ROW / 2 - 2, SIZE, True)
        page.centered('1 DIMM', XS[8], XS[9], y - 2 * ROW + 3, SIZE, True)
        page.centered('2 DIMM', XS[9], XS[10], y - 2 * ROW + 3, SIZE, True)
        page.hline(y)
        page.hline(y - ROW, XS[8], XS[10])
        page.hline(y - 2 * ROW)
        for x in XS:
            page.vline(x, y - 2 * ROW, y) if x not in (XS[9],) else page.vline(x, y - 2 * ROW, y - ROW)
        y -= 2 * ROW
    for row in rows:
        for index, value in enumerate(row):
            if value:
                page.centered(value, XS[index], XS[index + 1], y - ROW + 3, SIZE, index == 0)
        page.centered('•', XS[8], XS[9], y - ROW + 3)
        page.centered('•', XS[9], XS[10], y - ROW + 3)
        y -= ROW
        page.hline(y)
    # Bordas externas dos dados; as verticais internas não existem (como na planilha exportada).
    page.vline(XS[0], y, top - (3 * ROW if header else 0))
    page.vline(XS[-1], y, top - (3 * ROW if header else 0))
    return y

page1 = Page()
section(page1, 786, 'DDR3 1333 Qualified Vendors List (QVL)', ROWS_1333)
page1.text('2 DIMM Slots', 270, 40, 6)

page2 = Page()
page2.hline(786)
bottom = section(page2, 786, '', ROWS_1333_CONT, header=False)
bottom = section(page2, bottom - 20, 'DDR3 1600 Qualified Vendors List (QVL)', ROWS_1600)
y = bottom - 30
for bold, rest in NOTES:
    page2.text('• ', XS[0], y, 7)
    page2.text(bold, XS[0] + 5, y, 7, True)
    page2.text(rest, XS[0] + 5 + width(bold, 7) + 1, y, 7)
    y -= 10
page2.text('*Supports Extreme Memory Profile (XMP)', XS[0], y - 8, 5)

objects = []
def add(body):
    objects.append(body)
    return len(objects)

catalog = add(b'')
pages = add(b'')
font1 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
font2 = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
kids = []
for page in (page1, page2):
    data = page.stream()
    content = add(b'<< /Length %d >>\nstream\n' % len(data) + data + b'\nendstream')
    kids.append(add(
        b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595.2 841.68] /Contents %d 0 R '
        b'/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> >>' % (pages, content, font1, font2)
    ))
objects[catalog - 1] = b'<< /Type /Catalog /Pages %d 0 R >>' % pages
objects[pages - 1] = b'<< /Type /Pages /Kids [%s] /Count %d >>' % (b' '.join(b'%d 0 R' % k for k in kids), len(kids))

out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
offsets = []
for number, body in enumerate(objects, start=1):
    offsets.append(len(out))
    out += b'%d 0 obj\n' % number + body + b'\nendobj\n'
xref = len(out)
out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
for offset in offsets:
    out += b'%010d 00000 n \n' % offset
out += b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, catalog, xref)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'planilha-ficticia.pdf')
with open(path, 'wb') as handle:
    handle.write(out)
print(path, len(out))
