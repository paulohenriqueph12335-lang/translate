# ADR-001 — Monorepositório e monólito modular

- Estado: Accepted
- Data: 2026-10-16

## Contexto

O MVP precisa de interface web, API e worker, além de módulos compartilhados. Microsserviços/Kubernetes adicionariam operação sem resolver uma necessidade atual.

## Decisão

Manter web, API, worker e pacotes TypeScript em um monorepositório com pnpm. Separar responsabilidades por módulos e contratos; executar componentes como serviços Docker independentes quando necessário.

## Consequências

- Versões e dependências são coordenadas pelo workspace e `pnpm-lock.yaml`.
- API e worker podem escalar separadamente sem adotar microsserviços no domínio.
- Regras de negócio não devem depender do framework HTTP nem de detalhes Docker.
- O desenho pode ser revisto quando carga, equipe ou fronteiras de domínio justificarem.

## Alternativas consideradas

Repositórios separados e microsserviços; ambos rejeitados para a fundação do MVP por aumentarem o custo de coordenação/operação.
