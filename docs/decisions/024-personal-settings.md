# ADR-024 — Configurações pessoais, aparência e troca de senha

- Estado: Accepted
- Data: 2026-10-22
- Relacionadas: [ADR-003](003-sessions-and-passwords.md), [ADR-023](023-compact-navigation.md)

## Contexto

Cada pessoa precisa controlar os avisos que recebe, escolher a aparência da interface e alterar a própria senha sem sair da conta.

## Decisão

- O rodapé do menu oferece **Configurações** para todos os perfis, com as abas Preferências, Alterar senha e Minhas sessões.
- `GET/PUT/PATCH /api/v1/auth/preferences` lê e salva somente as preferências do usuário autenticado. A interface usa PATCH para atualizar só a opção alterada, evitando sobrescrever escolhas feitas em outra aba. A migração `0024_user_preferences` guarda ativação de avisos, frequência (`immediate`, `5m`, `15m`, `1h`) e tema (`light`, `dark`, `system`). O padrão mantém o comportamento anterior: avisos ligados, imediatos e tema claro.
- Desativar avisos suprime os toasts e pop-ups do navegador. A central e o contador de não lidas continuam disponíveis. Os intervalos agrupam as novidades enquanto a aplicação está aberta; a opção imediata consulta a cada 20 segundos. As preferências não marcam itens como lidos.
- O tema usa tokens CSS em toda a interface. O papel das prévias continua claro para representar o documento final. Um cache local do tema evita o clarão ao recarregar; após o login, a preferência da conta prevalece. O tema do sistema acompanha mudanças do sistema operacional.
- `POST /api/v1/auth/password` exige a senha atual e uma senha nova diferente, de 12 a 256 caracteres. Usa scrypt e normalização já existentes, proteção CSRF e limite de tentativas. A alteração é auditada sem senhas, mantém a sessão atual e revoga as outras sessões. Login e alteração de senha se coordenam para impedir que um login concorrente gere uma sessão usando a senha antiga.

## Consequências

As preferências acompanham a conta em novos acessos. Avisos do sistema dependem também da permissão do navegador e funcionam enquanto a aplicação está aberta. Não há envio por e-mail nem agendamento no servidor. A troca de senha autenticada não implementa recuperação de senha esquecida.
