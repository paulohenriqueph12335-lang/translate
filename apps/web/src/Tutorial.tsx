import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Tutorial do sistema: cada seção explica para que serve a tela (teoria), como usar (prática) e mostra fotos reais.
 * As seções aparecem conforme o papel da pessoa; o botão "Abrir esta tela" leva direto ao lugar descrito.
 */
export type TutorialRole = 'user' | 'leader' | 'director';
export type TutorialTarget = {
  area: 'home' | 'work' | 'history' | 'team' | 'settings' | 'admin' | 'notifications' | 'account';
  tab?: string;
};

interface Shot {
  src: string;
  alt: string;
  caption: string;
  narrow?: boolean;
}

interface TutorialSectionData {
  key: string;
  title: string;
  summary: string;
  roles: TutorialRole[];
  target?: TutorialTarget;
  body: (role: TutorialRole) => ReactNode;
}

function Figure({ src, alt, caption, narrow }: Shot) {
  return (
    <figure className={`tutorial-figure ${narrow ? 'narrow' : ''}`}>
      <a href={`/tutorial/${src}.jpg`} target="_blank" rel="noreferrer" title="Abrir a foto em tamanho real">
        <img src={`/tutorial/${src}.jpg`} alt={alt} loading="lazy" decoding="async" />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Theory({ children }: { children: ReactNode }) {
  return (
    <div className="tutorial-block">
      <h3>Para que serve</h3>
      {children}
    </div>
  );
}

function Practice({ title = 'Na prática', steps }: { title?: string; steps: ReactNode[] }) {
  return (
    <div className="tutorial-block">
      <h3>{title}</h3>
      <ol className="tutorial-steps">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="tutorial-tip">
      <Icon name="info" />
      <span>{children}</span>
    </p>
  );
}

const leads = (role: TutorialRole) => role !== 'user';

export const TUTORIAL: TutorialSectionData[] = [
  {
    key: 'start',
    title: 'Primeiros passos',
    summary: 'O que o sistema faz, quem faz o quê e o caminho de cada documento.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'home' },
    body: (role) => (
      <>
        <Theory>
          <p>
            O Tradutor Documental traduz documentos (certidões, históricos, CNH, contratos e outros) mantendo o layout do original, e leva
            cada um até o Word final. A tradução e a revisão automáticas fazem o trabalho pesado; uma pessoa sempre confere o original e o
            Word lado a lado antes de concluir.
          </p>
          <p>Cada pessoa tem um papel, e o menu mostra só o que ela usa:</p>
          <ul className="tutorial-list">
            <li>
              <strong>Usuário</strong>: envia documentos, confere a prévia em Word e aprova. Vê o próprio trabalho e o histórico.
            </li>
            <li>
              <strong>Supervisor</strong>: acompanha a equipe, conclui ou pede para refazer, cuida da numeração, dos tradutores
              juramentados, do glossário, das regras e da IA.
            </li>
            <li>
              <strong>Diretor</strong>: tudo isso para a organização inteira, mais os cadastros e os usuários.
            </li>
          </ul>
          <p>
            Todo documento percorre a mesma <strong>linha do fluxo</strong>, em seis etapas. Ela aparece na lista de traduções (em
            miniatura), no topo de cada tradução e na tela de entrada:
          </p>
          <ol className="tutorial-flow">
            <li>
              <strong>Envio</strong>
              <span>o arquivo é guardado no sistema.</span>
            </li>
            <li>
              <strong>Tradução</strong>
              <span>automática, no layout do original.</span>
            </li>
            <li>
              <strong>Revisão</strong>
              <span>automática: corrige idioma, números, datas e termos do glossário.</span>
            </li>
            <li>
              <strong>Prévia em Word</strong>
              <span>uma pessoa compara original e Word e aprova.</span>
            </li>
            <li>
              <strong>Conclusão</strong>
              <span>a liderança conclui (e numera, na juramentada com tradutor).</span>
            </li>
            <li>
              <strong>Word final</strong>
              <span>Word e PDF liberados para baixar.</span>
            </li>
          </ol>
        </Theory>
        <Practice
          steps={[
            <>
              Abra o endereço do sistema no navegador e entre com o seu e-mail e a sua senha. Quem ainda não tem conta usa
              <strong> Solicitar acesso</strong>; o cadastro fica pendente até um Diretor aprovar.
            </>,
            <>
              Depois de entrar, você cai no <strong>Início</strong>.{' '}
              {role === 'user'
                ? 'Para trabalhar, vá em Traduzir.'
                : 'O trabalho do dia a dia fica em Traduções; a gestão, em Equipes e Ajustes.'}
            </>,
            <>Para sair, use o menu da sua conta (a bolinha com as suas iniciais, no canto superior direito) e escolha Sair.</>,
          ]}
        />
        <Figure
          src="entrada"
          alt="Tela de entrada com a marca à esquerda e o formulário à direita"
          caption="A entrada: e-mail, senha e o pedido de acesso para quem ainda não tem conta."
        />
        <Figure
          src="visao-geral"
          alt="Tela inicial do Diretor com menu lateral, barra superior e números"
          caption="Depois de entrar: menu à esquerda, pesquisa e avisos em cima, e a área de trabalho ao centro."
        />
      </>
    ),
  },
  {
    key: 'navigate',
    title: 'Navegar pelo sistema',
    summary: 'Menu, pesquisa com Ctrl+K, sino de avisos, tema claro ou escuro e o uso no celular.',
    roles: ['user', 'leader', 'director'],
    body: () => (
      <>
        <Theory>
          <p>
            O <strong>menu lateral</strong> agrupa as áreas em Visão geral, Operação e Gestão. Dentro de cada área, as telas parecidas ficam
            em abas logo abaixo do título. Em Ajustes, Administração e Configurações, as telas ficam num menu à esquerda.
          </p>
          <p>A barra superior tem quatro atalhos:</p>
          <ul className="tutorial-list">
            <li>
              <strong>Pesquisa</strong> (ou <kbd>Ctrl</kbd> + <kbd>K</kbd> de qualquer lugar): acha telas, protocolos, documentos e, para a
              liderança, pessoas, equipes, fases e registros. Acentos e maiúsculas não importam.
            </li>
            <li>
              <strong>Sino</strong>: as notificações recentes, separadas em "Precisa de você" e "Atualizações".
            </li>
            <li>
              <strong>Lua / sol</strong>: troca entre o tema claro e o escuro. A escolha fica salva na sua conta.
            </li>
            <li>
              <strong>Suas iniciais</strong>: o seu nome, o seu papel, Configurações e Sair.
            </li>
          </ul>
        </Theory>
        <Practice
          steps={[
            <>
              Aperte <kbd>Ctrl</kbd> + <kbd>K</kbd>, digite parte do que procura (por exemplo, um protocolo ou "certidão") e use as setas
              para escolher. <kbd>Enter</kbd> abre e <kbd>Esc</kbd> fecha.
            </>,
            <>Clique no sino para ver o que precisa de você. Clicar numa notificação abre o documento e a marca como lida.</>,
            <>No celular, as áreas principais ficam na barra de baixo; o restante (Notificações, Configurações, Sair) fica em Mais.</>,
          ]}
        />
        <div className="tutorial-figures">
          <Figure
            src="pesquisa"
            alt="Pesquisa global aberta com resultados"
            caption="Pesquisa global (Ctrl+K): telas e documentos na mesma lista."
          />
          <Figure
            src="sino"
            alt="Painel de notificações aberto pelo sino"
            caption="O sino separa o que precisa de você das atualizações."
          />
          <Figure src="conta" alt="Menu da conta aberto" caption="Menu da conta: quem está conectado, Configurações e Sair." />
          <Figure src="tema-escuro" alt="Sistema no tema escuro" caption="O mesmo sistema no tema escuro." />
          <Figure
            src="celular"
            alt="Sistema no celular com a barra inferior"
            caption="No celular: barra de baixo com as áreas principais."
            narrow
          />
          <Figure src="celular-mais" alt="Folha Mais aberta no celular" caption="Em Mais: Notificações, Configurações e Sair." narrow />
        </div>
      </>
    ),
  },
  {
    key: 'send',
    title: 'Enviar uma nova tradução',
    summary: 'Modalidade, arquivos, protocolo, idiomas e a conferência antes de começar.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'work', tab: 'send' },
    body: (role) => (
      <>
        <Theory>
          <p>
            Uma <strong>remessa</strong> é um envio com um ou mais documentos do mesmo cliente ou pedido. Tudo o que você escolhe no envio
            vale para cada documento dela. A primeira escolha é a <strong>modalidade</strong>:
          </p>
          <ul className="tutorial-list">
            <li>
              <strong>Juramentada</strong>: correção, tradução e revisão. Na conclusão, pode sair com a máscara e o número do tradutor
              juramentado, ou sem tradutor.
            </li>
            <li>
              <strong>Certificada</strong>: tradução, diagramação e revisão, com a declaração do tradutor e sem número.
            </li>
            <li>
              <strong>Técnica</strong>: tradução, diagramação e revisão, com o layout fiel ao original.
            </li>
            <li>
              <strong>Simples</strong>: tradução e revisão.
            </li>
          </ul>
          <p>
            O <strong>protocolo</strong> identifica a remessa: ele entra no começo do nome dos arquivos de Word e PDF e pode ser pesquisado
            depois. Se a remessa não tem protocolo, marque a opção e escreva o motivo.
          </p>
        </Theory>
        <Practice
          title="Na prática: as quatro etapas"
          steps={[
            <>
              <strong>Modalidade e documentos</strong>: escolha a modalidade e arraste os arquivos para a área tracejada (ou clique nela).
              Aceita PDF, Word, PowerPoint e imagens; os limites de tamanho aparecem na própria tela.
            </>,
            <>
              <strong>Identificação e protocolo</strong>: digite o protocolo (letras, números, espaço, ponto, hífen ou sublinhado), um nome
              opcional e o tipo de documento. Deixe o tipo em Automático quando a remessa tiver documentos diferentes.
            </>,
            <>
              <strong>Idiomas e equipe</strong>: escolha o par de idiomas (sempre com o português de um dos lados).
              {role === 'director'
                ? ' Como Diretor, a remessa aguarda o direcionamento a uma equipe depois do envio.'
                : ' Se você está em mais de uma equipe, escolha a equipe.'}
            </>,
            <>
              <strong>Conferência do envio</strong>: confira o resumo e clique em <strong>Iniciar tradução</strong>. A partir daí, tradução
              e revisão são automáticas; a prévia em Word aparece sozinha.
            </>,
          ]}
        />
        <Tip>
          Remessas com 20 arquivos ou mais pedem que você escolha a inspeção: de todos os documentos ou de uma amostra com os 10 primeiros.
        </Tip>
        <div className="tutorial-figures">
          <Figure src="envio-1" alt="Etapa 1: escolha da modalidade e dos arquivos" caption="Etapa 1: a modalidade e os arquivos." />
          <Figure src="envio-2" alt="Etapa 2: protocolo e tipo documental" caption="Etapa 2: protocolo, nome e tipo de documento." />
          <Figure src="envio-3" alt="Etapa 3: idiomas e equipe" caption="Etapa 3: par de idiomas e equipe." />
          <Figure src="envio-4" alt="Etapa 4: resumo do envio" caption="Etapa 4: o resumo antes de iniciar." />
        </div>
      </>
    ),
  },
  {
    key: 'queue',
    title: 'Meu trabalho',
    summary: 'O que está com você, o que espera por você e o que a equipe pode assumir.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'work', tab: 'mine' },
    body: () => (
      <>
        <Theory>
          <p>
            Cada tradução tem um <strong>responsável</strong>: quem enviou ou quem assumiu. Só o responsável e a liderança da equipe editam
            e aprovam. Colegas da mesma equipe veem o trabalho uns dos outros, mas não alteram.
          </p>
          <p>
            Em <strong>Meu trabalho</strong>, os números do topo mostram o que fazer agora. <strong>Comigo</strong> lista as suas traduções
            em andamento, e <strong>Disponíveis para assumir</strong> lista as que estão sem responsável na sua equipe.
          </p>
        </Theory>
        <Practice
          steps={[
            <>Comece pelo número "Para revisar": são as prévias em Word esperando a sua conferência.</>,
            <>Clique numa tradução da lista para abrir a conferência.</>,
            <>
              Para pegar um documento livre da equipe, use <strong>Assumir</strong> em "Disponíveis para assumir". Ele passa a ser seu.
            </>,
          ]}
        />
        <Figure
          src="meu-trabalho"
          alt="Tela Meu trabalho com números e listas"
          caption="Meu trabalho: números de ação, o que está com você e o que pode ser assumido."
        />
      </>
    ),
  },
  {
    key: 'review',
    title: 'Conferir e aprovar',
    summary: 'A comparação lado a lado, a conferência obrigatória, reprovar com as fases e os ajustes manuais.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'work', tab: 'mine' },
    body: (role) => (
      <>
        <Theory>
          <p>
            A tela de uma tradução mostra, no topo, a <strong>linha do fluxo</strong> com a etapa atual destacada. Logo abaixo ficam o{' '}
            <strong>original e a prévia em Word lado a lado</strong>, cada um com páginas, zoom e o texto da página. Nada é aprovado sem uma
            pessoa comparar os dois.
          </p>
          <p>
            A <strong>conferência</strong> registra essa comparação. Para reprovar, indique as fases que falharam (correção, tradução,
            diagramação ou revisão) e escreva um comentário. Depois de três reprovações seguidas, o sistema bloqueia novas tentativas até
            alguém registrar uma nova forma de formatação.
          </p>
        </Theory>
        <Practice
          steps={[
            <>Abra a tradução e compare o original com o Word, página por página.</>,
            <>
              Se estiver certo, marque <strong>Comparei o original e o Word desta revisão</strong> e use{' '}
              <strong>{role === 'user' ? 'Aprovar Word' : 'Aprovar e concluir'}</strong>.
              {role === 'user'
                ? ' A liderança da equipe é avisada para concluir.'
                : ' Em seguida, escolha como concluir (veja Concluir e numerar).'}
            </>,
            <>
              Se algo estiver errado, use <strong>Reprovar e indicar as fases com falha</strong>, marque as fases e escreva o que precisa
              mudar.
            </>,
            <>
              Para corrigir você mesmo, abra <strong>Ajustes manuais</strong>: editar o texto, confirmar o checklist das etapas, rodar a
              revisão automática de novo ou pedir auxílio da IA.
            </>,
          ]}
        />
        <Tip>
          "Pontos para conferir" lista o que a revisão automática não conseguiu resolver (por exemplo, trechos iguais ao original). Baixar
          para conferir abre o arquivo no seu computador, se a prévia não carregar.
        </Tip>
        <Figure
          src="detalhe-topo"
          alt="Topo da tradução com a linha do fluxo"
          caption="O topo da tradução: título, situação, responsável e a linha do fluxo."
        />
        <Figure src="comparacao" alt="Original e Word lado a lado" caption="Original e prévia em Word lado a lado, com páginas e zoom." />
        <Figure
          src="conferencia"
          alt="Conferência antes da aprovação"
          caption="A conferência: confirme a comparação ou reprove indicando as fases."
        />
        {leads(role) && (
          <Tip>
            Na lista de traduções, as fases ficam numa régua com a contagem de cada uma (Produção, Conferência, Aprovação, Entrega,
            Pendências e Todas). A miniatura da linha do fluxo em cada documento mostra onde ele está.
          </Tip>
        )}
        {leads(role) && (
          <Figure
            src="lista-fases"
            alt="Lista de traduções com a régua de fases"
            caption="Traduções: fases com contagem, filtros e a lista com a linha do fluxo de cada documento."
          />
        )}
      </>
    ),
  },
  {
    key: 'conclude',
    title: 'Concluir e numerar',
    summary: 'A decisão da liderança: com ou sem tradutor juramentado, número, livro e folha.',
    roles: ['leader', 'director'],
    target: { area: 'work', tab: 'team' },
    body: () => (
      <>
        <Theory>
          <p>
            Concluir libera o Word e o PDF finais. Quem conclui é o Supervisor da equipe ou o Diretor. Na juramentada, a conclusão escolhe:
          </p>
          <ul className="tutorial-list">
            <li>
              <strong>Com tradutor</strong>: o Word sai na máscara do tradutor juramentado, com número, livro e folha conforme a regra de
              numeração dele.
            </li>
            <li>
              <strong>Sem tradutor</strong>: o Word sai no layout do original, sem máscara e sem número.
            </li>
          </ul>
          <p>
            As <strong>cotas</strong> anuais limitam quantos números cada pessoa, equipe ou a organização pode emitir. Quando um limite
            acaba, Pronta e Concluir ficam bloqueadas; a liderança é avisada aos 80% e aos 100%.
          </p>
        </Theory>
        <Practice
          steps={[
            <>Abra a tradução em Aguardando conclusão (fase 3. Aprovação, na lista de Traduções).</>,
            <>
              Use <strong>Aprovar e concluir</strong> ou, em Ajustes manuais, <strong>Concluir</strong>.
            </>,
            <>Na juramentada, escolha com ou sem tradutor; com tradutor, confira o número, o livro e a folha sugeridos.</>,
            <>
              Clique em <strong>Concluir e liberar download</strong>. Quem enviou e quem revisou são avisados.
            </>,
            <>
              Para devolver, use <strong>Refazer…</strong> (em Ajustes manuais) com o motivo; a tradução volta para Para revisar.
            </>,
          ]}
        />
        <Tip>Um número já emitido não some: pedir alteração ou anulação é feito em Equipes, na aba Numeração, e fica registrado.</Tip>
        <Figure
          src="conclusao"
          alt="Painel Concluir tradução"
          caption="Concluir tradução: a escolha final, o checklist das etapas e o botão de liberar o download."
        />
      </>
    ),
  },
  {
    key: 'deliver',
    title: 'Entregas e ZIP',
    summary: 'Baixar o Word e o PDF finais, um a um ou em lote.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'work', tab: 'done' },
    body: () => (
      <>
        <Theory>
          <p>
            <strong>Entregas e ZIP</strong> reúne as traduções concluídas e os documentos enviados, sempre ligados entre si. Cada tradução
            tem os botões para salvar o Word e o PDF. Para várias de uma vez, o ZIP organiza os arquivos em pastas por protocolo, par de
            idiomas e formato.
          </p>
        </Theory>
        <Practice
          steps={[
            <>Use os filtros (protocolo, tipo, idiomas, quem concluiu e datas) para achar as traduções.</>,
            <>
              Para um documento, use <strong>Salvar arquivos</strong> na linha dele e escolha Word ou PDF.
            </>,
            <>
              Para várias, marque as caixas à esquerda (ou <strong>Selecionar resultados carregados</strong>) e clique em{' '}
              <strong>ZIP em Word</strong> ou <strong>ZIP em PDF</strong>.
            </>,
          ]}
        />
        <Tip>Cada ZIP aceita até 100 documentos. A aba Documentos enviados mostra os originais e as traduções geradas de cada um.</Tip>
        <Figure
          src="entregas"
          alt="Entregas com documentos marcados e os botões ZIP"
          caption="Entregas: marque os documentos e baixe o ZIP em Word ou em PDF."
        />
      </>
    ),
  },
  {
    key: 'history',
    title: 'Meu histórico',
    summary: 'Tudo o que você já finalizou, com número e arquivo final.',
    roles: ['user'],
    target: { area: 'history' },
    body: () => (
      <>
        <Theory>
          <p>
            O histórico guarda as traduções que você finalizou, com o idioma, o número da Tradução Pública (quando houver) e o arquivo final
            para baixar de novo.
          </p>
        </Theory>
        <Practice
          steps={[
            <>Procure pelo arquivo, tipo ou número, ou filtre por idiomas e pela data de conclusão.</>,
            <>
              Use <strong>Ver prévia</strong> para conferir ou <strong>Baixar</strong> para salvar o arquivo final.
            </>,
          ]}
        />
        <Figure src="historico" alt="Tela Meu histórico" caption="Meu histórico: o que você concluiu, com prévia e download." />
      </>
    ),
  },
  {
    key: 'dashboard',
    title: 'Início e indicadores',
    summary: 'Os números do período, a fila agora e os gráficos.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'home' },
    body: (role) => (
      <>
        <Theory>
          <p>
            O Início mostra como{' '}
            {role === 'user' ? 'você está indo' : role === 'leader' ? 'a sua equipe está indo' : 'a organização e cada equipe estão indo'}{' '}
            no período escolhido. Cada número vem com a variação em relação ao período anterior.
          </p>
          <ul className="tutorial-list">
            <li>
              <strong>Acerto de primeira</strong>: traduções concluídas sem pedido para refazer e sem justificativa.
            </li>
            <li>
              <strong>Agora</strong>: a fila neste momento, numa régua por etapa (Processando, Para revisar, Aguardando conclusão e Com
              falha), atualizada a cada 15 segundos.
            </li>
            <li>
              <strong>Gráficos</strong>: tendência por semana, funil do fluxo e outros. Azul é o período atual; ocre, o anterior.
            </li>
          </ul>
        </Theory>
        <Practice
          steps={[
            <>Escolha o período (7 dias, 30 dias, 90 dias, 12 meses ou datas) e, se quiser, desmarque a comparação.</>,
            <>Passe o mouse sobre os gráficos para ver os valores; "Ver tabela" mostra os mesmos números em tabela.</>,
            <>
              Em <strong>Escolher painéis</strong>, escolha os gráficos extras; em <strong>Exportar e imprimir</strong>, baixe o CSV ou
              imprima.
            </>,
          ]}
        />
        {role === 'user' ? (
          <Figure
            src="usuario-inicio"
            alt="Início do Usuário com Meu desenvolvimento"
            caption="O Início do Usuário: a sua produção, as entregas e as revisões."
          />
        ) : (
          <>
            <Figure src="inicio-numeros" alt="Números do período" caption="Os números do período, com a variação." />
            <Figure src="inicio-agora" alt="Fila agora" caption="Agora: a régua da fila por etapa e os últimos eventos." />
            <Figure
              src="inicio-grafico"
              alt="Gráfico de tendência por semana"
              caption="Tendência por semana: período atual em azul, anterior tracejado em ocre."
            />
            <Figure src="inicio-equipes" alt="Aba Equipes do Início" caption="A aba Equipes: entregas e tempos por pessoa." />
          </>
        )}
      </>
    ),
  },
  {
    key: 'teams',
    title: 'Equipes, numeração e auditoria',
    summary: 'Pessoas, números da Tradução Pública, tradutores juramentados e o registro de tudo.',
    roles: ['leader', 'director'],
    target: { area: 'team' },
    body: () => (
      <>
        <Theory>
          <ul className="tutorial-list">
            <li>
              <strong>Pessoas</strong>: quem está em cada equipe e com que papel (Supervisor ou Usuário). O Diretor cria equipes.
            </li>
            <li>
              <strong>Numeração</strong>: os números emitidos por tradutor, as cotas anuais e os pedidos de alteração ou anulação.
            </li>
            <li>
              <strong>Tradutores juramentados</strong>: o cadastro de cada tradutor, a máscara em Word (com os marcadores como{' '}
              <code>{'{{texto}}'}</code>, <code>{'{{numero}}'}</code> e <code>{'{{data}}'}</code>) e a regra de numeração.
            </li>
            <li>
              <strong>Auditoria</strong>: tudo o que aconteceu, com filtros por gravidade, causa, pessoa e período, e as pendências
              operacionais de agora.
            </li>
          </ul>
        </Theory>
        <Practice
          steps={[
            <>
              Em Pessoas, escolha a equipe à esquerda e use <strong>Adicionar pessoas</strong>, <strong>Tornar Supervisor</strong> ou{' '}
              <strong>Remover</strong>.
            </>,
            <>Em Tradutores juramentados, cadastre o tradutor e envie a máscara em Word; cada envio vira uma nova edição.</>,
            <>Em Auditoria, marque "Somente erros e emergências" para ver só o que precisa de atenção.</>,
          ]}
        />
        <div className="tutorial-figures">
          <Figure src="equipes-pessoas" alt="Equipes, aba Pessoas" caption="Pessoas: equipes e membros." />
          <Figure src="equipes-numeracao" alt="Equipes, aba Numeração" caption="Numeração: tradutores, números, cotas e pedidos." />
          <Figure src="equipes-tradutores" alt="Equipes, aba Tradutores juramentados" caption="Tradutores juramentados e as máscaras." />
          <Figure src="equipes-auditoria" alt="Equipes, aba Auditoria" caption="Auditoria: filtros, totais e pendências." />
        </div>
      </>
    ),
  },
  {
    key: 'settings',
    title: 'Ajustes da tradução',
    summary: 'Glossário, regras, tipos de documento, IA e tradução automática.',
    roles: ['leader', 'director'],
    target: { area: 'settings' },
    body: (role) => (
      <>
        <Theory>
          <ul className="tutorial-list">
            <li>
              <strong>Glossário</strong>: traduções aprovadas de termos, por idioma de destino. A revisão automática usa e confere.
            </li>
            <li>
              <strong>Regras</strong>: para cada modalidade e idioma, a fonte, o tamanho, o sufixo do arquivo, as datas, os números e os
              checklists de correção e revisão.
            </li>
            <li>
              <strong>Tipos de documento</strong>: teste um documento novo sem criar tradução e veja se o sistema consegue fazê-lo, e os
              tipos que já passaram pelo sistema.
            </li>
            <li>
              <strong>IA</strong>: auxílio opcional, limitado ao glossário, à diagramação e a orientações. O sistema funciona sem ela.
            </li>
            {role === 'director' && (
              <li>
                <strong>Tradução automática</strong>: o serviço usado (LibreTranslate local e gratuito, DeepL Free ou desligada).
              </li>
            )}
          </ul>
        </Theory>
        <Practice
          steps={[
            <>
              No Glossário, escolha o idioma, preencha o termo em português e a tradução, e clique em <strong>Adicionar</strong>.
            </>,
            <>Em Regras, escolha a modalidade e o idioma, ajuste e salve. Os ajustes valem para as próximas traduções.</>,
            <>
              Em Tipos de documento, use <strong>Escolher arquivo</strong> e <strong>Testar</strong> antes de receber um tipo novo.
            </>,
          ]}
        />
        <div className="tutorial-figures">
          <Figure src="ajustes-glossario" alt="Ajustes, Glossário" caption="Glossário por idioma de destino." />
          <Figure src="ajustes-regras" alt="Ajustes, Regras" caption="Regras por modalidade e idioma." />
          <Figure src="ajustes-tipos" alt="Ajustes, Tipos de documento" caption="Testar um documento novo." />
          <Figure src="ajustes-ia" alt="Ajustes, IA" caption="IA: modelo, governança, habilidades e acesso." />
          {role === 'director' && (
            <Figure src="ajustes-automatica" alt="Ajustes, Tradução automática" caption="Escolha do serviço de tradução automática." />
          )}
        </div>
      </>
    ),
  },
  {
    key: 'admin',
    title: 'Administração',
    summary: 'Quem entra no sistema e com que papel.',
    roles: ['director'],
    target: { area: 'admin' },
    body: () => (
      <>
        <Theory>
          <p>
            Cadastros públicos não acessam nada até um Diretor aprovar. Em Usuários, o Diretor promove a Diretor, revoga sessões, suspende e
            reativa contas. Suspender encerra todas as sessões da pessoa na hora.
          </p>
        </Theory>
        <Practice
          steps={[
            <>
              Em <strong>Cadastros pendentes</strong>, use Aprovar ou Rejeitar.
            </>,
            <>
              Em <strong>Usuários</strong>, filtre pela situação e use as ações de cada pessoa. Tornar Diretor tira a pessoa das equipes.
            </>,
          ]}
        />
        <Figure src="admin-usuarios" alt="Administração, Usuários" caption="Usuários: papéis, sessões e suspensão." />
      </>
    ),
  },
  {
    key: 'account',
    title: 'Notificações e sua conta',
    summary: 'Avisos, preferências, aparência, senha e sessões.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'account' },
    body: () => (
      <>
        <Theory>
          <p>
            As notificações avisam documentos prontos, pedidos para refazer, conclusões, falhas e números. Em Configurações, você escolhe
            como recebê-las: na tela, no Windows ou num resumo agrupado, e com que frequência.
          </p>
        </Theory>
        <Practice
          steps={[
            <>
              Em <strong>Notificações</strong>, alterne entre Não lidas e Todas, filtre por tipo e use Marcar todas como lidas.
            </>,
            <>
              Em <strong>Configurações › Preferências</strong>, ative os avisos, escolha a forma de entrega e os assuntos, e a aparência
              (Claro, Escuro ou Acompanhar o sistema).
            </>,
            <>
              Em <strong>Alterar senha</strong>, use de 12 a 256 caracteres. Em <strong>Minhas sessões</strong>, encerre o acesso de outros
              computadores.
            </>,
          ]}
        />
        <div className="tutorial-figures">
          <Figure src="notificacoes" alt="Tela de notificações" caption="Notificações: não lidas em destaque, com filtros." />
          <Figure src="configuracoes" alt="Configurações da conta" caption="Configurações: avisos e aparência." />
        </div>
      </>
    ),
  },
  {
    key: 'faq',
    title: 'Problemas comuns',
    summary: 'O que fazer quando algo não sai como esperado.',
    roles: ['user', 'leader', 'director'],
    body: (role) => (
      <dl className="tutorial-faq">
        <div>
          <dt>Aparece "Tradução automática indisponível"</dt>
          <dd>
            Os documentos chegam com o texto original, no layout do original, para serem traduzidos manualmente.{' '}
            {role === 'director'
              ? 'Confira o serviço em Ajustes › Tradução automática ou rode "docker compose logs translator".'
              : 'Avise o Diretor.'}
          </dd>
        </div>
        <div>
          <dt>Aparece "O processamento de documentos está parado"</dt>
          <dd>
            Os envios ficam na fila até ele voltar; nada se perde.{' '}
            {role === 'director' ? 'Confira "docker compose ps".' : 'Avise o Diretor.'}
          </dd>
        </div>
        <div>
          <dt>A prévia em Word não carrega</dt>
          <dd>
            Use <strong>Tentar prévia novamente</strong>. Se continuar, use <strong>Baixar para conferir</strong> e compare no seu
            computador antes de registrar a conferência.
          </dd>
        </div>
        <div>
          <dt>O botão de aprovar está apagado</dt>
          <dd>
            Falta marcar "Comparei o original e o Word desta revisão", salvar uma edição pendente ou confirmar o checklist das etapas (em
            Ajustes manuais).
          </dd>
        </div>
        <div>
          <dt>Pronta ou Concluir foi recusada por cota</dt>
          <dd>O limite anual de números acabou para a pessoa, a equipe ou a organização. A liderança ajusta em Equipes › Numeração.</dd>
        </div>
        <div>
          <dt>A tradução está bloqueada depois de três reprovações</dt>
          <dd>Registre uma nova forma de formatação (com nome e explicação) em Registrar nova forma de formatação, na própria tradução.</dd>
        </div>
        <div>
          <dt>Apareceu um aviso pedindo para recarregar</dt>
          <dd>O sistema foi atualizado. Recarregue a página (Ctrl+F5) para usar a versão nova.</dd>
        </div>
      </dl>
    ),
  },
];

export function tutorialFor(role: TutorialRole) {
  return TUTORIAL.filter((section) => section.roles.includes(role));
}

/** Uma seção do tutorial, com o resumo, o conteúdo e o atalho para a tela. */
export function TutorialSection({
  section,
  role,
  onGo,
}: {
  section: TutorialSectionData;
  role: TutorialRole;
  onGo: (target: TutorialTarget) => void;
}) {
  return (
    <article className="tutorial" aria-labelledby={`tutorial-${section.key}`}>
      <header className="tutorial-head">
        <h2 id={`tutorial-${section.key}`}>{section.title}</h2>
        <p className="muted">{section.summary}</p>
        {section.target && (
          <button type="button" className="small" onClick={() => onGo(section.target!)}>
            Abrir esta tela
          </button>
        )}
      </header>
      {section.body(role)}
    </article>
  );
}
