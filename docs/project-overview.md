# Visão do projeto

## Propósito

Construir uma aplicação web em que pessoas autorizadas possam enviar documentos, escolher idiomas, acompanhar tarefas de tradução e baixar arquivos reconstruídos com a formatação original preservada tanto quanto os formatos suportarem.

## Usuários e acesso previstos

- **Diretor:** administra a organização, aprova cadastros, atribui funções e direciona para as equipes os lotes que envia.
- **Líder:** administra somente equipes, pessoas e recursos delegados; os lotes que envia vão direto para a própria equipe.
- **Operador:** trabalha com todos os documentos da sua equipe (ver, baixar e, nas próximas fases, traduzir); não cria lotes.
- **Cadastro pendente:** não tem acesso interno até aprovação.

O servidor deverá verificar permissões por ação e por objeto, sempre considerando proprietário e equipe. Essa hierarquia é requisito de produto, não funcionalidade já implementada.

## Escopo do MVP

- Cadastro pendente, autenticação, hierarquia de funções, equipes e auditoria.
- Upload e histórico com lotes de até 100 arquivos e estado individual por documento.
- Fila persistente, retomada, idempotência, retentativas limitadas e cancelamento.
- Tradução com origem selecionável ou detecção opcional, destino obrigatório e provedor adaptável.
- Formatos-alvo: DOCX, PDF digital, PDF digitalizado, JPG/JPEG, PNG e PPTX.
- OCR local e conversão documental no worker; arquivos privados e falhas recuperáveis.

Fidelidade visual perfeita, aplicação móvel, Kubernetes, edição colaborativa, documentos corrompidos/protegidos e tradução totalmente offline estão fora do primeiro lançamento.

## Fluxo de trabalho desejado

1. Uma pessoa autenticada cria um lote e envia arquivos.
2. A API valida limites, formato, tamanho e permissão; registra lote e itens.
3. Os arquivos originais são salvos em armazenamento privado e os trabalhos ficam persistidos.
4. Um worker extrai conteúdo, traduz segmentos pelo provedor configurado e reconstrói o formato.
5. O sistema salva resultado e avisos, atualiza o estado do item e registra eventos de auditoria.
6. A pessoa autorizada consulta o histórico e baixa o resultado.

Cada etapa deve ter estado e erro próprios. Uma falha de OCR não deve parecer falha de tradução; uma resposta parcial do provedor não pode marcar o documento como concluído.

## Princípios

- Monólito modular em TypeScript, com contratos explícitos entre módulos.
- Validar toda entrada na fronteira; regras de negócio não ficam nos controladores HTTP.
- Documentos e credenciais não entram no Git nem nos logs.
- OCR, extração e reconstrução locais; tradução externa apenas quando habilitada e configurada.
- Persistir estados e checkpoints antes de alegar que uma tarefa é recuperável.
- Declarar limitações de cada formato e orientar revisão quando a fidelidade não puder ser garantida.
