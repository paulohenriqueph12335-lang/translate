# Operação local

## Ciclo diário

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f api worker
docker compose down
```

`docker compose down` mantém os volumes nomeados. **Não** use `docker compose down -v` para uma parada normal: isso apaga os dados persistentes locais.

## Migrações

No início, `migrate` espera o Postgres saudável e aplica, em ordem e uma única vez, os arquivos de `packages/database/migrations/` ainda ausentes de `schema_migrations`. A execução pontual termina com status `Exited` quando conclui. Para aplicar explicitamente: `docker compose run --rm migrate`. Toda mudança de schema deve ter migração SQL nova e revisada; não reescrever migração aplicada em ambiente persistente.

## Primeiro Diretor

Com a stack em execução, crie o primeiro Diretor. A senha é pedida sem eco, e o comando recusa se já existir Diretor:

```powershell
docker compose run --rm -it api corepack pnpm --filter @tradutor/api bootstrap:director --email diretor@exemplo.com --name "Nome do Diretor"
```

Entre em <http://localhost:5173>. Novos cadastros ficam pendentes até um Diretor aprovar em **Aprovações**. Veja [ADR-004](decisions/004-director-bootstrap.md).

## Tradução juramentada

1. Como Supervisor, abra **Tradutores juramentados**, cadastre cada tradutor (nome, matrícula, idiomas) e envie a **máscara em Word** dele no armazenamento de máscaras, com os marcadores `{{texto}}`, `{{numero}}`, `{{data}}` etc. no lugar certo; cada envio vira uma edição numerada, e dá para voltar a uma edição anterior (o PDF do tradutor pode ser guardado como referência). Sem tradutor com máscara, nenhuma tradução pode ser concluída. Na conclusão, escolhe-se o tradutor e digita-se o número, o livro e a folha.
2. A tradução automática gratuita já vem ligada: o serviço `translator` (LibreTranslate) sobe com o Compose e baixa os modelos PT, EN, FR, IT e ES na primeira vez (`docker compose logs -f translator`). Em uma instalação que já tinha só PT/EN, baixe os novos uma vez com `docker compose exec translator /app/venv/bin/python /app/scripts/install_models.py --load_only_lang_codes en,pt,fr,it,es` e reinicie o `translator`. Para usar o DeepL Free no lugar dele, crie uma conta em deepl.com/pro-api, coloque `DEEPL_API_KEY=` no `.env`, recrie o worker e escolha o DeepL em **Configurações**.
3. Em **Envios**, crie o lote com o par de idiomas e, se quiser, etiquetas (ex.: "histórico escolar"). Cada documento armazenado é processado na hora, inclusive nos lotes do Diretor ainda sem equipe. A equipe recebe a notificação "Pronto para revisar"; se o tipo de documento ainda não tem uma tradução concluída, Líder e Diretor recebem "Tipo de documento novo".
4. Em **Traduções**, o Operador confere a prévia (o documento como vai sair), corrige o texto no lugar e clica **Pronta**. O Líder ou o Diretor clica **Concluir** (numera e libera o download) ou **Refazer** (com o motivo, opcionalmente reprocessando). As concluídas ficam em **Downloads**, junto com os originais.
5. O aviso no topo de **Envios** e **Traduções** diz se o worker parou, se a tradução automática está fora do ar ou se falta configurar o tradutor público. A chave `ANTHROPIC_API_KEY` não é mais usada (ADR-010) e pode ser apagada do `.env`.

## Saúde e diagnóstico

- API viva: `http://localhost:3000/health/live`.
- API pronta, incluindo conexão Postgres: `http://localhost:3000/health/ready`.
- Estado de containers: `docker compose ps`.
- Logs: `docker compose logs --tail=200 api worker postgres object-storage migrate`.
- Problema de pull com `docker-credential-desktop`: corrija a configuração do cliente Docker ou defina `DOCKER_CONFIG` para configuração temporária sem helper para pulls públicos. Isso não fornece credenciais para registries privados.
- Porta ocupada: ajuste a porta de host no `.env`; não altere a porta interna sem atualizar os endereços de rede Compose.
- `corepack enable` dá `EPERM` em `C:\Program Files\nodejs`: use `corepack pnpm ...` diretamente no diretório do projeto.

## Conversão para PDF

O serviço `converter` (Gotenberg com LibreOffice) converte o Word da prévia e da tradução final em PDF para ver na tela e baixar (ADR-017). Só a API acessa (`CONVERTER_URL`), sem porta publicada. Fora do ar, o PDF responde indisponível e o Word continua liberado.

## Capacidade

Medida no teste de carga de 20/10/2026 ([resultados](exemplos-simulados/README.md#teste-de-carga-20102026-máquina-de-desenvolvimento-docker-desktop)): uma instância da API responde ~75 requisições/s com p95 de 44 ms antes de ocupar um núcleo inteiro; um worker traduz ~370 documentos simples por hora (~10 s cada), com o LibreTranslate usando ~1,5 núcleo. Para crescer: mais instâncias da API atrás de um balanceador, mais workers (a fila usa `SKIP LOCKED`) e mais núcleos para o tradutor (`TRANSLATOR_THREADS`).

## Persistência e recuperação

Volumes atuais: `postgres_data` e `object_storage_data`. Eles sobrevivem a `docker compose down`. Não existe rotina automatizada de backup/restore ainda. Antes de atualizar volumes com dados importantes, exporte cópia independente; a estratégia formal entra na fase 8.

## Segredos locais

`.env` deve permanecer fora do Git. Os valores exemplo são públicos e não devem ser reutilizados em máquina compartilhada, rede ou implantação. Rotacione valores se houver exposição.
