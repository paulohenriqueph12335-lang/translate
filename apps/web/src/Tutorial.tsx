import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Tutorial do sistema: cada seção explica para que serve a tela (teoria), os campos e botões dela, como usar (prática) e
 * mostra fotos reais. As seções e o conteúdo mudam conforme o papel (Usuário, Líder, Diretor); a liderança pode ver o
 * tutorial como os papéis abaixo do seu. O botão "Abrir esta tela" leva direto ao lugar descrito.
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

/** Campos e botões de uma tela, um por linha: o nome como aparece na tela e o que fazer com ele. */
function Fields({ title = 'Campos e botões desta tela', items }: { title?: string; items: Array<[ReactNode, ReactNode] | false> }) {
  return (
    <div className="tutorial-block">
      <h3>{title}</h3>
      <dl className="tutorial-fields">
        {items
          .filter((item): item is [ReactNode, ReactNode] => item !== false)
          .map(([term, description], index) => (
            <div key={index}>
              <dt>{term}</dt>
              <dd>{description}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

/** O que muda nesta tela para o papel de quem lê. */
function RoleNote({ role, children }: { role: TutorialRole; children: ReactNode }) {
  return (
    <div className="tutorial-role-note">
      <strong>No papel de {ROLE_NAME[role]}</strong>
      <div>{children}</div>
    </div>
  );
}

const leads = (role: TutorialRole) => role !== 'user';

/** Quem faz o quê: cada linha é uma ação; as colunas, o que cada papel pode fazer. */
const PERMISSIONS: Array<{ action: string; user: string; leader: string; director: string }> = [
  {
    action: 'Enviar documentos para traduzir',
    user: 'Sim, para a sua equipe',
    leader: 'Sim, para a sua equipe',
    director: 'Sim; a remessa espera você escolher a equipe',
  },
  { action: 'Ver traduções', user: 'As suas e as livres da equipe', leader: 'Todas da sua equipe', director: 'Todas as equipes' },
  { action: 'Assumir um documento sem responsável', user: 'Sim', leader: 'Sim', director: 'Sim' },
  {
    action: 'Editar o texto da tradução',
    user: 'Só as suas',
    leader: 'As suas e as da equipe',
    director: 'Só as suas; no trabalho dos outros, você autoriza',
  },
  { action: 'Conferir, aprovar o Word e concluir', user: 'As suas', leader: 'As da equipe', director: 'Todas' },
  { action: 'Pedir para refazer', user: 'As suas', leader: 'As da equipe', director: 'Todas' },
  { action: 'Reatribuir, processar de novo ou cancelar', user: 'Não', leader: 'Na sua equipe', director: 'Em todas' },
  {
    action: 'Pedir alteração ou anulação de um número',
    user: 'Das suas traduções',
    leader: 'Das suas traduções',
    director: 'Das suas traduções',
  },
  {
    action: 'Decidir pedidos de número',
    user: 'Não',
    leader: 'Da sua equipe',
    director: 'De todas, e também desfazer uma decisão',
  },
  {
    action: 'Cotas de numeração',
    user: 'Vê a sua',
    leader: 'Define a dos Usuários da equipe',
    director: 'Define os limites da organização, das equipes e de cada pessoa',
  },
  {
    action: 'Tradutores juramentados, máscaras, planilhas e livros',
    user: 'Não',
    leader: 'Cadastra e mantém',
    director: 'Consulta e baixa os arquivos',
  },
  {
    action: 'Pessoas e equipes',
    user: 'Não',
    leader: 'Adiciona e remove Usuários da sua equipe',
    director: 'Cria equipes e define quem é Líder ou Usuário',
  },
  {
    action: 'Pedidos de senha',
    user: 'Pede a sua',
    leader: 'Libera Usuários da equipe por 24 horas',
    director: 'Autoriza de vez, para qualquer pessoa',
  },
  { action: 'Auditoria', user: 'Não', leader: 'Das equipes que você lidera', director: 'De tudo' },
  {
    action: 'Glossário',
    user: 'Usa (aplicado sozinho)',
    leader: 'Termos da sua equipe',
    director: 'Termos da organização e das equipes',
  },
  { action: 'Regras e tipos de documento', user: 'Não', leader: 'Sim', director: 'Sim' },
  {
    action: 'IA',
    user: 'Escolhe trabalhar com ou sem',
    leader: 'Modelo, habilidades e acesso da equipe',
    director: 'Tudo isso, e ligar ou desligar',
  },
  { action: 'Serviço de tradução automática', user: 'Não', leader: 'Não', director: 'Sim' },
  { action: 'Administração: cadastros e usuários', user: 'Não', leader: 'Não', director: 'Sim' },
  { action: 'Indicadores do Início', user: 'Os seus', leader: 'Os da equipe e os seus', director: 'Da organização, das equipes e os seus' },
  { action: 'Ver o tutorial como outro papel', user: 'Não', leader: 'Como Usuário', director: 'Como Usuário ou Líder' },
];

export const TUTORIAL: TutorialSectionData[] = [
  {
    key: 'start',
    title: 'Primeiros passos',
    summary: 'O que o sistema faz, os três papéis e o caminho de cada documento.',
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
              <strong>Usuário</strong>: envia documentos, confere a prévia em Word, aprova e conclui as próprias traduções. Vê o próprio
              trabalho, os indicadores dele e o histórico.
            </li>
            <li>
              <strong>Líder</strong> (nas telas de equipe aparece como Supervisor): tudo o que o Usuário faz, mais acompanhar a equipe,
              reatribuir, pedir para refazer, cuidar da numeração, dos tradutores juramentados, do glossário da equipe, das regras e da IA.
            </li>
            <li>
              <strong>Diretor</strong>: acompanha a organização inteira, direciona remessas para as equipes, cria equipes, define limites,
              escolhe o serviço de tradução automática e administra quem entra no sistema.
            </li>
          </ul>
          <p>
            Você está no papel de <strong>{ROLE_NAME[role]}</strong>. A seção <strong>Quem faz o quê</strong> compara os três papéis.
          </p>
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
              <span>o responsável conclui (e numera, na juramentada com tradutor); a liderança só entra em problemas de numeração.</span>
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
              Abra o endereço do sistema no navegador e entre com o seu e-mail e a sua senha. Quem ainda não tem conta usa{' '}
              <strong>Solicitar acesso</strong> (nome, e-mail e senha); o cadastro fica pendente até um Diretor aprovar.
            </>,
            <>
              Esqueceu a senha? Use <strong>Esqueci a senha</strong>, escolha uma senha nova e avise a liderança (veja Esqueci a senha).
            </>,
            <>
              Depois de entrar, você cai no <strong>Início</strong>.{' '}
              {role === 'user'
                ? 'Para trabalhar, vá em Traduzir; o que você já concluiu fica em Meu histórico.'
                : role === 'leader'
                  ? 'O trabalho do dia a dia fica em Traduções; a gestão da equipe, em Equipe e Ajustes.'
                  : 'O trabalho fica em Traduções; a gestão, em Equipes, Ajustes e Administração.'}
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
    key: 'roles',
    title: 'Quem faz o quê',
    summary: 'O que o Usuário, o Líder e o Diretor podem fazer, lado a lado.',
    roles: ['user', 'leader', 'director'],
    body: (role) => (
      <>
        <Theory>
          <p>
            O sistema decide o que cada pessoa pode fazer pelo papel dela, e o mesmo vale na tela: um botão que não é do seu papel não
            aparece. Esta tabela mostra as diferenças. A coluna do seu papel é a de <strong>{ROLE_NAME[role]}</strong>.
          </p>
        </Theory>
        <div className="table-wrap tutorial-compare">
          <table>
            <thead>
              <tr>
                <th scope="col">O que fazer</th>
                <th scope="col" className={role === 'user' ? 'current' : undefined}>
                  Usuário
                </th>
                <th scope="col" className={role === 'leader' ? 'current' : undefined}>
                  Líder
                </th>
                <th scope="col" className={role === 'director' ? 'current' : undefined}>
                  Diretor
                </th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((row) => (
                <tr key={row.action}>
                  <th scope="row">{row.action}</th>
                  <td className={role === 'user' ? 'current' : undefined}>{row.user}</td>
                  <td className={role === 'leader' ? 'current' : undefined}>{row.leader}</td>
                  <td className={role === 'director' ? 'current' : undefined}>{row.director}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Tip>
          Uma pessoa pode ser Líder numa equipe e Usuário em outra: em cada equipe vale o papel que ela tem ali. O Diretor não ocupa papel
          em equipe; ele já acompanha todas.
        </Tip>
        {role !== 'user' && (
          <Tip>
            No topo de cada seção do tutorial, <strong>Ver o tutorial como</strong> mostra o que{' '}
            {role === 'director' ? 'um Usuário ou um Líder vê' : 'um Usuário vê'}. Use para orientar a sua equipe.
          </Tip>
        )}
      </>
    ),
  },
  {
    key: 'navigate',
    title: 'Navegar pelo sistema',
    summary: 'Menu, pesquisa com Ctrl+K, atalhos de teclado, sino de avisos, tema claro ou escuro e o uso no celular.',
    roles: ['user', 'leader', 'director'],
    body: (role) => (
      <>
        <Theory>
          <p>
            O <strong>menu lateral</strong> agrupa as áreas em Visão geral, Operação e Gestão, e Minha conta no pé (Notificações, Tutorial,
            Configurações e Sair). Dentro de cada área, as telas parecidas ficam em abas logo abaixo do título. Em Ajustes, Administração e
            Configurações, as telas ficam num menu à esquerda.
          </p>
          <p>
            O seu menu tem:{' '}
            {role === 'user'
              ? 'Início, Traduzir e Meu histórico.'
              : role === 'leader'
                ? 'Início, Traduções, Equipe e Ajustes.'
                : 'Início, Traduções, Equipes, Ajustes e Administração.'}
          </p>
          <p>A barra superior tem quatro atalhos:</p>
          <ul className="tutorial-list">
            <li>
              <strong>Pesquisa</strong> (ou <kbd>Ctrl</kbd> + <kbd>K</kbd> de qualquer lugar): acha telas, protocolos e documentos
              {role === 'user' ? '' : ' e, para a liderança, pessoas, equipes, fases e registros'}. Acentos e maiúsculas não importam.
            </li>
            <li>
              <strong>Sino</strong>: as notificações recentes, separadas em "Precisa de você" e "Atualizações".
            </li>
            <li>
              <strong>Lua / sol</strong>: troca entre o tema claro e o escuro. A escolha fica salva na sua conta.
            </li>
            <li>
              <strong>Suas iniciais</strong>: o seu nome, o seu papel, Configurações, Atalhos de teclado e Sair.
            </li>
          </ul>
          <p>
            <strong>Atalhos de teclado</strong> têm no máximo duas teclas. Passe o mouse numa ação para ver o atalho dela. Os principais:
          </p>
          <ul className="tutorial-list">
            <li>
              <kbd>G</kbd> e depois a letra da área: <kbd>I</kbd> Início, <kbd>T</kbd> Traduções,{' '}
              {role === 'user' ? (
                <>
                  <kbd>H</kbd> Meu histórico,
                </>
              ) : (
                <>
                  <kbd>E</kbd> Equipe, <kbd>A</kbd> Ajustes,
                </>
              )}{' '}
              {role === 'director' && (
                <>
                  <kbd>D</kbd> Administração,{' '}
                </>
              )}
              <kbd>N</kbd> Notificações, <kbd>U</kbd> Tutorial, <kbd>C</kbd> Configurações e <kbd>Z</kbd> Entregas e ZIP.
            </li>
            <li>
              <kbd>N</kbd> Nova tradução, <kbd>/</kbd> ou <kbd>Ctrl</kbd> + <kbd>K</kbd> pesquisa, <kbd>B</kbd> sino e <kbd>T</kbd> tema.
            </li>
            <li>
              <kbd>[</kbd> e <kbd>]</kbd> trocam de aba. Na revisão, <kbd>Ctrl</kbd> + <kbd>S</kbd> salva as alterações.
            </li>
            <li>
              <kbd>?</kbd> mostra a lista completa. Os atalhos de uma tecla não valem enquanto você digita num campo.
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
            <>
              Aperte <kbd>?</kbd> para ver todos os atalhos. Experimente <kbd>G</kbd> e depois <kbd>T</kbd> para ir às traduções.
            </>,
            <>
              No celular, as três primeiras áreas ficam na barra de baixo; o restante (
              {role === 'director' ? 'Ajustes, Administração, ' : role === 'leader' ? 'Ajustes, ' : ''}Notificações, Tutorial, Configurações
              e Sair) fica em <strong>Mais</strong>.
            </>,
            <>
              No celular, nada fica escondido na borda da tela: as abas e os submenus quebram em linhas e as tabelas aparecem como cartões,
              com o nome de cada coluna acima do valor.
            </>,
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
          <Figure src="conta" alt="Menu da conta aberto" caption="Menu da conta: quem está conectado, Configurações, atalhos e Sair." />
          <Figure
            src="atalho-dica"
            alt="Dica de atalho ao passar o mouse no menu"
            caption="Passe o mouse numa ação: a dica mostra o atalho."
          />
          <Figure src="atalhos" alt="Lista de atalhos de teclado" caption="A lista completa de atalhos, com a tecla ?." />
          <Figure src="tema-escuro" alt="Sistema no tema escuro" caption="O mesmo sistema no tema escuro." />
          <Figure
            src="celular"
            alt="Sistema no celular com a barra inferior"
            caption="No celular: barra de baixo com as áreas principais."
            narrow
          />
          <Figure src="celular-mais" alt="Folha Mais aberta no celular" caption="Em Mais: as demais áreas, a sua conta e Sair." narrow />
        </div>
      </>
    ),
  },
  {
    key: 'send',
    title: 'Enviar uma nova tradução',
    summary: 'Modalidade, arquivos, protocolo, tipo, idiomas, equipe e a conferência antes de começar.',
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
            A aba <strong>Nova tradução</strong> abre com a lista dos envios: o que foi enviado, quem enviou e a situação de cada documento.
            O botão <strong>Nova tradução</strong> começa um envio novo, em quatro etapas. Os botões <strong>Voltar</strong>,{' '}
            <strong>Continuar</strong> e <strong>Cancelar</strong> ficam presos no pé da tela, com a etapa em que você está e o que falta
            para continuar.
          </p>
        </Theory>
        <Fields
          title="Campos do envio"
          items={[
            [
              'Modalidade da tradução',
              'Juramentada, Certificada, Técnica ou Simples. O tradutor juramentado e a máscara são escolhidos só na conclusão.',
            ],
            [
              'Arquivos',
              'Arraste para a área tracejada ou clique nela. Aceita PDF, Word, PowerPoint e imagens; os limites de tamanho aparecem na tela. O X tira um arquivo da lista.',
            ],
            ['Nome do envio (opcional)', 'Um nome para você achar a remessa depois, por exemplo o nome do cliente.'],
            [
              'Protocolo',
              'Identifica a remessa: entra no começo do nome dos arquivos de Word e PDF e pode ser pesquisado. Aceita letras, números, espaço, ponto, hífen e sublinhado.',
            ],
            [
              'Sem protocolo',
              'Marque quando o pedido não tem protocolo e escreva o motivo (por exemplo, "o cliente não informou"). O motivo fica registrado.',
            ],
            [
              'Tipo documental e modelo',
              'Deixe em Automático quando a remessa tiver documentos diferentes. O sistema reconhece certidões de nascimento, casamento e óbito, CNN (certidão negativa de naturalização), antecedentes criminais, atestados médicos e outros atestados e declarações, certidões de conselho (CFM, CRM, OAB), divórcio, procuração, ementa e plano de ensino, além de identidade, CNH, histórico, diploma, apostila, contrato e fatura.',
            ],
            ['Traduzir de / para', 'O par de idiomas, sempre com o português de um dos lados: inglês, francês, italiano ou espanhol.'],
            role === 'director'
              ? [
                  'Equipe',
                  'Como Diretor, a remessa nasce sem equipe e fica em "Aguardando direcionamento" até você escolher a equipe de destino na lista de envios.',
                ]
              : ['Equipe', 'Aparece só para quem está em mais de uma equipe. Com uma equipe só, a remessa vai direto para ela.'],
            [
              'Inspeção',
              'Remessas com 20 arquivos ou mais pedem a inspeção: de todos os documentos ou de uma amostra com os 10 primeiros.',
            ],
            ['Confira sua nova tradução', 'O resumo da etapa 4. Confira e use Iniciar tradução.'],
          ]}
        />
        <Fields
          title="Lista de envios"
          items={[
            ['Buscar protocolo, envio, pessoa ou arquivo', 'Acha um envio pelo que você lembra dele.'],
            ['Todos, Envio pendente, Envio concluído', 'Mostra os envios pela situação do envio dos arquivos.'],
            ['Só os meus', 'Esconde os envios das outras pessoas da equipe.'],
            role === 'director' && [
              'Equipe e Aguardando direcionamento',
              'Filtra por equipe. Nas remessas aguardando direcionamento, escolha a equipe de destino para liberar a tradução. Ao mudar a remessa de equipe, quem era da equipe anterior deixa de ser responsável e a nova equipe assume.',
            ],
            [
              'Cancelar pendentes / Cancelar documento',
              role === 'user'
                ? 'Cancela documentos que você enviou e que ainda não foram traduzidos.'
                : 'Cancela documentos ainda não traduzidos; a liderança cancela os de qualquer pessoa da equipe.',
            ],
            ['Abrir a tradução', 'Vai para a tradução de cada documento.'],
          ]}
        />
        <Practice
          title="Na prática: as quatro etapas"
          steps={[
            <>
              <strong>Modalidade e documentos</strong>: escolha a modalidade e arraste os arquivos.
            </>,
            <>
              <strong>Identificação e protocolo</strong>: digite o protocolo (ou marque Sem protocolo e escreva o motivo), o nome opcional e
              o tipo de documento.
            </>,
            <>
              <strong>Idiomas e equipe</strong>: escolha o par de idiomas
              {role === 'director' ? '. A equipe você escolhe depois de iniciar.' : ' e, se aparecer, a equipe.'}
            </>,
            <>
              <strong>Conferência do envio</strong>: confira o resumo e clique em <strong>Iniciar tradução</strong>. A partir daí, tradução
              e revisão são automáticas; a prévia em Word aparece sozinha.
            </>,
          ]}
        />
        <Tip>Se Continuar estiver apagado, leia a linha logo abaixo dos botões: ela diz o que falta nesta etapa.</Tip>
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
    summary: 'O que está com você, o que espera por você, o que a equipe pode assumir e a escolha de usar a IA.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'work', tab: 'mine' },
    body: (role) => (
      <>
        <Theory>
          <p>
            Cada tradução tem um <strong>responsável</strong>: quem enviou ou quem assumiu.{' '}
            {role === 'director'
              ? 'Você edita só o que é seu; no trabalho dos outros, você autoriza (conclui, pede para refazer e reatribui).'
              : role === 'leader'
                ? 'Você edita as suas e as da sua equipe.'
                : 'Você edita e conclui as suas. Colegas da mesma equipe veem o trabalho uns dos outros, mas não alteram.'}
          </p>
        </Theory>
        <Fields
          items={[
            ['Nova tradução', 'Começa um envio (atalho N).'],
            ['Para revisar', 'Quantas prévias em Word esperam a sua conferência, e quantas estão em outras etapas.'],
            [
              'Minha numeração',
              'Quantos números da Tradução Pública você usou no ano e a sua cota (ou "sem limite"). Quando a cota acaba, Concluir fica bloqueado.',
            ],
            ['Notificações novas', 'Quantas notificações você não leu; "ver todas" abre Notificações.'],
            [
              'Preferência de uso da IA: Com IA / Sem IA',
              'Escolhe se o Auxílio da IA aparece nas suas traduções (glossário, diagramação e dúvidas). Vale para os protocolos criados daqui em diante e funciona só com a IA ligada e o seu acesso liberado pela liderança.',
            ],
            ['Comigo', 'As suas traduções em andamento. Clique numa para abrir a conferência.'],
            ['Disponíveis para assumir', 'As traduções da equipe sem responsável. Assumir faz a tradução passar a ser sua.'],
            ['Prévia das últimas notificações', 'As cinco notificações mais recentes, para agir sem sair da tela.'],
          ]}
        />
        <Practice
          steps={[
            <>Comece pelo número "Para revisar": são as prévias em Word esperando a sua conferência.</>,
            <>Clique numa tradução da lista para abrir a conferência.</>,
            <>
              Para pegar um documento livre da equipe, use <strong>Assumir</strong> em "Disponíveis para assumir".
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
    key: 'team-list',
    title: 'Traduções da equipe',
    summary: 'A lista completa por fase, os filtros, a reatribuição e os tipos novos.',
    roles: ['leader', 'director'],
    target: { area: 'work', tab: 'team' },
    body: (role) => (
      <>
        <Theory>
          <p>
            A aba <strong>{role === 'director' ? 'Todas as traduções' : 'Da equipe'}</strong> mostra{' '}
            {role === 'director' ? 'as traduções de todas as equipes' : 'todas as traduções da sua equipe'}, organizadas numa régua de fases
            com a contagem de cada uma: Produção, Conferência, Aprovação, Entrega, Pendências e Todas. A miniatura da linha do fluxo em cada
            documento mostra onde ele está.
          </p>
        </Theory>
        <Fields
          items={[
            ['Régua de fases', 'Clique numa fase para ver só os documentos dela. "3. Aprovação" é onde a liderança decide e numera.'],
            ['Buscar protocolo, arquivo, remessa, tipo ou número', 'Acha qualquer documento.'],
            role === 'director' && ['Equipe', 'Filtra por equipe, ou "Sem equipe (aguardando direcionamento)".'],
            ['Tipo de documento e Categoria e modelo documental', 'Filtram pelo tipo escrito no documento e pela categoria do sistema.'],
            ['Modalidade e Idiomas', 'Filtram pela modalidade e pelo par de idiomas.'],
            ['Recebidas: de / até', 'Filtram pela data de recebimento.'],
            ['Só tipos novos', 'Mostra os documentos de um tipo que o sistema ainda não traduziu antes: confira com mais atenção.'],
            ['Limpar filtros', 'Volta a mostrar tudo.'],
            [
              'Etiquetas Tipo novo, Sem responsável e Número anulado',
              'Avisam o que precisa de atenção em cada linha. Sem responsável: alguém precisa assumir.',
            ],
            ['Caixa de seleção e ZIP', 'Marque documentos concluídos para baixar em ZIP (até 100 por vez).'],
          ]}
        />
        <Practice
          steps={[
            <>Escolha a fase na régua e use os filtros para chegar ao documento.</>,
            <>
              Abra o documento. Para mudar o responsável, use <strong>Reatribuir…</strong> em Ajustes manuais e escolha a pessoa da equipe
              {role === 'director' ? (
                <>
                  , ou <strong>Eu (Diretor)</strong> para assumir e editar você mesmo
                </>
              ) : null}
              .
            </>,
            <>Em "Pendências", veja o que falhou ou está parado e decida: processar de novo, pedir para refazer ou cancelar.</>,
          ]}
        />
        <Figure
          src="lista-fases"
          alt="Lista de traduções com a régua de fases"
          caption="Traduções: fases com contagem, filtros e a lista com a linha do fluxo de cada documento."
        />
      </>
    ),
  },
  {
    key: 'review',
    title: 'Conferir e aprovar',
    summary: 'A comparação lado a lado, a conferência, os dados do documento e os ajustes manuais.',
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
            A barra <strong>Próximo passo</strong>, presa no pé da tela, acompanha você enquanto compara. Ela mostra a etapa atual (por
            exemplo, "Etapa 4 de 6 · Prévia em Word"), o que falta e os botões que levam adiante.
          </p>
        </Theory>
        <Fields
          title="Barra Próximo passo e conferência"
          items={[
            ['Assumir documento', 'Aparece quando ninguém é responsável. Assuma para conferir e concluir.'],
            ['Comparei o original e o Word', 'Registra que você comparou os dois. Sem ela, aprovar fica apagado.'],
            [
              'Aprovar e concluir / Aprovar Word',
              'Aprova o Word. Quem pode concluir segue direto para a conclusão; os outros deixam a tradução pronta para concluir.',
            ],
            [
              'Reprovar…',
              'Abre a conferência com o formulário: marque as fases que falharam (correção, tradução, diagramação ou revisão) e descreva o que precisa ser refeito.',
            ],
            ['Salvar alterações', 'Aparece quando há texto editado e não salvo (ou Ctrl + S).'],
            ['Concluir', 'Aparece com a tradução pronta. Leva ao painel de conclusão.'],
            ['Baixar Word / Baixar PDF', 'Aparecem depois de concluída.'],
            ['Pontos para conferir', 'O que a revisão automática não resolveu sozinha. Clique para ver a lista.'],
          ]}
        />
        <Fields
          title="Dados e opções do documento"
          items={[
            ['Tempos do documento', 'Quando chegou, quanto levou cada etapa, a conclusão e os downloads.'],
            [
              'Tipo documental e modelo',
              'O tipo que o sistema reconheceu e a confiança. Se estiver errado, escolha o tipo certo e escreva o motivo; a sua escolha passa a valer.',
            ],
            [
              'Corrigir idiomas da documentação',
              'Se o envio foi feito com o par errado, escolha o idioma original e o da tradução e escreva o motivo. O documento é processado de novo no par certo.',
            ],
            ['Histórico de conferências', 'Quem conferiu, quando, e o que foi aprovado ou reprovado em cada revisão.'],
          ]}
        />
        <Fields
          title="Ajustes manuais"
          items={[
            [
              'Editar texto',
              role === 'director'
                ? 'Edita o texto quando a tradução é sua. Escolha o bloco, o alinhamento (à esquerda, centralizado, à direita ou justificado) e mova blocos para cima ou para baixo.'
                : 'Edita o texto: escolha o bloco, o alinhamento (à esquerda, centralizado, à direita ou justificado) e mova blocos para cima ou para baixo.',
            ],
            ['Salvar alterações / Descartar', 'Grava ou desfaz o que você editou.'],
            ['Revisão automática', 'Roda de novo as correções de idioma, números, datas, glossário e marcadores.'],
            ['Salvar e voltar à conferência', 'Grava as alterações e devolve a tradução para a conferência.'],
            ['Correções feitas', 'A lista do que a revisão automática corrigiu, com o antes e o depois.'],
            [
              'Registrar nova forma de formatação',
              'Depois de três reprovações seguidas, a tradução fica bloqueada. Dê um nome à nova formatação, explique o que mudou e registre para liberar.',
            ],
            [
              'Auxílio da IA',
              'Se você trabalha com IA: tire dúvidas sobre o processo e veja a sugestão de diagramação, para aceitar ou recusar.',
            ],
            ['Baixar prévia (DOCX) / Baixar original', 'Abre os arquivos no seu computador, se a prévia não carregar.'],
            leads(role) && [
              'Reatribuir…',
              role === 'director'
                ? 'Passa a tradução para outra pessoa da equipe ou para você ("Eu (Diretor)"), que passa a poder editá-la.'
                : 'Passa a tradução para outra pessoa da equipe.',
            ],
            leads(role) && ['Processar de novo', 'Manda de volta para a fila uma tradução que falhou ou que precisa ser refeita do zero.'],
          ]}
        />
        <Practice
          steps={[
            <>Abra a tradução e compare o original com o Word, página por página. Não precisa rolar até o fim para agir.</>,
            <>
              Se estiver certo, marque <strong>Comparei o original e o Word</strong> e use <strong>Aprovar e concluir</strong>.
            </>,
            <>
              Se algo estiver errado, use <strong>Reprovar…</strong>, marque as fases e escreva o que precisa mudar. Ou corrija você mesmo
              em <strong>Ajustes manuais</strong>.
            </>,
          ]}
        />
        {role === 'director' && (
          <RoleNote role={role}>
            No trabalho de outras pessoas, você não edita o texto: você aprova, conclui, pede para refazer ou reatribui. Para editar, assuma
            ou reatribua a tradução a você.
          </RoleNote>
        )}
        {role === 'leader' && (
          <RoleNote role={role}>
            Você edita e aprova as traduções de qualquer pessoa da sua equipe, reatribui e manda processar de novo. O Diretor só autoriza no
            trabalho dos outros.
          </RoleNote>
        )}
        <Figure
          src="detalhe-topo"
          alt="Topo da tradução com a linha do fluxo e a barra Próximo passo"
          caption="O topo da tradução: título, situação, responsável, a linha do fluxo e, no pé, a barra Próximo passo."
        />
        <Figure
          src="proximo-passo"
          alt="Barra Próximo passo durante a comparação"
          caption="Comparando o original e o Word: a barra Próximo passo fica à vista, com a conferência e a aprovação."
        />
        <Figure src="comparacao" alt="Original e Word lado a lado" caption="Original e prévia em Word lado a lado, com páginas e zoom." />
        <Figure
          src="conferencia"
          alt="Conferência antes da aprovação"
          caption="A conferência: confirme a comparação ou reprove indicando as fases."
        />
      </>
    ),
  },
  {
    key: 'conclude',
    title: 'Concluir e numerar',
    summary: 'Com ou sem tradutor juramentado, número, livro e folha, refazer e pedidos de número.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'work', tab: 'mine' },
    body: (role) => (
      <>
        <Theory>
          <p>
            Concluir libera o Word e o PDF finais. Quem conclui é o responsável pela tradução; o Líder da equipe e o Diretor também podem, e
            só precisam agir em problemas de numeração (número repetido, fora da sequência e pedidos de alteração).
          </p>
          <p>
            As <strong>cotas</strong> anuais limitam quantos números cada pessoa, equipe ou a organização pode emitir. Quando um limite
            acaba, Pronta e Concluir ficam bloqueadas; a liderança é avisada aos 80% e aos 100%.
          </p>
        </Theory>
        <Fields
          title="Concluir tradução"
          items={[
            [
              'Tradutor juramentado: Com tradutor',
              'Na juramentada, o Word sai na máscara do tradutor, com número, livro e folha pela regra de numeração dele. Escolha o tradutor.',
            ],
            ['Tradutor juramentado: Sem tradutor', 'O Word sai no layout do original, sem máscara e sem número.'],
            ['Número, livro e folha', 'Sugeridos pela regra do tradutor. Confira antes de concluir.'],
            [
              'Motivo',
              'Aparece quando algo foge da regra (por exemplo, número fora da sequência ou ainda há pontos para conferir). Explique; fica registrado.',
            ],
            ['Checklist das etapas', 'Confirme cada item das etapas da modalidade.'],
            ['Concluir e liberar download', 'Gera o Word e o PDF finais e avisa quem enviou e quem revisou.'],
          ]}
        />
        <Fields
          title="Refazer e número"
          items={[
            ['Refazer…', 'Marque as fases com falha e escreva o que precisa ser refeito. A tradução volta para Para revisar.'],
            [
              'Alterar ou anular número…',
              'Depois de concluída, peça para alterar (novo número, livro ou folha) ou anular o número, com o motivo. Um número emitido nunca some: o pedido fica registrado.',
            ],
            leads(role) && [
              'Decidir o pedido',
              'Os pedidos chegam em Equipe › Numeração › Cotas e pedidos para a liderança aprovar ou recusar.',
            ],
          ]}
        />
        <Practice
          steps={[
            <>Abra a tradução em Aguardando conclusão.</>,
            <>
              Use <strong>Concluir</strong> na barra Próximo passo (ou <strong>Aprovar e concluir</strong>).
            </>,
            <>Na juramentada, escolha com ou sem tradutor; com tradutor, confira o número, o livro e a folha sugeridos.</>,
            <>
              Clique em <strong>Concluir e liberar download</strong>.
            </>,
          ]}
        />
        {role === 'user' && (
          <RoleNote role={role}>
            Você conclui as suas traduções. Se a cota acabar ou o número sair errado, avise o Líder: ele ajusta a cota e decide os pedidos
            de número.
          </RoleNote>
        )}
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
    summary: 'Baixar o Word e o PDF finais, um a um ou em lote, e os documentos enviados.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'work', tab: 'done' },
    body: (role) => (
      <>
        <Theory>
          <p>
            <strong>Entregas e ZIP</strong> reúne as traduções concluídas e os documentos enviados, sempre ligados entre si. No ZIP, cada
            arquivo leva o <strong>número da tradução e o protocolo</strong>, por exemplo "0012-2026 – ABC-1". Sem número, leva o protocolo
            e a referência da tradução, como "ABC-1 – Tradução 7"; sem os dois, só "Tradução 7".
          </p>
        </Theory>
        <Fields
          items={[
            ['Traduções concluídas / Documentos enviados', 'O que listar: as traduções prontas ou os originais enviados.'],
            ['Protocolo, arquivo, lote, tipo ou nº', 'Acha pelo que você lembra. "Tradução 7" ou só "7" acha pela referência.'],
            role === 'director' && ['Equipe', 'Filtra por equipe.'],
            ['Tipo de documento e Idiomas', 'Filtram pelo tipo e pelo par de idiomas.'],
            ['Concluída por', 'Filtra por quem concluiu.'],
            ['Concluídas: de / até', 'Filtram pela data de conclusão.'],
            [
              'Formato e Situação da tradução',
              'Na aba Documentos enviados: o tipo de arquivo e se já há tradução, em andamento ou com falha.',
            ],
            ['Salvar arquivos', 'Na linha de cada tradução: Word ou PDF.'],
            ['Salvar original', 'Na aba Documentos enviados: baixa o arquivo enviado.'],
            ['Selecionar resultados carregados', 'Marca de uma vez tudo o que está na lista.'],
            ['ZIP em Word / ZIP em PDF', 'Baixa os marcados num ZIP, em pastas por protocolo, par de idiomas e formato. Até 100 por ZIP.'],
          ]}
        />
        <Practice
          steps={[
            <>Use os filtros para achar as traduções.</>,
            <>
              Para um documento, use <strong>Salvar arquivos</strong> na linha dele.
            </>,
            <>
              Para várias, marque as caixas e clique em <strong>ZIP em Word</strong> ou <strong>ZIP em PDF</strong>.
            </>,
          ]}
        />
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
        <Fields
          items={[
            ['Arquivo, tipo ou nº (0001/2026)', 'Acha pelo nome do arquivo, pelo tipo ou pelo número.'],
            ['Idiomas', 'Filtra pelo par de idiomas.'],
            ['Concluídas: de / até', 'Filtra pela data de conclusão.'],
            ['Ver prévia / Baixar', 'Confere ou salva o arquivo final.'],
          ]}
        />
        <Figure src="historico" alt="Tela Meu histórico" caption="Meu histórico: o que você concluiu, com prévia e download." />
      </>
    ),
  },
  {
    key: 'dashboard',
    title: 'Início e indicadores',
    summary: 'Os números do período, a fila agora, os gráficos e as comparações.',
    roles: ['user', 'leader', 'director'],
    target: { area: 'home' },
    body: (role) => (
      <>
        <Theory>
          <p>
            O Início mostra como{' '}
            {role === 'user' ? 'você está indo' : role === 'leader' ? 'a sua equipe está indo' : 'a organização e cada equipe estão indo'}{' '}
            no período escolhido. Cada número vem com a variação em relação ao período anterior. As abas do seu Início:
          </p>
          <ul className="tutorial-list">
            {role === 'director' && (
              <>
                <li>
                  <strong>Organização</strong>: concluídas, recebidas, acerto de primeira, tempo até concluir, a fila agora e os gráficos da
                  organização (idiomas, tipos de documento, acertos e erros por tipo, equipes, pessoas e numeração do ano).
                </li>
                <li>
                  <strong>Erros × acertos</strong>: produção, retrabalho, conferências humanas, causas de falha técnica e os documentos do
                  período, por equipe.
                </li>
              </>
            )}
            {role !== 'user' && (
              <>
                <li>
                  <strong>{role === 'director' ? 'Equipes' : 'Equipe'}</strong>: a fila agora, tendência, funil, pessoas por semana,
                  entregas e tempo de revisão por pessoa, documentos e numeração dos tradutores.
                </li>
                <li>
                  <strong>Com IA × sem IA</strong>: compara recebidos, concluídos, acerto de primeira e tempo até concluir dos protocolos
                  feitos com e sem IA.
                </li>
              </>
            )}
            <li>
              <strong>Meu desenvolvimento</strong>: a sua produção, acertos e retrabalho, conferências e fases, causas de falha e os seus
              documentos.
            </li>
          </ul>
        </Theory>
        <Fields
          items={[
            ['7 dias, 30 dias, 90 dias, 12 meses, Datas', 'O período. Em Datas, escolha o começo e o fim.'],
            ['Comparar com o período anterior', 'Mostra a variação de cada número.'],
            role === 'director' && ['Toda a organização / Equipe', 'Escolhe a equipe dos números.'],
            ['Idiomas e Modalidade', 'Filtram os indicadores de desenvolvimento.'],
            role === 'director' && ['Pesquisar documentos no relatório', 'Acha um documento do período pelo protocolo, arquivo ou pessoa.'],
            [
              'Agora',
              'A fila neste momento (Processando, Para revisar, Aguardando conclusão e Com falha), atualizada a cada 15 segundos. Pausar congela.',
            ],
            ['Escolher painéis', 'Escolhe quais gráficos aparecem. Restaurar painéis principais volta ao padrão.'],
            ['Ampliar, ↑, ↓, Ocultar', 'Em cada gráfico: aumenta, muda a ordem ou esconde.'],
            ['Ver tabela', 'Mostra os números do gráfico em tabela.'],
            [
              'Exportar',
              role === 'user'
                ? 'Exportar indicadores CSV baixa os seus números.'
                : 'CSV (por pessoa ou por documento) e Imprimir / PDF; em Erros × acertos e Meu desenvolvimento, Exportar indicadores CSV.',
            ],
          ]}
        />
        <Tip>Passe o mouse sobre os gráficos para ver os valores. Azul é o período atual; ocre tracejado, o anterior.</Tip>
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
    key: 'people',
    title: 'Equipe e pedidos de senha',
    summary: 'Quem está em cada equipe, com que papel, e os pedidos de senha nova.',
    roles: ['leader', 'director'],
    target: { area: 'team', tab: 'people' },
    body: (role) => (
      <>
        <Theory>
          <p>
            {role === 'director'
              ? 'Você cria equipes e define quem é Líder (Supervisor) ou Usuário em cada uma.'
              : 'Você acompanha as equipes que lidera e adiciona ou remove Usuários delas. Quem vira Líder é decisão do Diretor.'}{' '}
            Ninguém altera o próprio papel.
          </p>
        </Theory>
        <Fields
          title="Pessoas"
          items={[
            role === 'director' && ['Nome da nova equipe / Criar equipe', 'Cria uma equipe.'],
            ['Buscar equipe', 'Acha a equipe na lista da esquerda.'],
            [
              role === 'director' ? 'Todas, Sem membros' : 'Todas, Lidero, Opero',
              role === 'director' ? 'Filtra as equipes.' : 'Mostra as equipes em que você é Líder ou Usuário.',
            ],
            ['Membros / Adicionar pessoas', 'Lista quem está na equipe ou acrescenta pessoas ativas.'],
            ['Adicionar como', role === 'director' ? 'Usuário ou Supervisor (Líder).' : 'Usuário. Só o Diretor adiciona Líderes.'],
            ['Buscar por nome ou e-mail, Todas as funções, Qualquer situação', 'Filtram os membros.'],
            role === 'director' && ['Tornar Supervisor / Tornar Usuário', 'Muda o papel da pessoa nesta equipe.'],
            [
              'Remover',
              `${role === 'director' ? 'Tira a pessoa da equipe.' : 'Tira um Usuário da equipe.'} As traduções em aberto dela ficam sem responsável e aparecem em "Disponíveis para assumir".`,
            ],
          ]}
        />
        <Fields
          title="Pedidos de senha"
          items={[
            [
              role === 'director' ? 'Autorizar' : 'Liberar 24 h',
              role === 'director'
                ? 'Autoriza a senha nova de vez, com o Token do Diretor. Vale para qualquer pessoa, menos você.'
                : 'Libera a senha nova por 24 horas, com o Token do Líder. Só para Usuários das suas equipes, até 3 vezes seguidas.',
            ],
            ['Recusar', 'Nega o pedido. A pessoa continua com a senha antiga.'],
          ]}
        />
        <Tip>
          Confirme com a pessoa, por telefone ou pessoalmente, antes de autorizar: quem tem o pedido aprovado entra com a senha que
          escolheu.
        </Tip>
        <div className="tutorial-figures">
          <Figure src="equipes-pessoas" alt="Equipes, aba Pessoas" caption="Pessoas: equipes e membros." />
          <Figure src="pedidos-senha" alt="Pedidos de senha na tela Equipe" caption="Pedidos de senha: liberar, autorizar ou recusar." />
        </div>
      </>
    ),
  },
  {
    key: 'numbering',
    title: 'Numeração e tradutores',
    summary: 'Cotas, pedidos de número, cadastro dos tradutores, máscaras, planilhas de números e livros.',
    roles: ['leader', 'director'],
    target: { area: 'team', tab: 'numbering' },
    body: (role) => (
      <>
        <Theory>
          <p>
            A numeração da Tradução Pública segue a regra de cada tradutor juramentado. Quem cadastra os tradutores, envia as máscaras e
            configura os números são os <strong>Líderes</strong>. O Diretor define os limites e decide os pedidos.
          </p>
        </Theory>
        <Fields
          title="Numeração › Cotas e pedidos"
          items={[
            ['Ano', 'O ano das cotas e dos números.'],
            ['Minha cota', 'Quantos números você usou e o seu limite.'],
            role === 'director' && ['Organização e equipes', 'O limite anual da organização e de cada equipe. Vazio é "sem limite".'],
            [
              'Cota por pessoa',
              role === 'director'
                ? 'O limite anual de cada pessoa (1 a 1000).'
                : 'O limite anual de cada Usuário das suas equipes (1 a 1000).',
            ],
            [
              'Pedidos de alteração e anulação',
              role === 'director'
                ? 'Aprove ou recuse os pedidos. Só o Diretor desfaz uma decisão e volta a numeração anterior: com mais de um pedido autorizado no mesmo número, desfaça do mais recente para o mais antigo. Depois que a tradução é reaberta, a decisão não se desfaz.'
                : 'Aprove ou recuse os pedidos das suas equipes.',
            ],
          ]}
        />
        <Fields
          title="Numeração › Tradutores e números"
          items={[
            ['Regra de numeração', 'Como numerar, a sigla, desde quando somar as assinaturas, os idiomas e o lembrete na conclusão.'],
            [
              'Números (planilhas)',
              'Envie a planilha de números do tradutor, com o lote e o idioma (ou o idioma pela coluna da planilha).',
            ],
            ['Filtros dos números', 'Situação (disponíveis, reservados, bloqueados), uso, idioma e pagos ou gratuitos; Buscar número.'],
            ['Reservar para…, bloquear, excluir', 'Ações em cada número. Um número usado não é excluído.'],
            ['Livros', 'Cadastre o livro, o primeiro nº de tradução e a primeira folha. O limite de folhas aparece no título.'],
            ['Autorizar protocolo zerado', 'Exceção de numeração que a liderança autoriza.'],
          ]}
        />
        <Fields
          title="Tradutores juramentados"
          items={[
            role === 'leader' && ['Cadastrar tradutor', 'Nome completo, matrícula (ex.: JUCESP nº 0000), idiomas e observações.'],
            [
              'Máscara em Word (.docx)',
              role === 'leader'
                ? 'Envie a máscara com os marcadores {{texto}}, {{numero}} e {{data}}. Cada envio vira uma nova edição; escreva o que mudou.'
                : 'Veja e baixe as máscaras e as edições. Quem envia é o Líder.',
            ],
            ['PDF do tradutor (referência)', 'Um PDF de exemplo do tradutor, para conferir a máscara.'],
            ['Como a máscara em Word é preenchida', 'Explica cada marcador da máscara.'],
          ]}
        />
        {role === 'director' && (
          <RoleNote role={role}>
            Você define os limites e decide os pedidos; o cadastro dos tradutores, das planilhas e dos livros fica com os Líderes.
          </RoleNote>
        )}
        <div className="tutorial-figures">
          <Figure src="equipes-numeracao" alt="Equipes, aba Numeração" caption="Numeração: tradutores, números, cotas e pedidos." />
          <Figure src="equipes-tradutores" alt="Equipes, aba Tradutores juramentados" caption="Tradutores juramentados e as máscaras." />
        </div>
      </>
    ),
  },
  {
    key: 'audit',
    title: 'Auditoria',
    summary: 'O registro de tudo o que aconteceu, com filtros e pendências.',
    roles: ['leader', 'director'],
    target: { area: 'team', tab: 'audit' },
    body: (role) => (
      <>
        <Theory>
          <p>
            A auditoria registra cada ação: quem entrou, o que enviou, conferiu, aprovou, concluiu e baixou, e cada falha.{' '}
            {role === 'director' ? 'Você vê tudo.' : 'Você vê os eventos das equipes que lidera.'} O registro não pode ser alterado.
          </p>
        </Theory>
        <Fields
          items={[
            ['Buscar protocolo, arquivo, pessoa, ação ou erro', 'Acha um registro.'],
            ['Gravidade e Causa do erro', 'Filtram pela importância e pela causa da falha.'],
            ['Grupo de ações e Ação', 'Filtram pelo tipo de evento.'],
            ['Quem, Equipe e Alvo', 'Filtram pela pessoa, pela equipe e pelo que foi afetado.'],
            ['Período: de / até', 'Filtram pela data.'],
            ['Somente erros e emergências', 'Mostra só o que precisa de atenção.'],
            ['Pendências operacionais agora', 'O que está parado ou falhando neste momento.'],
            role === 'director' && ['Quantidade por causa do erro', 'Quantas falhas de cada causa no período.'],
            ['Atualizar auditoria / Carregar mais', 'Busca os registros novos ou os seguintes.'],
          ]}
        />
        <Figure src="equipes-auditoria" alt="Equipes, aba Auditoria" caption="Auditoria: filtros, totais e pendências." />
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
          <p>
            Os ajustes dizem como o sistema traduz. Já vêm com a terminologia das skills e dos tipos documentais (CNN, antecedentes,
            atestados, conselhos, divórcio, procuração, ementa e certidões), do português para inglês, francês, italiano e espanhol e desses
            idiomas para o português. Um termo ajustado por alguém não é trocado nas atualizações.
          </p>
        </Theory>
        <Fields
          title="Glossário"
          items={[
            [
              'Para inglês, francês, italiano, espanhol, português',
              'O idioma de destino. Para o português, escolha também o idioma do termo.',
            ],
            ['Buscar termo', 'Acha um termo cadastrado.'],
            ['Termo / Tradução / Observação (opcional)', 'O termo do original, a tradução aprovada e uma nota.'],
            ['Alcance', role === 'director' ? 'Toda a organização ou uma equipe.' : 'A sua equipe. Termos da organização são do Diretor.'],
            ['Adicionar / Remover', 'Cadastra ou tira um termo do seu alcance.'],
          ]}
        />
        <Fields
          title="Regras"
          items={[
            ['Juramentada, Certificada, Técnica, Simples e Idioma de destino', 'Escolhem qual regra você está ajustando.'],
            ['Fonte e Tamanho (pt)', 'A letra do Word final.'],
            ['Sufixo do arquivo', 'O que entra no fim do nome do arquivo (certidao.pdf → certidao - ENG.docx).'],
            ['Datas', 'Por extenso no idioma de destino, ou como no original (só o nome do mês muda).'],
            ['Números e códigos', 'Exatamente como no original, ou com o separador decimal do idioma de destino.'],
            ['Elementos visuais', 'Só marcador entre colchetes ([Carimbo], [Assinatura]) ou nota do tradutor descritiva.'],
            ['Traduzir nomes de instituições, Trechos em outro idioma, Bordas só nas tabelas', 'Detalhes de como o texto e o layout saem.'],
            ['Checklist de correção e de revisão', 'Um item por linha; aparecem para confirmar antes de concluir.'],
            ['Salvar regra', 'Vale para as próximas traduções.'],
          ]}
        />
        <Fields
          title="Tipos de documento"
          items={[
            ['Idiomas, Modalidade, Tipo documental e modelo, Diagramação do ensaio', 'Os parâmetros do teste.'],
            ['Escolher arquivo / Testar', 'Testa um documento novo sem criar tradução: o sistema mostra o que consegue fazer.'],
            ['Baixar prévia do teste (Word)', 'Confere o resultado no seu computador.'],
            ['Fases com falha e Comentário', 'Se o teste não ficou bom, registre o que falhou.'],
            ['Nome do formato e Motivo', 'Registra uma nova formatação para esse tipo.'],
            ['Tipos que já passaram pelo sistema', 'A lista dos tipos conhecidos.'],
          ]}
        />
        <Fields
          title="IA"
          items={[
            role === 'director' && ['Ligar a IA / Desligar a IA', 'Só o Diretor liga ou desliga. O sistema funciona sem ela.'],
            ['Modelo', 'O modelo de IA usado.'],
            ['Prompt de governança', 'As regras que a IA segue em todos os pedidos. Salvar prompt grava.'],
            ['Habilidades / Nova habilidade', 'Instruções para tarefas específicas: nome e instruções.'],
            [
              'Acesso por pessoa',
              role === 'director' ? 'Libera ou limita a IA para cada pessoa.' : 'Libera ou limita a IA para as pessoas das suas equipes.',
            ],
            ['Registro de chamadas', 'Cada pedido feito à IA, por quem e para quê.'],
          ]}
        />
        {role === 'director' && (
          <Fields
            title="Tradução automática"
            items={[
              ['LibreTranslate (local, gratuito)', 'Roda no seu servidor; o documento não sai dele. É o padrão.'],
              ['DeepL Free (externo)', 'Melhor qualidade; grátis até 500 mil caracteres por mês. O texto vai para o DeepL.'],
              ['Desligada', 'Sem tradução automática: os rascunhos trazem o texto original para traduzir à mão.'],
            ]}
          />
        )}
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
            reativa contas. Suspender encerra todas as sessões da pessoa na hora. Ninguém altera o próprio papel nem a própria situação.
          </p>
        </Theory>
        <Fields
          items={[
            [
              'Cadastros pendentes: Aprovar / Rejeitar',
              'Libera ou recusa quem pediu acesso. Depois de aprovar, coloque a pessoa numa equipe.',
            ],
            ['Usuários: situação', 'Filtra por Todos, Pendente, Ativo ou Suspenso.'],
            ['Tornar Diretor', 'Dá o papel de Diretor. A pessoa sai das equipes, porque o Diretor já acompanha todas.'],
            ['Revogar sessões', 'Encerra os acessos abertos da pessoa, sem suspender a conta.'],
            [
              'Suspender / Reativar',
              'Bloqueia ou libera a conta. Ao suspender, as traduções em aberto da pessoa ficam disponíveis para a equipe assumir.',
            ],
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
    body: (role) => (
      <>
        <Theory>
          <p>
            As notificações avisam documentos prontos, tipos novos, pedidos para refazer, conclusões, falhas e números
            {role === 'user' ? '' : ', e, para a liderança, pedidos de senha e de número'}. Em Configurações, você escolhe como recebê-las.
          </p>
        </Theory>
        <Fields
          title="Notificações"
          items={[
            ['Mostrar: Não lidas / Todas', 'O que listar.'],
            ['Tipo de notificação e Assunto', 'Filtram as notificações.'],
            ['Marcar todas como lidas', 'Limpa o contador do sino.'],
          ]}
        />
        <Fields
          title="Configurações"
          items={[
            ['Aparência: Claro, Modo noturno, Acompanhar o sistema', 'O tema da tela.'],
            ['Ativar avisos', 'Liga ou desliga as notificações.'],
            ['Forma de entrega', 'Resumo inteligente (agrupa o que precisa de atenção e explica o motivo) ou avisos individuais.'],
            ['Frequência dos avisos', 'Assim que possível, a cada 5 ou 15 minutos, ou a cada hora.'],
            ['Assuntos e canais', 'Quais assuntos avisar e onde: na tela ou no Windows.'],
            ['Alterar senha: Senha atual, Nova senha, Confirmar nova senha', 'A senha nova tem de 12 a 256 caracteres.'],
            ['Minhas sessões', 'Os computadores conectados à sua conta. Encerre os que você não reconhece.'],
          ]}
        />
        <Tip>
          Os documentos ficam guardados cifrados: os arquivos, o texto lido dos originais e os rascunhos. Quem copiar o banco ou o
          armazenamento sem a chave do sistema não consegue lê-los. Dentro do sistema, cada pessoa só vê o que a equipe dela pode ver, e
          cada download fica registrado.
        </Tip>
        <div className="tutorial-figures">
          <Figure src="notificacoes" alt="Tela de notificações" caption="Notificações: não lidas em destaque, com filtros." />
          <Figure src="configuracoes" alt="Configurações da conta" caption="Configurações: avisos e aparência." />
        </div>
      </>
    ),
  },
  {
    key: 'password',
    title: 'Esqueci a senha',
    summary: 'Pedir uma senha nova e, para a liderança, autorizar com o token.',
    roles: ['user', 'leader', 'director'],
    body: (role) => (
      <>
        <Theory>
          <p>
            O sistema não manda e-mail. Quem esqueceu a senha escolhe uma nova na entrada, e uma pessoa da liderança confirma quem pediu e
            autoriza:
          </p>
          <ul className="tutorial-list">
            <li>
              <strong>Líder da equipe</strong>: libera a senha nova por <strong>24 horas</strong>, com o Token do Líder. Pode liberar até 3
              vezes seguidas. Depois das 24 horas, a entrada é bloqueada até nova liberação.
            </li>
            <li>
              <strong>Diretor</strong>: autoriza a senha nova de vez, com o Token do Diretor. Depois de 3 liberações do Líder, só o Diretor
              troca a senha.
            </li>
          </ul>
          {role !== 'user' && (
            <p>
              Os pedidos aparecem no sino e em <strong>Equipe › Pedidos de senha</strong>. Confirme com a pessoa, por telefone ou
              pessoalmente, antes de autorizar.
            </p>
          )}
        </Theory>
        <Fields
          title="Campos de Esqueci a senha"
          items={[
            ['E-mail', 'O e-mail da sua conta.'],
            ['Senha nova e Confirmar', 'A senha que você quer usar, duas vezes.'],
            [
              'Mostrar / Ocultar',
              'Mostra a senha ou o token para conferir. Eles voltam a ficar ocultos sozinhos ao apertar Print Screen ou a tecla do Windows (ou Cmd no Mac), ao trocar de janela ou de aba, ao imprimir e depois de 30 segundos. O print feito com Print Screen é apagado da área de transferência.',
            ],
            ['Pedir senha nova', 'Envia o pedido para a liderança.'],
            role === 'director' && ['Tenho o Token do Diretor', 'Com o Token do Diretor, a senha nova vale na hora, sem pedido.'],
          ]}
        />
        <Practice
          steps={[
            <>
              Na entrada, clique em <strong>Esqueci a senha</strong>, digite o seu e-mail e a senha nova duas vezes e use{' '}
              <strong>Pedir senha nova</strong>.
            </>,
            <>Avise o Líder da sua equipe ou o Diretor. Quando autorizarem, entre com a senha nova.</>,
            <>
              Se o Líder liberou, um aviso no topo mostra até quando o acesso vale. Para voltar ao acesso normal, peça uma senha nova e que
              o Diretor autorize.
            </>,
            ...(role === 'user'
              ? []
              : [
                  <>
                    Para autorizar, abra <strong>Equipe › Pedidos de senha</strong>, clique em{' '}
                    <strong>{role === 'director' ? 'Autorizar' : 'Liberar 24 h'}</strong>, digite o seu token e confirme. Para negar, use{' '}
                    <strong>Recusar</strong>.
                  </>,
                ]),
          ]}
        />
        <div className="tutorial-figures">
          <Figure src="esqueci-senha" alt="Tela Esqueci a senha" caption="Esqueci a senha: e-mail e a senha nova, duas vezes." />
          {role !== 'user' && (
            <Figure src="pedidos-senha" alt="Pedidos de senha na tela Equipe" caption="Pedidos de senha: liberar, autorizar ou recusar." />
          )}
          <Figure
            src="acesso-temporario"
            alt="Aviso de acesso liberado pelo Líder"
            caption="Liberado pelo Líder: o aviso mostra até quando o acesso vale."
          />
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
          <dt>Aparece "O acesso liberado pelo Líder terminou"</dt>
          <dd>
            A senha liberada pelo Líder vale 24 horas. Peça uma senha nova em <strong>Esqueci a senha</strong>. Depois de 3 liberações
            seguidas, só o Diretor autoriza.
          </dd>
        </div>
        {role !== 'user' && (
          <div>
            <dt>Aparece "Token incorreto"</dt>
            <dd>
              Confira o token do seu papel: o Líder usa o Token do Líder, e o Diretor, o Token do Diretor. Maiúsculas, espaços e hífens não
              importam. Errar muitas vezes bloqueia novas tentativas por alguns minutos.
            </dd>
          </div>
        )}
        <div>
          <dt>Um botão que outra pessoa usa não aparece para mim</dt>
          <dd>
            Cada papel vê só as ações dele. Veja a seção <strong>Quem faz o quê</strong>.
            {role === 'user' ? ' Para reatribuir, cancelar ou decidir números, fale com o Líder.' : ''}
          </dd>
        </div>
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
            Falta marcar "Comparei o original e o Word", salvar uma edição pendente ou confirmar o checklist das etapas (em Ajustes
            manuais).
          </dd>
        </div>
        <div>
          <dt>Pronta ou Concluir foi recusada por cota</dt>
          <dd>
            O limite anual de números acabou para a pessoa, a equipe ou a organização.{' '}
            {role === 'user' ? 'Avise o Líder.' : 'Ajuste em Equipe › Numeração › Cotas e pedidos.'}
          </dd>
        </div>
        <div>
          <dt>A tradução está bloqueada depois de três reprovações</dt>
          <dd>Registre uma nova forma de formatação (com nome e explicação) em Registrar nova forma de formatação, na própria tradução.</dd>
        </div>
        {role === 'director' && (
          <div>
            <dt>Enviei uma remessa e ela não andou</dt>
            <dd>Remessas do Diretor esperam o direcionamento. Em Nova tradução, escolha a equipe de destino.</dd>
          </div>
        )}
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

export const ROLE_NAME: Record<TutorialRole, string> = { user: 'Usuário', leader: 'Líder', director: 'Diretor' };

/** Perspectivas que cada papel pode abrir: a própria e as dos papéis abaixo (para treinar a equipe). */
export const TUTORIAL_VIEWS: Record<TutorialRole, TutorialRole[]> = {
  user: ['user'],
  leader: ['user', 'leader'],
  director: ['user', 'leader', 'director'],
};

/** Uma seção do tutorial, com o resumo, o conteúdo e o atalho para a tela. */
export function TutorialSection({
  section,
  role,
  views = [role],
  onView,
  canOpen = () => true,
  onGo,
}: {
  section: TutorialSectionData;
  role: TutorialRole;
  views?: TutorialRole[];
  onView?: (role: TutorialRole) => void;
  canOpen?: (target: TutorialTarget) => boolean;
  onGo: (target: TutorialTarget) => void;
}) {
  const own = views[views.length - 1] ?? role;
  return (
    <article className="tutorial" aria-labelledby={`tutorial-${section.key}`}>
      {views.length > 1 && onView && (
        <div className="tutorial-view">
          <span className="muted small-text" id="tutorial-view-label">
            Ver o tutorial como
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="tutorial-view-label">
            {views.map((view) => (
              <button
                key={view}
                type="button"
                role="radio"
                aria-checked={view === role}
                className={view === role ? 'on' : undefined}
                onClick={() => onView(view)}
              >
                {ROLE_NAME[view]}
              </button>
            ))}
          </div>
          {role !== own && (
            <p className="muted small-text">
              Você está vendo o que um {ROLE_NAME[role]} vê, para orientar a sua equipe. As telas que são só desse papel não abrem daqui.
            </p>
          )}
        </div>
      )}
      <header className="tutorial-head">
        <h2 id={`tutorial-${section.key}`}>{section.title}</h2>
        <p className="muted">{section.summary}</p>
        {section.target && canOpen(section.target) && (
          <button type="button" className="small" onClick={() => onGo(section.target!)}>
            Abrir esta tela
          </button>
        )}
      </header>
      {section.body(role)}
    </article>
  );
}
