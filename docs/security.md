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

A Fase 1 entregou autenticação por sessão revogável, senhas com scrypt, proteção CSRF por cabeçalho, limite de tentativas em memória, autorização por equipe e auditoria somente inserção. Ainda faltam troca/recuperação de senha, MFA, limitador compartilhado entre instâncias, uploads, downloads, integração S3 pela aplicação, criptografia gerenciada e gestão de segredos. Com HTTPS, defina `COOKIE_SECURE=true` (e `TRUST_PROXY=true` atrás de proxy reverso). Credenciais em `.env.example` servem somente para máquina local; substitua-as em `.env` antes de uso compartilhado. Portas vinculadas a loopback reduzem exposição de rede, mas não substituem autenticação nem tornam o sistema adequado para produção.

SeaweedFS usa credenciais locais passadas por ambiente e tem API publicada apenas em `127.0.0.1:8333`. Ainda falta demonstrar que o serviço exige autenticação em todas as rotas S3, provisionar bucket e validar política de acesso. Não guardar documentos sensíveis neste ambiente antes dessas verificações.

## Controles antes de piloto

- Sessões seguras, expiração e revogação.
- Autorização por objeto/equipe testada contra acesso horizontal e vertical.
- Upload inspecionado e conversores isolados com limites.
- TLS/segredos adequados ao ambiente de implantação.
- Auditoria sem payload sensível e retenção definida.
- Backup cifrado e restauração de banco e objetos ensaiada.
- Política de retenção/eliminação, resposta a incidentes e gestão de vulnerabilidades.
