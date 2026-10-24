# ADR-030 — Tipos documentais e isolamento das tentativas de processamento

- Estado: Accepted
- Data: 2026-10-24
- Relacionadas: [ADR-019](019-sworn-layout-models.md), [ADR-025](025-operational-document-flow.md), [ADR-028](028-pattern-trial-reviews.md)

## Contexto

Etiquetas e títulos traduzidos não agrupam o mesmo tipo entre idiomas de forma estável. Em processamento concorrente, identificar uma tentativa apenas pelo nome do worker permitia que uma execução antiga reaproveitasse a posse de outra execução iniciada pelo mesmo worker. A publicação de auditoria e falhas fora da transação também podia produzir registros de resultados descartados.

## Decisão

Os 12 modelos de corpo existentes formam um catálogo canônico de tipos, separado de etiquetas livres e do campo textual `documentType`. A remessa pode escolher um tipo para orientar o modelo; sem escolha, título e primeiras oito linhas alimentam as regras multilíngues já existentes. As sugestões expõem origem da evidência e força heurística: 95 para título com uma regra, 80 para título ambíguo, 70 para indicação nas primeiras linhas e zero para tipo inconclusivo. Essas pontuações não são probabilidades estatísticas. Tipo desconhecido permanece como documento geral e exige a conferência habitual.

Uma escolha humana prevalece sobre a sugestão automática. Correções posteriores registram pessoa, motivo e tipo anterior/novo na auditoria. Documentos prontos ou concluídos exigem confirmação explícita. A correção organiza a pesquisa e orienta a próxima geração; preserva o Word já conferido ou emitido. A API oferece catálogo, filtro canônico e facetas com contagens dentro do escopo de acesso. O ensaio de novos formatos aceita a mesma escolha de modelo. A classificação não depende de IA.

Cada reserva da fila recebe um token aleatório exclusivo, além do identificador do worker. Renovação do lease, publicação do rascunho, nova tentativa e falha terminal verificam esse token e o estado `processing`. Rascunho, classificação, auditorias e avisos são publicados na mesma transação. Um resultado que perdeu a reserva não publica efeitos. Falhas transitórias mantêm espera progressiva e registram `translation.retry_scheduled`, com tentativa, causa e intervalo. O cache de modelos aprendidos fica separado por conexão de banco.

A migração 0030 classifica títulos legados sem alterar suas emissões. Qualquer revisão nova, inclusive de um documento legado, passa a exigir inspeção da revisão atual. Novas traduções de um documento herdam também a opção de máscara da remessa, evitando mudar o fluxo ao acrescentar outro idioma.

## Verificação e limites

`scale-classification.integration.test.ts` cobre seleção, sugestão, filtros, confirmação, auditoria, preservação do Word, ensaio com modelo explícito, herança entre pares, 30 documentos com seis workers concorrentes, reserva retomada com mesmo identificador, falha antiga descartada, nova tentativa sem rascunho parcial e conferência de uma nova revisão legada. Os testes de concorrência usam um provedor determinístico; não constituem uma medição de capacidade do LibreTranslate, OCR ou conversor em produção. `document-category.test.ts` e `knowledge.test.ts` verificam regras e isolamento do cache. Os testes reais multilíngues existentes continuam disponíveis separadamente.
