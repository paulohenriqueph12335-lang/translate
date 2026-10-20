# Exemplos simulados

Documentos **fictícios** para testar tradução, diagramação, revisão e entrega de ponta a ponta no sistema
([ADR-016](../decisions/016-automatic-review.md)). Nomes, números, órgãos e endereços são inventados; cada página traz a
marca d'água "DOCUMENTO FICTÍCIO – MODELO DE TESTE" e os números seguem padrões inválidos de propósito.

| Pasta | Conteúdo |
| --- | --- |
| `originais/` | 18 PDFs: 3 de cada tipo, gerados por `gerar.py` |
| `traduzidos/` | O Word final de cada um, baixado do sistema depois da conclusão, com o nome da regra (`… - ENG.docx`, `…-FRA.docx`, `… - ITA.docx`, `… - ESP.docx`) |
| `mascara/` | A máscara simulada da tradutora fictícia Helena Duarte Fictícia (timbre, abertura, encerramento e marcadores) |
| `relatorio.json` | Por documento: modalidade, idioma, tempo de processamento, correções da revisão automática, problemas restantes, número emitido |
| `teste-carga.json` | Resultado do teste de carga |

## Tipos, modalidades e idiomas

| Documento | Modalidade | Exemplo 1 | Exemplo 2 | Exemplo 3 |
| --- | --- | --- | --- | --- |
| Certidão de nascimento | Juramentada | inglês | francês | italiano |
| CIN (Carteira de Identidade Nacional) | Juramentada | francês | italiano | espanhol |
| CNH | Juramentada | italiano | espanhol | inglês |
| Fatura de cartão | Simples, técnica, simples | espanhol | inglês | francês |
| Certidão de conselho de medicina (CFM) | Certificada | inglês | francês | italiano |
| Apostila | Juramentada | francês | italiano | espanhol |

As **juramentadas** saem na máscara simulada, numeradas pela regra de **número, livro e folha automáticos** (como a da
Patricia: 400 folhas por livro), com o livro 7 começando no número 1201. As **certificadas** terminam com a declaração do
tradutor; **técnica** e **simples** saem sem moldura nem numeração.

## Teste de carga (20/10/2026, máquina de desenvolvimento, Docker Desktop)

Subida gradual, parando antes de forçar a máquina (p95 acima de 1,5 s, 2% de erros ou um contêiner acima de 85% de
um núcleo). Leituras do dia a dia: lista de traduções, busca, detalhe, glossário, regras, notificações e filtros.

| Clientes simultâneos | Requisições/s | p50 | p95 | p99 | Erros | CPU API | CPU Postgres |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 47 | 19 ms | 34 ms | 66 ms | 0 | 44% | 34% |
| 2 | 75 | 24 ms | 44 ms | 59 ms | 0 | 95% | 58% |

- **Limite da API**: cerca de **75 requisições por segundo** por instância, com respostas rápidas (p95 de 44 ms). Uma
  pessoa usando a tela faz uma requisição a cada poucos segundos, o que dá folga para centenas de pessoas ao mesmo tempo.
  Acima disso, o gargalo é a CPU do processo da API (um núcleo); o caminho é subir mais de uma instância.
- **Gargalo encontrado e corrigido**: antes, o Postgres chegava a 100% de um núcleo com 45 requisições/s. A consulta das
  traduções juntava 12 tabelas e o banco gastava ~20 ms só **planejando** cada consulta (executar levava 3 ms). Com os
  nomes buscados por subconsulta, o planejamento caiu para 2–5 ms: +67% de vazão e p95 de 104 ms para 44 ms.
- **Fila**: 20 documentos enviados e armazenados em 0,6 s; traduzidos (LibreTranslate + revisão automática) em 194 s,
  **~10 s por documento, ~370 por hora com um worker**, sem falhas. O LibreTranslate usa ~1,5 núcleo nesse ritmo; o
  worker quase nada. Mais vazão: mais workers e mais núcleos para o tradutor (`TRANSLATOR_THREADS`).

## Como refazer

Com o Compose no ar e as contas de teste em `.credenciais-simulacao.json` (arquivo local, fora do Git):

```bash
python gerar.py
```

```bash
cd ../../packages/core && node --import tsx scripts/simular-documentos.ts
```

Cada execução cria novos lotes na equipe **Simulação** e consome números do livro 7.
