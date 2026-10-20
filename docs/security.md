# Segurança e privacidade

## Regras obrigatórias

- Nunca comitar `.env`, chaves, senhas reais, documentos de usuários, fixtures pessoais ou dumps de produção.
- Não registrar conteúdo de documento, texto traduzido, tokens, credenciais ou URLs assinadas nos logs.
- Validar tipo real, extensão, tamanho, quantidade e conteúdo antes de processar uploads; não confiar em `Content-Type` do cliente.
- Armazenar objetos privados e autorizar cada leitura/download pela API por usuário, equipe e objeto.
- Validar permissões no servidor para cada operação. Ocultar botão na interface não é autorização.
- Limitar memória, CPU, tempo e tamanho de saída nos conversores/OCR; tratar arquivo como entrada não confiável.
- Limpar temporários com política explícita, sem apagar originais/resultados antes do prazo de retenção.
- Não enviar conteúdo a provedor externo até o provedor e a política de privacidade estarem habilitados/configurados de forma explícita.

## Estado atual e lacunas

A Fase 1 entregou autenticação por sessão revogável, senhas com scrypt, proteção CSRF por cabeçalho, limite de tentativas em memória, autorização por equipe e auditoria somente inserção. A Fase 2 entregou upload com validação de assinatura real, extensão e tamanho, chaves de objeto geradas no servidor, bucket privado (acesso anônimo recusado com 403), download autorizado e auditado pela API e versões imutáveis com SHA-256. A tradução automática padrão (LibreTranslate, ADR-008) roda dentro da infraestrutura; o DeepL Free envia o texto para fora e só é usado quando o Diretor o escolhe, com auditoria. A memória de tradução guarda trechos aprovados no PostgreSQL. O envio de documentos ao Claude foi removido (ADR-010): por padrão, nenhum conteúdo sai da infraestrutura. Notificações guardam só títulos e motivos curtos, nunca texto do documento, e cada pessoa lê apenas as próprias. O texto extraído e os rascunhos ficam no PostgreSQL (necessários para a revisão), e o DOCX final fica no S3. Nenhuma tradução é concluída sem ação de Líder ou Diretor. Ainda faltam troca/recuperação de senha, MFA, limitador compartilhado entre instâncias, criptografia em repouso do armazenamento, gestão de segredos e limpeza de objetos órfãos. Com HTTPS, defina `COOKIE_SECURE=true` (e `TRUST_PROXY=true` atrás de proxy reverso). Credenciais em `.env.example` servem somente para máquina local; substitua-as em `.env` antes de uso compartilhado. Portas vinculadas a loopback reduzem exposição de rede, mas não substituem autenticação nem tornam o sistema adequado para produção.

SeaweedFS usa credenciais locais passadas por ambiente e tem API publicada apenas em `127.0.0.1:8333`. Requisições anônimas recebem 403 (verificado em 2026-10-17), e o bucket é criado pela API. A criptografia em repouso (SSE) do SeaweedFS não está configurada; não guardar documentos sensíveis reais neste ambiente local.

## Controles antes de piloto

- Sessões seguras, expiração e revogação.
- Autorização por objeto/equipe testada contra acesso horizontal e vertical.
- Upload inspecionado e conversores isolados com limites.
- TLS/segredos adequados ao ambiente de implantação.
- Auditoria sem payload sensível e retenção definida.
- Backup cifrado e restauração de banco e objetos ensaiada.
- Política de retenção/eliminação, resposta a incidentes e gestão de vulnerabilidades.
