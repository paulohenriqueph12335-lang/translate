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

Com a stack em execução, abra <http://localhost:5173>: sem Diretor, aparece a **Configuração inicial**. Ela pede o **Token do Diretor**, o token fixo entregue com o sistema, e o nome, o e-mail e a senha do Diretor. Para trocar o token, defina `DIRECTOR_TOKEN` (e, para o do Líder, `LEADER_TOKEN`) no `.env` e reinicie a API (ADR-031). Marque **Conta de teste** para experimentar; com **Criar também Líder e Usuário de teste**, o sistema cria a "Equipe de Teste" com `lider.teste@exemplo.com` e `usuario.teste@exemplo.com`, com a mesma senha. O botão **Excluir contas de teste**, no topo da tela do Diretor de teste, apaga todas de uma vez, e a configuração inicial volta para criar a conta definitiva.

Também dá para criar pelo terminal. A senha é pedida sem eco, e o comando recusa se já existir Diretor:

```powershell
docker compose run --rm -it api corepack pnpm --filter @tradutor/api bootstrap:director --email diretor@exemplo.com --name "Nome do Diretor"
```

Entre em <http://localhost:5173>. Novos cadastros ficam pendentes até um Diretor aprovar em **Aprovações**. Veja [ADR-004](decisions/004-director-bootstrap.md).

## Configurações da conta

Todos os perfis encontram **Configurações** no rodapé do menu:

- **Preferências**: ative ou desative os avisos e escolha recebê-los assim que chegarem, a cada 5 minutos, 15 minutos ou uma hora. Salve as notificações. A central continua disponível com os avisos desativados. Os avisos funcionam com a aplicação aberta; pop-ups do sistema também exigem permissão do navegador.
- **Aparência**, na mesma aba: escolha Claro, Modo noturno ou Acompanhar o sistema e salve. A preferência acompanha a conta. As prévias dos documentos mantêm o papel branco.
- **Alterar senha**: informe a senha atual, a nova senha (12 a 256 caracteres) e a confirmação. Ao atualizar, os outros dispositivos saem da conta e a sessão atual continua aberta.
- **Minhas sessões**: consulte e encerre acessos dos seus dispositivos.

## Tradução juramentada

1. Para tradução juramentada **com máscara**, como Supervisor, abra **Tradutores juramentados**, cadastre cada tradutor (nome, matrícula, idiomas) e envie a **máscara em Word** dele no armazenamento de máscaras, com os marcadores `{{texto}}`, `{{numero}}`, `{{data}}` etc. no lugar certo. Cada envio vira uma edição numerada e permite voltar à anterior. Essa opção exige tradutor e máscara configurados; a numeração segue as regras do tradutor e a conferência da liderança. O envio também oferece o fluxo sem máscara, conforme a modalidade escolhida.
2. A tradução automática gratuita já vem ligada: o serviço `translator` (LibreTranslate) sobe com o Compose e baixa os modelos PT, EN, FR, IT e ES na primeira vez (`docker compose logs -f translator`). Em uma instalação que já tinha só PT/EN, baixe os novos uma vez com `docker compose exec translator /app/venv/bin/python /app/scripts/install_models.py --load_only_lang_codes en,pt,fr,it,es` e reinicie o `translator`. Para usar o DeepL Free no lugar dele, crie uma conta em deepl.com/pro-api, coloque `DEEPL_API_KEY=` no `.env`, recrie o worker e escolha o DeepL em **Configurações**.
3. Em **Traduções › Nova tradução**, escolha a modalidade e crie a remessa com protocolo ou justificativa de ausência e o par de idiomas. Remessas com 20 arquivos ou mais exigem escolha de inspeção integral ou por amostra. Cada documento armazenado entra na fila, inclusive nos lotes do Diretor ainda sem equipe. A equipe recebe "Pronto para revisar"; tipos ainda sem tradução concluída geram o aviso "Tipo de documento novo" para a liderança.
4. Em **Traduções**, o responsável compara original e Word, registra a conferência da revisão, corrige o necessário e conclui (ADR-031). O Líder ou o Diretor também concluem e são quem devolve uma tradução pronta, com motivo e fases falhas, e quem resolve problemas de numeração. Três reprovações consecutivas exigem novo formato estrutural. As concluídas ficam em **Entregas e ZIP**, com Word e PDF um a um ou em ZIP. No ZIP, cada arquivo leva o número da tradução e o protocolo; sem número, leva a referência "Tradução N", que também serve para buscar depois. Consulte as regras detalhadas abaixo.
5. O aviso no topo de **Envios** e **Traduções** diz se o worker parou, se a tradução automática está fora do ar ou se falta configurar o tradutor público. A chave `ANTHROPIC_API_KEY` não é mais usada (ADR-010) e pode ser apagada do `.env`.

## Painéis, protocolos e fluxo de revisão (2026-10-24)

As regras completas estão no [ADR-025](decisions/025-operational-document-flow.md).

1. No **Início**, mantenha os indicadores essenciais e use **Escolher painéis** para mostrar, ocultar ou ordenar os gráficos. **Ampliar** abre uma janela com o mesmo gráfico. A seleção fica na conta neste navegador. Diretor e Líder podem pesquisar protocolos, arquivos, pessoas, fases e erros no Início e abrir os resultados nas áreas correspondentes.
2. Ao enviar uma remessa, informe o **protocolo** ou explique sua ausência. Para 20 arquivos ou mais, escolha inspecionar todos ou a amostra dos primeiros até 10 documentos elegíveis. O protocolo aparece antes do nome de saída e a decisão de inspeção fica registrada.
3. Na tradução, confira os tempos e compare **Original e Word**. Uma reprovação exige indicar as fases com falha e explicar a correção. Depois de três reprovações consecutivas, registre um novo formato com mudança real de diagramação antes de continuar. Corrigir o idioma registra os pares anteriores/novos e refaz o fluxo; documentos prontos pedem confirmação e motivo.
4. Em **Auditoria**, filtre gravidade e causa. Os totais abrangem todas as páginas. **Pendências operacionais agora** mostra bloqueios, falhas, processamento parado há 30 minutos e documentos válidos prontos há 24 horas sem download. Use **Atualizar auditoria** para consultar novamente.
5. Em **Concluídas**, selecione Word ou PDF para exportar uma remessa/seleção em ZIP. Limites: 100 traduções, 50 MiB por arquivo e 128 MiB no conteúdo total. As pastas separam protocolo, par e formato. Se houver falha de conversão ou leitura, a exportação inteira falha; reduza a seleção ou restaure o serviço indicado. Após preparar todos os arquivos, o servidor verifica novamente acessos e estados e registra os downloads e o agrupamento em uma única transação; uma recusa desfaz todo esse registro.

O tempo até o primeiro download representa a entrega registrada pelo servidor. Consultar uma prévia não encerra essa espera; o sistema não acompanha o salvamento no dispositivo do usuário. A estimativa de produção informa se veio de histórico comparável ou da referência inicial por páginas.

Em **Tipos de documento**, o ensaio de um formato novo também registra aprovações/reprovações por revisão. Escolha as fases com falha e o motivo; após três reprovações, registre outro formato e selecione uma diagramação diferente. Gere o Word de novo antes de comparar e decidir. Se a diagramação produzida continuar igual, substitua o preset pendente no formulário e gere novamente; a inspeção continua bloqueada até haver mudança real. Reenviar o mesmo resultado não elimina a decisão anterior. Apenas digests, layout sem conteúdo e decisões são guardados, conforme o [ADR-028](decisions/028-pattern-trial-reviews.md).

## Saúde e diagnóstico

- API viva: `http://localhost:3000/health/live`.
- API pronta, incluindo conexão Postgres: `http://localhost:3000/health/ready`.
- Estado de containers: `docker compose ps`.
- Logs: `docker compose logs --tail=200 api worker postgres object-storage migrate`.
- Problema de pull com `docker-credential-desktop`: corrija a configuração do cliente Docker ou defina `DOCKER_CONFIG` para configuração temporária sem helper para pulls públicos. Isso não fornece credenciais para registries privados.
- Porta ocupada: ajuste a porta de host no `.env`; não altere a porta interna sem atualizar os endereços de rede Compose.
- `corepack enable` dá `EPERM` em `C:\Program Files\nodejs`: use `corepack pnpm ...` diretamente no diretório do projeto.

## OCR

O worker e a API têm o Tesseract (por, eng, fra, ita, spa) e o Poppler: imagens e PDFs digitalizados são lidos por OCR antes da tradução (ADR-018). Para outro idioma, instale o pacote `tesseract-ocr-<código>` no Dockerfile.

## Conversão para PDF

O serviço `converter` (Gotenberg com LibreOffice) converte o Word da prévia e da tradução final em PDF para ver na tela e baixar (ADR-017). Só a API acessa (`CONVERTER_URL`), sem porta publicada. Fora do ar, o PDF responde indisponível e o Word continua liberado.

A interface apresenta os PDFs com PDF.js e worker locais, inclusive em navegadores sem plugin PDF. Use as setas para mudar a página, o seletor para ajustar à largura ou ampliar para 150%/200%, e **Texto desta página** para consultar o conteúdo textual extraído. Cada lado da comparação tem seus próprios controles. Se a renderização falhar, a tela informa o erro e oferece nova tentativa. O visualizador não substitui o conversor nem altera o arquivo traduzido.

## Capacidade

Medida no teste de carga de 20/10/2026 ([resultados](exemplos-simulados/README.md#teste-de-carga-20102026-máquina-de-desenvolvimento-docker-desktop)): uma instância da API responde ~75 requisições/s com p95 de 44 ms antes de ocupar um núcleo inteiro; um worker traduz ~370 documentos simples por hora (~10 s cada), com o LibreTranslate usando ~1,5 núcleo. Para crescer: mais instâncias da API atrás de um balanceador, mais workers (a fila usa `SKIP LOCKED`) e mais núcleos para o tradutor (`TRANSLATOR_THREADS`).

## Esqueci a senha

Na entrada, **Esqueci a senha** registra uma senha nova pendente. Quem decide é o Diretor ou o Líder, em Equipe › Pedidos de senha, com o token do próprio papel:

- o Diretor autoriza de vez;
- o Líder libera o Usuário da equipe por 24 horas, até 3 vezes seguidas; depois, só o Diretor troca a senha.

Com o Token do Diretor, a própria tela "Esqueci a senha" troca a senha na hora. É o caminho quando o único Diretor esqueceu a dele (ADR-031).

## Persistência e recuperação

Volumes atuais: `postgres_data`, `object_storage_data` e `encryption_keys`. Eles sobrevivem a `docker compose down`. Não existe rotina automatizada de backup/restore ainda. Antes de atualizar volumes com dados importantes, exporte cópia independente; a estratégia formal entra na fase 8.

## Criptografia

Os documentos ficam cifrados em repouso (ADR-032): os arquivos no armazenamento e, no banco, o texto extraído, os rascunhos e a memória de tradução.

Na primeira subida, o `migrate` cria a chave no volume `encryption_keys` e avisa no log. Faça uma cópia dela fora deste computador. **Sem a chave, os documentos e os backups não podem ser lidos.**

```powershell
docker compose run --rm migrate cat /run/tradutor-keys/encryption.keys
```

Guarde a saída num cofre de senhas ou num pendrive guardado à parte. Não guarde junto do backup do banco.

**Para usar uma chave sua** (um cofre de segredos ou outro servidor), coloque em `ENCRYPTION_KEYS` no `.env` uma linha `id:base64` com 32 bytes. Ela tem prioridade sobre o arquivo do volume.

**Para trocar a chave (rotação):**

```powershell
docker compose run --rm migrate pnpm --filter @tradutor/api encryption add-key
docker compose up -d --force-recreate
```

A chave nova passa a ser a ativa. Na subida, o `migrate` recifra o banco e os arquivos com ela. A chave antiga fica no arquivo e só pode sair depois disso. Com `ENCRYPTION_KEYS`, use `encryption new-key` e cole a chave nova no início da variável.

A cada subida, o `migrate` também cifra o que ainda estiver aberto, como os dados de antes desta versão. Pode ser repetido sem risco.

## Segredos e novas instalações

O `.env` deve ficar fora do Git. Os valores do `.env.example` são públicos e não devem ser usados em máquina compartilhada, rede ou implantação.

**Para instalar o sistema em outro lugar**, gere um `.env` com segredos próprios:

- senha do banco;
- chaves do armazenamento;
- chave de criptografia;
- tokens do Diretor e do Líder daquela instalação.

```powershell
docker run --rm -v "${PWD}:/w" -w /w node:22-bookworm-slim node scripts/nova-instalacao.mjs
```

Os tokens aparecem uma vez na tela: anote. Com HTTPS, acrescente `--https`.

O script recusa sobrescrever um `.env` existente. Trocar a senha do banco num volume que já existe não muda a senha dentro do PostgreSQL.

**Cofre de segredos.** Cada segredo pode vir de um arquivo, com `NOME_FILE`, como `S3_SECRET_KEY_FILE` ou `DATABASE_URL_FILE`. Isso funciona com Docker secrets, Kubernetes secrets ou um cofre que monta arquivos. A chave de criptografia usa `ENCRYPTION_KEYS_FILE`.

Se algum segredo vazar, troque-o. Para a chave de criptografia, faça a rotação acima.
