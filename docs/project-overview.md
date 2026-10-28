# Visão do projeto

Atualizado em 28/10/2026. O produto, os papéis e o tom estão em [PRODUCT.md](../PRODUCT.md). A interface está em [DESIGN.md](../DESIGN.md).

## Propósito

O Tradutor Documental é uma aplicação web para a operação de tradução de uma organização. Nela, as pessoas autorizadas:

- enviam documentos em remessas com protocolo;
- recebem um rascunho traduzido automaticamente, no layout do original;
- conferem o original e o Word lado a lado;
- concluem e baixam o Word e o PDF finais.

Na tradução juramentada, o Word final pode sair na máscara do tradutor juramentado, com número, livro e folha.

## Papéis

- **Diretor**:
  - administra a organização, aprova cadastros, cria equipes e direciona as remessas que envia;
  - decide pedidos de numeração e autoriza senhas novas com o Token do Diretor.
- **Líder (Supervisor)**:
  - gerencia as equipes que lidera, os tradutores juramentados e a numeração;
  - devolve traduções prontas;
  - libera por 24 horas o acesso de quem esqueceu a senha, com o Token do Líder.
- **Usuário**:
  - envia documentos e revisa os que estão com ele;
  - conclui a própria tradução (ADR-031).
- **Cadastro pendente**: não acessa nada até a aprovação de um Diretor.

O servidor verifica as permissões por ação e por objeto, sempre pela equipe e pelo responsável, em [`apps/api/src/modules/access/policy.ts`](../apps/api/src/modules/access/policy.ts).

## O que o sistema faz hoje

- **Entrada e contas**:
  - cadastro pendente e sessões revogáveis;
  - troca de senha e "Esqueci a senha";
  - primeiro Diretor criado com o Token do Diretor;
  - contas de teste.
- **Envio**:
  - remessas de até 100 arquivos, com protocolo ou justificativa, par de idiomas e modalidade (juramentada, certificada, técnica ou simples);
  - formatos aceitos: PDF digital ou digitalizado, DOCX, PPTX e imagens.
- **Processamento**:
  - fila no PostgreSQL;
  - OCR local, leitura do layout e tradução automática gratuita (LibreTranslate local; DeepL Free opcional);
  - revisão automática e modelos de corpo e de moldura.
- **Revisão**:
  - original e Word lado a lado, checklist por modalidade e conferência por amostra;
  - até 3 reprovações seguidas;
  - registro de formato novo.
- **Conclusão e numeração**:
  - tradutores juramentados com máscara em Word e regras de numeração por tradutor;
  - cotas anuais e pedidos de alteração ou anulação.
- **Entregas**: Word e PDF um a um ou em ZIP. No ZIP, cada arquivo leva o número e o protocolo, ou a referência "Tradução N".
- **Acompanhamento**:
  - painéis da organização, da equipe e pessoais;
  - notificações por categoria e auditoria somente inserção;
  - Gerenciamento AI (Gemini, opcional).

## Fora do escopo atual

Os itens abaixo estão em [roadmap.md](roadmap.md) e no relatório técnico de 27/10/2026:

- recuperação de senha por e-mail e MFA;
- criptografia em repouso;
- limitador de tentativas compartilhado entre instâncias da API;
- imagens Docker de produção;
- backup e restauração testados;
- aplicativo móvel e várias organizações.

## Princípios

- Monólito modular em TypeScript, com regras de negócio fora dos controladores HTTP.
- Validar toda entrada na fronteira, com Zod.
- Documentos e credenciais não entram no Git nem nos logs. Dos tokens fixos, só o hash fica no código.
- OCR, extração e tradução padrão rodam na própria infraestrutura. O envio externo só acontece quando o Diretor escolhe.
- Nada é concluído automaticamente: alguém com permissão confere e conclui.
