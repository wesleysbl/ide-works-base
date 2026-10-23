/**
 * A ficha da tarefa — etapa F17.10, refeita na F17.10b; o CORPO dela mora aqui
 * desde a F43, Fase 6 (ver "POR QUE A FICHA SAIU DA PÁGINA", logo abaixo).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU, E POR QUÊ
 *
 *   A F17.10 desenhou a ficha como FORMULÁRIO: coluna de metadados à direita,
 *   rótulo em cima de cada campo, `<select>` para status e prioridade, caixa de
 *   markdown no meio. O usuário comparou com o ClickUp dele e reprovou a forma.
 *
 *   Agora ela tem a gramática da origem: trilha, título grande, FILA DE CHIPS —
 *   e cada chip abre um menu flutuante ancorado nele. O briefing é editor rico;
 *   markdown virou o que sempre foi no ClickUp, formato de armazenamento.
 *
 *   **O chip salva na hora; o texto salva no botão.** É a divisão que o ClickUp
 *   faz e ela não é arbitrária: escolher prioridade é um gesto que termina, e
 *   esperar por um "Salvar" depois dele é um passo a mais em cada escolha.
 *   Digitar não termina — salvar a cada tecla seria uma escrita por caractere.
 *
 *   ⚠️ F43, Fase 6: o card ganhou duas colunas, e ESTE CONTRATO NÃO MUDOU. O
 *   que mudou é que a linha do Salvar diz sempre em que pé o texto está —
 *   salvo · há alterações por salvar · salvando · e a falha, no tom de erro
 *   (`estadoDoTexto`, em `@/board/ficha`) —, e a frase de instrução que ficava
 *   embaixo das propriedades foi para o `?` ao lado desse estado. Salvar
 *   sozinho o título e o briefing está em Melhorias Futuras do plano F43, para
 *   o Wesley decidir: cada PATCH relê a ficha inteira, muda `updated_at` e
 *   dispara o gatilho de menções.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A FICHA SAIU DA PÁGINA — F43, Fase 6
 *
 *   `pages/Tarefa.tsx` era página e ficha ao mesmo tempo. A Fase 7 do plano
 *   abre a MESMA ficha num painel ao lado do Quadro, e a ficha não pode
 *   depender da moldura de página para isso. Ficou assim:
 *     · a PÁGINA (`/tarefa/:id`) desenha a moldura larga, a barra, o topo com a
 *       trilha e o X — e é a única que tem o X (`toda-tela-diz-onde-esta`);
 *     · a FICHA recebe o id e um `cabecalho`, que é como a página põe o topo
 *       ACIMA dos avisos, na mesma posição de sempre, sem a ficha saber o que é
 *       trilha. O topo precisa da tarefa (a trilha, o lugar acima), e é a ficha
 *       quem a tem: por isso é uma função, e não um nó pronto.
 *   Nada mudou de comportamento na extração: a mesma vez, o mesmo rascunho, a
 *   mesma porta de saída, o mesmo Ctrl+S.
 *
 * A FICHA EM DUAS COLUNAS — F43, Fase 6
 *   Quando a FICHA (e não a janela) tem pelo menos 66rem, o trabalho fica à
 *   esquerda — título, briefing, subtarefas, checklists, anexos, aprovação e a
 *   conversa logo depois — e as propriedades com os carimbos, à direita. Abaixo
 *   disso, uma coluna, na ordem de sempre. A regra mora em `tarefa.css` (é
 *   *container query*: o painel da Fase 7 terá outra largura que a página), e
 *   o porquê do limiar está no cabeçalho de `ConversaDaTarefa`.
 *
 *   Seção vazia (sem subtarefa, sem checklist, sem anexo) não desenha caixa:
 *   vira um botão da linha "+ Subtarefa · + Checklist · + Anexo".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTA TELA NÃO DECIDE
 *   Quem alcança a tarefa, qual status ela pode ter, quem entra como responsável
 *   e o que a conclusão faz com a coluna. Tudo isso está no banco desde a
 *   F17.1..F17.3c. A tela monta o pedido e mostra o que voltou.
 *
 * SALVAR É PEDIR, NÃO MANDAR — E POR ISSO A FICHA É RELIDA
 *   `set_task_assignees` e `set_task_watchers` descartam, em silêncio, quem não
 *   tem perfil no IDE Works. `set_task_tags` descarta etiqueta que sumiu. O
 *   gatilho do status carimba ou limpa a conclusão sozinho. O servidor devolve a
 *   ficha RELIDA depois de escrever, e esta tela compara com o que pediu — o que
 *   não entrou aparece escrito, com nome.
 *
 * A COR DO CLICKUP É DADO — decisão D10
 *   `status.color` e `tag.bgColor` entram como variável CSS no próprio elemento.
 *   Nenhuma cor literal do Tailwind nesta tela, nem uma.
 *
 * SAIR COM TEXTO POR SALVAR PERGUNTA — F17.AUD03, achado 3 da auditoria
 *   O título e o briefing só vão ao banco pelo botão; até lá, sair pelo X, pelo
 *   `‹ Voltar`, pelo navegador, pela barra ou por um link jogava tudo fora sem
 *   uma palavra. Agora esta tela REGISTRA uma porta (`@/ui/saida`): há texto
 *   diferente da última versão confirmada? como salvar? como descartar? Quem
 *   segura a navegação e faz a pergunta é a guarda da moldura raiz — esta
 *   tela não bloqueia nada e continua montável em qualquer roteador.
 *
 *   E o mesmo texto vira RASCUNHO LOCAL enquanto se digita (a máquina da
 *   F17.AUD02, com dono e validade), para a recarga não ser a única saída sem
 *   rede de proteção. Ele nunca é aplicado sozinho: é oferecido, como na
 *   ficha de cliente.
 */

import { CampoComMencoes, ProvedorDeMencoes } from '@/board/CamposDeMencao';
import { useMoverEntreListas } from '@/board/useMoverEntreListas';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* A ÁRVORE COMPARTILHADA — F17.CARGA03. Esta ficha desenha a barra lateral, e a
   barra já está lendo a árvore inteira: derivar os destinos do menu de lista
   dela custa zero pedido. `buildTree` e `api.arvoreDoQuadro()` saíram daqui. */
import { buildFullTree, paraNavegacao } from '@/board/arvore';
import { useArvoreCompleta } from '@/board/arvore-compartilhada';
import { useEquipe } from '@/board/equipe-compartilhada';
import { varsDaEtiqueta } from '@/board/tinta-da-etiqueta';
import {
  type BoardTag,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  emFrase,
  today,
} from '@/board/board';
import { rotuloDeDia } from '@/board/calendario';
import { type EstadoDoPrazo, lerPrazo } from '@/board/prazo';
// A entrega — F17.6. `📎 Anexar arquivo` fecha o corpo da ficha, como na
// referência; a conversa vem logo depois (F43, Fase 6: dentro da ficha).
import { AnexosDaTarefa } from '@/board/AnexosDaTarefa';
import { AprovacaoNaFicha } from '@/board/AprovacaoDoCard';
import { ConversaDaTarefa } from '@/board/ConversaDaTarefa';
import { enviarImagens } from '@/board/enviar-imagens';
import { criarFilaDeGravacoes } from '@/board/fila-de-gravacoes';
import { EditorRico } from '@/board/EditorRico';
import {
  ROTULO_DA_SECAO,
  ROTULO_DO_ESTADO,
  type Rascunho,
  type SecaoDaFicha,
  type TaskDetail,
  type TaskPatch,
  TITULO_DO_ESTADO,
  conferirRascunho,
  estadoDoTexto,
  ignorados,
  mudancas,
  nomesDosResponsaveis,
  rascunhoDe,
  recadoDaConclusao,
  rodapeDaFicha,
  secoesVazias,
  temMudanca,
} from '@/board/ficha';
import {
  Ajuda,
  Avatar,
  Balao,
  IconeArquivo,
  IconeBandeira,
  IconeCaixa,
  IconeCalendario,
  IconeCirculo,
  IconeEtiqueta,
  IconeLista,
  IconeMais,
  IconeOlho,
  IconePessoa,
  IconeSeta,
  ItemDeMenu,
  MenuDeData,
  MenuDeEtiquetas,
  MenuDeListas,
  MenuDePessoas,
  MenuDePrioridade,
  MenuDeStatus,
  MenuDeTipos,
  Separador,
} from '@/board/menus';
// Os passos da tarefa — F17.15. As duas seções entram entre o briefing e os
// carimbos, na ordem da ficha real: subtarefa antes de checklist.
import { PassosDaTarefa, SeloDaMae } from '@/board/PassosDaTarefa';
import { ApiError, api, recuperavelAoLer, semSessao } from '@/lib/api';
/* A ÁRVORE CONTA TAREFAS — F17.CARGA02. Concluir, arquivar, mover ou criar
   subtarefa daqui muda o `feitas/total` que a barra ao lado desenha. Enquanto
   cada tela relia a árvore ao montar, voltar para o quadro corrigia o número
   por acidente; com a leitura compartilhada, quem muda avisa. */
import { invalidarArvore, useClienteDeConsultas } from '@/lib/consultas';
import { Aviso, Selo } from '@/ui/primitivos';
// O rascunho local do texto — F17.AUD03, sobre a máquina da F17.AUD02.
import { quandoFoi } from '@/ui/rascunho';
import {
  type EstadoDoRascunho,
  SEM_RASCUNHO,
  criarRascunhoDaFicha,
} from '@/ui/rascunho-da-ficha';
// A porta de saída — F17.AUD03. Esta ficha registra; a moldura pergunta.
import { marcarPorSalvar } from '@/ui/rolador-da-ficha';
import { registrarSaida } from '@/ui/saida';
import { useSessao } from '@/ui/sessao';
// A vez — F17.AUD01. Quem decide se uma resposta ainda vale para esta ficha.
import { entregar, useVez } from '@/ui/vez';
import { ClienteNaFicha } from '@/board/ClienteDaTarefa';
import { SeletorDoTipo } from '@/board/SeletorDoTipo';
import { ROTULO_SEM_TIPO, fraseDaRecusa } from '@/board/tipo-no-cartao';
import '@/ui/clickup.css';
import '@/ui/quadro.css';
import '@/ui/tarefa.css';

/* ───────────────────────────── o chip ───────────────────────────── */

function Chip({
  aberto,
  aoAlternar,
  cheio,
  corStatus,
  rotulo,
  icone,
  desativado,
  balao,
  nome,
  estadoDoPrazo,
}: {
  aberto: boolean;
  aoAlternar: () => void;
  cheio?: boolean;
  corStatus?: string | null;
  rotulo: string;
  icone: React.ReactNode;
  desativado?: boolean;
  balao?: React.ReactNode;
  /** O nome acessível, quando o texto à vista não basta (etiquetas, prazo, `···`). */
  nome?: string;
  /** O tom do prazo (`lerPrazo`) — o mesmo `data-estado` do cartão. */
  estadoDoPrazo?: EstadoDoPrazo;
}) {
  return (
    <span className="cu-ancora">
      <button
        type="button"
        className="cu-chip"
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-label={nome}
        data-cheio={cheio === true}
        data-status={corStatus !== undefined}
        data-prazo={estadoDoPrazo}
        disabled={desativado}
        style={corStatus ? { ['--cor-status' as string]: corStatus } : undefined}
        onClick={aoAlternar}
      >
        {icone}
        {rotulo !== '' && <span className="rotulo">{rotulo}</span>}
      </button>
      {aberto && balao}
    </span>
  );
}

/* ───────────────────────────── o texto que vira rascunho ───────────────────────────── */

/**
 * Só o que se salva pelo botão. Os chips gravam na hora e não têm o que
 * rascunhar; e o que a saída pergunta é sobre ISTO — a prioridade escolhida
 * um segundo atrás já está no banco.
 */
type TextoDaTarefa = { title: string; description: string };

const textoDe = (r: Rascunho): TextoDaTarefa => ({ title: r.title, description: r.description });


/* ───────────────────────────── os `?` da ficha ───────────────────────────── */

/**
 * O CONTRATO DE SALVAR, NO `?` — F43, Fase 6.
 *
 * Era a frase `.t-contrato`, fixa embaixo das propriedades (F07 do plano UX:
 * "os dois contratos, ditos uma vez"). Ela explica a tela, e foi para o `?` ao
 * lado do estado do texto, que é o que ela explica. O texto é o mesmo, com a
 * palavra nova (etapa) e o atalho; o assunto do `?` não diz "Salvar" de
 * propósito — os e2e procuram o botão Salvar pelo nome, e um segundo botão com
 * "Salvar" no nome tornaria a procura ambígua.
 */
export const SOBRE_O_SALVAR = 'quando a tarefa grava';
export const EXPLICACAO_DO_SALVAR =
  'Etapa, responsáveis, prazo, prioridade, etiquetas, tipo e cliente gravam ao escolher. Título e briefing vão com Salvar (ou Ctrl+S) — até lá, um rascunho fica guardado neste navegador.';

/* ───────────────────────────── a linha "+" ───────────────────────────── */

/**
 * "+ Subtarefa · + Checklist · + Anexo" — F43, Fase 6.
 *
 * Uma linha só no lugar das seções vazias. Cada botão abre a seção certa:
 * subtarefa abre a linha de criação já com o foco; checklist CRIA o checklist
 * (o "+ Adicionar checklist" de sempre, que já criava no clique — abrir uma
 * seção vazia só para mostrar esse mesmo botão seria um clique a mais); anexo
 * abre a seção com o foco no título dela.
 *
 * O NOME DE CADA BOTÃO É O DO CONTROLE QUE ELE SUBSTITUI — "Adicionar
 * subtarefa" (o título da seção vazia, que abria a linha de criação),
 * "Adicionar checklist" (o "+ Adicionar checklist" da seção) e "Adicionar
 * anexo". Pedido do Wesley nesta fase: nenhum botão some sem querer, e quem
 * procurava "Adicionar subtarefa" continua achando. O "+" sozinho não diz nada a
 * quem usa leitor de tela, e a palavra à vista está dentro do nome.
 */
function LinhaDeAcrescentar({
  secoes,
  ocupado,
  aoEscolher,
}: {
  secoes: readonly SecaoDaFicha[];
  ocupado: boolean;
  aoEscolher: (s: SecaoDaFicha) => void;
}) {
  return (
    <div className="t-acrescentar" role="group" aria-label="Adicionar à tarefa">
      {secoes.map((s, i) => (
        <span key={s} className="t-acrescentar-item">
          {i > 0 && (
            <span className="t-acrescentar-ponto" aria-hidden="true">
              ·
            </span>
          )}
          <button
            type="button"
            className="t-acrescentar-botao"
            data-acrescentar={s}
            aria-label={`Adicionar ${ROTULO_DA_SECAO[s].toLowerCase()}`}
            disabled={ocupado}
            onClick={() => aoEscolher(s)}
          >
            <span aria-hidden="true">+</span> {ROTULO_DA_SECAO[s]}
          </button>
        </span>
      ))}
    </div>
  );
}

/* ───────────────────────────── a ficha ───────────────────────────── */

export function FichaDaTarefa({
  tarefaId,
  cabecalho,
  tarefaInicial,
}: {
  /** O id da rota, em qualquer caixa — a vez o põe em minúsculas. */
  tarefaId: string | undefined;
  /**
   * O topo de quem hospeda a ficha, desenhado ANTES dos avisos — a mesma
   * posição de sempre (F29: "a primeira coisa da coluna é sempre o lugar").
   * Recebe a tarefa quando ela chega, e `null` enquanto abre.
   */
  cabecalho: (tarefa: TaskDetail | null) => ReactNode;
  /**
   * A ficha já conhecida, só para o PRIMEIRO quadro — a suíte desenha a ficha
   * inteira no servidor, onde efeito nenhum roda (mesmo desenho de
   * `execucoesIniciais` na conversa). A página não passa: no navegador a
   * abertura pela rota relê do banco como sempre.
   */
  tarefaInicial?: TaskDetail;
}) {
  const { mover: moverEntreListas, janela: janelaDaMudanca } = useMoverEntreListas();

  const [tarefa, setTarefa] = useState<TaskDetail | null>(tarefaInicial ?? null);
  const [inicial, setInicial] = useState<Rascunho | null>(() =>
    tarefaInicial ? rascunhoDe(tarefaInicial) : null,
  );
  const [rascunho, setRascunho] = useState<Rascunho | null>(() =>
    tarefaInicial ? rascunhoDe(tarefaInicial) : null,
  );
  /* `equipe`, `meuId` e `arvore` deixaram de ser estado desta tela — F17.CARGA03.
     Os três vêm de consultas compartilhadas, mais abaixo. */

  const [carregando, setCarregando] = useState(tarefaInicial === undefined);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * A ABERTURA falhou por algo PASSAGEIRO e pode ser refeita — F17.AUD04.
   *
   * Só a abertura: uma gravação que falhou deixa o texto na tela e o botão
   * Salvar é a nova tentativa (F17.AUD03). Reler a ficha depois de uma
   * gravação falha assentaria a versão do banco por cima do que a pessoa
   * escreveu — por isso o "Tentar de novo" só existe quando não há ficha.
   */
  const [recuperavel, setRecuperavel] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [descartados, setDescartados] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  /*
    O meio da trilha (F17.25) saiu daqui com a trilha, na F43, Fase 6: ele é
    da PÁGINA, que é quem desenha o topo.
  */

  /**
   * A ÚLTIMA GRAVAÇÃO DO TEXTO FALHOU — F43, Fase 6.
   *
   * Só do texto (título e briefing): é o que o estado ao lado do Salvar diz
   * (a mesma frase, "há alterações por salvar", no tom de erro e com um
   * `title` que aponta a faixa). A frase do banco continua na faixa de erro;
   * isto só impede a linha de dizer o pendente como se nada tivesse
   * acontecido. Volta a `false` quando uma gravação começa.
   */
  const [falhouOTexto, setFalhouOTexto] = useState(false);

  /**
   * AS SEÇÕES QUE A PESSOA PEDIU PELA LINHA "+" — F43, Fase 6.
   *
   * Guardadas com o id da tarefa: a ficha não remonta ao ir da filha para a
   * mãe (a vez, F17.AUD01), e a subtarefa aberta numa não pode aparecer aberta
   * na outra. `focar` é a seção que acabou de ser pedida, e só ela recebe o foco.
   */
  const [pedidas, setPedidas] = useState<{
    id: string | null;
    secoes: readonly SecaoDaFicha[];
    focar: SecaoDaFicha | null;
  }>({ id: null, secoes: [], focar: null });

  /** A raiz da ficha, para devolver o foco depois que um botão some da linha "+". */
  const raiz = useRef<HTMLElement>(null);
  /** O seletor que recebe o foco depois do próximo desenho. Ver o efeito abaixo. */
  const focarDepois = useRef<string | null>(null);

  /**
   * Se o envio de arquivo está de pé — F17.6.
   *
   * Vem de `GET /board/tasks/:id`, e só de lá: o valor não muda entre uma
   * escrita e outra, e repeti-lo nas oito respostas de escrita seria oito
   * lugares para esquecer de atualizar.
   *
   * A tela NUNCA recebe a chave, só se ela existe — mesmo desenho de `hasToken`
   * em `GET /meta/health`. Sem isto, `📎 Anexar arquivo` apareceria clicável,
   * aceitaria o arquivo, subiria o corpo inteiro e então levaria 503: botão
   * morto com o agravante de gastar o envio.
   */
  /*
    O NOME DA VARIÁVEL NASCE VAZIO, E ISSO NÃO É DESCUIDO.

    `test/setup/bundle-secrets.test.ts` recusa qualquer ocorrência de
    `IDEWORKS_SERVER_` dentro do pacote do navegador — e escrever o nome aqui
    como valor padrão o colocaria lá, literalmente. A trava é bruta de
    propósito, e está certa: o nome de uma variável de servidor é uma pista, e
    pista de graça é o que o legado deu ao pôr credencial no código do cliente.

    O nome chega do SERVIDOR, em `storage.variable`, no mesmo `GET` que diz se
    a chave existe. A tela então mostra o nome sem nunca tê-lo embutido.
  */
  const [envioDeArquivo, setEnvioDeArquivo] = useState<{ ready: boolean; variable: string }>({
    ready: false,
    variable: '',
  });

  /**
   * A semente do editor rico.
   *
   * Ela só muda quando a tarefa é CARREGADA — nunca quando um chip salva. Se ela
   * seguisse `updatedAt`, escolher uma prioridade recarregaria o editor e
   * jogaria fora o briefing que está sendo digitado. Ver `EditorRico.tsx`.
   */
  const [semente, setSemente] = useState(0);

  /**
   * O briefing que o editor mostra quando a semente muda — F17.AUD03.
   *
   * `null` é "o do banco". Vira texto quando a pessoa RECUPERA um rascunho:
   * o editor só relê `valorInicial` na troca de semente, e a semente precisa
   * mudar para o briefing recuperado aparecer. Volta a `null` a cada
   * documento novo.
   */
  const [briefingRecuperado, setBriefingRecuperado] = useState<string | null>(null);

  /**
   * O RASCUNHO LOCAL DO TEXTO — F17.AUD03, sobre a máquina da F17.AUD02.
   *
   * A mesma peça da ficha de cliente, com as mesmas regras: só grava o que
   * difere do carregado, cala enquanto há recuperação pendente, tem dono e
   * validade. O estado que chega por `aoMudar` é o OFERECIDO — quem aplica é
   * a pessoa, num clique.
   */
  const [recuperacao, setRecuperacao] = useState<EstadoDoRascunho<TextoDaTarefa>>(SEM_RASCUNHO);
  const [rascunhoDoTexto] = useState(() =>
    criarRascunhoDaFicha<TextoDaTarefa>({ aoMudar: setRecuperacao }),
  );

  // Quem está na sessão — o dono de qualquer rascunho. `null` enquanto a
  // sessão carrega ou se ela falhou: nesses dois casos não há rascunho.
  const { sessao } = useSessao();
  const usuario = sessao?.userId ?? null;

  /* O cliente das consultas, para invalidar a árvore depois dos gestos que
     mexem nas contagens dela. Ver `@/lib/consultas`. */
  const cliente = useClienteDeConsultas();

  const hoje = useRef(today()).current;

  /**
   * A VEZ DESTA FICHA — F17.AUD01, achado 1 da auditoria de 09/09/2026.
   *
   * A reprodução: abrir a subtarefa, abrir a mãe, usar Voltar antes de a mãe
   * chegar. A filha voltava primeiro; a resposta ATRASADA da mãe chegava depois
   * e pintava a ficha, com `/tarefa/<filha>` no endereço — e Salvar mandava
   * `PATCH` para a mãe.
   *
   * Toda leitura pega um bilhete ao começar e só entra se ainda for a vez
   * dela; toda gravação guarda o id da tarefa no começo e pergunta `sobre(id)`
   * no fim. `assentar` é a porta única, e é lá que a pergunta se faz para os
   * três blocos-filhos também. Ver o cabeçalho de `@/ui/vez`.
   */
  const vez = useVez();

  const paraLogin = (e: unknown) => {
    if (semSessao(e)) {
      window.location.replace('/');
      return true;
    }
    return false;
  };

  /**
   * A resposta do servidor vira o novo estado de referência.
   *
   * ⚠️ SÓ SE FOR A FICHA DA VEZ. Chips, subtarefas, checklists, anexos e
   * comentários devolvem a ficha inteira por aqui, e qualquer um deles pode
   * responder depois de a pessoa ter trocado de tarefa. Uma ficha de outra
   * tarefa não entra — nem por um bloco-filho, nem por uma gravação atrasada.
   */
  const assentar = useCallback(
    (t: TaskDetail, novoDocumento: boolean, manterCampos = false) => {
      if (!vez.sobre(t.id)) return;
      setTarefa(t);
      const r = rascunhoDe(t);
      setInicial(r);
      // `manterCampos`: há gravação de chip MAIS NOVA no ar (ver `salvarCampo`).
      // O que se sabe do servidor entra, mas o que a pessoa está marcando não
      // pode voltar ao que esta resposta velha diz.
      if (!manterCampos) {
        setRascunho((atual) =>
          // Depois de um chip, o TEXTO que está sendo digitado tem que sobreviver:
          // o servidor devolve a ficha inteira, e assentá-la crua apagaria o que
          // ainda não foi salvo.
          novoDocumento || atual === null
            ? r
            : { ...r, title: atual.title, description: atual.description },
        );
      }
      if (novoDocumento) {
        setBriefingRecuperado(null);
        setSemente((s) => s + 1);
      }
    },
    [vez],
  );

  /** O erro de um bloco-filho, se a ficha dele ainda é a da vez. */
  const erroDaFicha = useCallback(
    (alvo: string, mensagem: string) => {
      if (vez.sobre(alvo)) setErro(mensagem);
    },
    [vez],
  );

  /**
   * A ficha anterior sai da tela ANTES de a nova chegar — tarefa 4 da etapa.
   *
   * Enquanto a rota e a ficha não coincidem, não há o que editar: o título da
   * filha com o endereço da mãe é exatamente o quadro em que Salvar grava na
   * tarefa errada. O que a pessoa vê nesse intervalo é `Abrindo a tarefa…`, o
   * mesmo da primeira abertura.
   */
  const limpar = useCallback(() => {
    setTarefa(null);
    setInicial(null);
    setRascunho(null);
    setRecado(null);
    setDescartados(null);
    setMenu(null);
    setBriefingRecuperado(null);
  }, []);

  /**
   * `releitura` é a volta de um gesto (`mover`): relê o que JÁ está na tela, e
   * só se ainda estiver. A abertura pela rota é a outra porta — ela é quem
   * torna a tarefa a vez.
   */
  const ler = useCallback(
    async (id: string, releitura = false) => {
      const bilhete = releitura ? vez.reabrir(id) : vez.abrir(id);
      if (bilhete === null) return;
      setCarregando(true);
      setErro(null);
      setRecuperavel(false);
      await entregar(vez, bilhete, api.tarefaDoQuadro(id), {
        chegou: (r) => {
          assentar(r.task as TaskDetail, true);
          if (r.storage) setEnvioDeArquivo(r.storage);
        },
        falhou: (e) => {
          if (paraLogin(e)) return;
          setTarefa(null);
          setErro(e instanceof ApiError ? e.message : 'Não foi possível abrir a tarefa.');
          // Também o 5xx: abrir a tarefa é uma leitura, e um 500 deixava o aviso
          // sem saída além de recarregar a página. Ver `recuperavelAoLer`.
          setRecuperavel(recuperavelAoLer(e));
        },
        terminou: () => setCarregando(false),
      });
    },
    [vez, assentar],
  );

  useEffect(() => {
    if (!tarefaId) return;
    // O id da rota vira o recurso da vez, e a ficha que volta é comparada com
    // ele pelo `task.id` que o banco devolve — que é o uuid na forma canônica,
    // em minúsculas. O worker aceita a rota em qualquer caixa; a vez, não.
    const id = tarefaId.toLowerCase();
    // Rota nova: a ficha de antes sai antes de a nova ser pedida. Na primeira
    // abertura não há ficha e a limpeza não faz nada.
    if (vez.recurso() !== id) limpar();
    void ler(id);
  }, [tarefaId, vez, limpar, ler]);

  /*
    ⚠️ OS DOIS EFEITOS DE MONTAGEM SAÍRAM DAQUI — F17.CARGA03.

    Eram `api.equipe()` e `api.arvoreDoQuadro()` disparados ao montar, cada um
    com o seu `try/catch` e o seu `setState`. Os dois viraram consultas
    compartilhadas, e os dois motivos são diferentes:

    · o DIRETÓRIO continua sendo lido, mas UMA vez para todas as telas que
      atribuem gente (`@/board/equipe-compartilhada`). Abrir cinco tarefas
      seguidas pagava `/team` cinco vezes pela mesma lista de oito nomes;

    · a ÁRVORE do menu de mudar de lista deixou de ser lida. Ela vinha de
      `GET /board/tree` — uma segunda rota, ~520 ms — e alimentava UM consumidor:
      um `MenuDeListas` que nasce FECHADO. Agora os destinos são derivados da
      árvore que a barra ao lado desta ficha já está lendo, com a ponte que
      `Quadro` e `Pasta` usam. Zero pedido a mais, um pedido a menos.

    O SILÊNCIO DOS DOIS FOI PRESERVADO, e ele é a tarefa 5 desta fase: sem
    diretório o seletor de pessoas fica vazio, sem árvore some só o menu de
    lista, e a ficha abre, edita e salva do mesmo jeito nos dois casos.
  */
  const { pessoas: equipe, meuId } = useEquipe();

  const { linhas: linhasDaArvore } = useArvoreCompleta();

  /**
   * OS DESTINOS DO MENU DE MUDAR DE LISTA — F17.CARGA03.
   *
   * ⚠️ A EQUIVALÊNCIA COM `GET /board/tree` FOI CONFERIDA, E ELA É EXATA.
   *   Não é semelhança: `readFullTree` traz `list_is_live` de um `left join`
   *   com a MESMA view `ideworks.tree` que `readTree` filtra com
   *   `where t.is_live`. Uma única coluna, lida por dois caminhos — não são
   *   duas contas de "vivo" que precisam concordar. E as duas consultas partem
   *   de `lists` com o mesmo `join ideworks.spaces`, sob as mesmas políticas de
   *   linha, então a lista que uma alcança é a que a outra alcança.
   *
   *   `paraNavegacao` aplica `somenteVivos` — espaço, pasta ou lista com
   *   carimbo de arquivamento não vira destino —, que é o mesmo recorte que
   *   `is_live` faz no banco, e devolve a MESMA forma que `buildTree` devolvia.
   *   Ver `@/board/arvore` e `arvore.test.ts`.
   */
  const arvore = useMemo(
    () => (linhasDaArvore === null ? [] : paraNavegacao(buildFullTree(linhasDaArvore))),
    [linhasDaArvore],
  );

  const erros = useMemo(() => (rascunho ? conferirRascunho(rascunho) : {}), [rascunho]);
  const pedido = useMemo(
    () => (inicial && rascunho ? mudancas(inicial, rascunho) : {}),
    [inicial, rascunho],
  );
  const porSalvar = temMudanca(pedido);

  // O `<html>` precisa saber, para reservar espaço sob o cabeçalho grudado
  // (`tarefa.css`) — por atributo, e não por `:has()`. Ver `@/ui/rolador-da-ficha`.
  useEffect(() => marcarPorSalvar(porSalvar), [porSalvar]);

  /**
   * O que a SAÍDA pergunta — F17.AUD03: há texto diferente da última versão
   * confirmada? Só título e briefing. Um chip no ar também entra em `pedido`
   * por um instante (a mudança local vai antes da resposta), e esse instante
   * não é motivo para segurar ninguém: o chip grava sozinho.
   */
  const textoPendente = 'title' in pedido || 'description' in pedido;

  const mexer = (mudanca: Partial<Rascunho>) =>
    setRascunho((r) => (r === null ? r : { ...r, ...mudanca }));

  /* --- o rascunho local do texto (F17.AUD03) -------------------------------- */

  /*
    A ORDEM DESTES EFEITOS É A DA MÁQUINA, e não é indiferente.

    `abrir` vem ANTES de `carregou`: trocar de tarefa na mesma tela (filha →
    mãe) abre a ficha nova e esquece a base da antiga; `carregou` logo depois
    põe a base nova. Ao contrário, a base da mãe seria esquecida assim que
    fosse posta. O id é o da ROTA, em minúsculas — o mesmo que a vez usa —,
    então a ficha do rascunho já existe antes de o banco responder, e a
    mesma pessoa indo de uma tarefa a outra conclui o que estava agendado.
  */
  const idDaRota = tarefaId?.toLowerCase() ?? null;
  useEffect(() => {
    rascunhoDoTexto.abrir(
      usuario === null || idDaRota === null ? null : { usuario, tipo: 'tarefa', id: idDaRota },
    );
  }, [rascunhoDoTexto, usuario, idDaRota]);

  // O que veio do banco é a base: rascunho é o que DIFERE disto. `inicial`
  // muda a cada ficha relida — depois de um chip, depois do Salvar —, e a base
  // acompanha.
  useEffect(() => {
    if (inicial !== null) rascunhoDoTexto.carregou(textoDe(inicial));
  }, [rascunhoDoTexto, inicial]);

  // Guarda enquanto se digita — quem decide se e quando é a máquina.
  const titulo = rascunho?.title;
  const briefing = rascunho?.description;
  useEffect(() => {
    if (titulo !== undefined && briefing !== undefined) {
      rascunhoDoTexto.mudou({ title: titulo, description: briefing });
    }
  }, [rascunhoDoTexto, titulo, briefing]);

  // Fechar com edição em curso conclui a gravação local antes de desmontar.
  useEffect(() => () => rascunhoDoTexto.encerrar(), [rascunhoDoTexto]);

  /** A pessoa clicou em Recuperar: o texto entra, e o editor relê o briefing. */
  const recuperarTexto = () => {
    const valor = rascunhoDoTexto.recuperar();
    if (valor === null) return;
    mexer({ title: valor.title, description: valor.description });
    setBriefingRecuperado(valor.description);
    setSemente((s) => s + 1);
  };

  /* --- o que foi pedido e não entrou -------------------------------------- */

  const conferirDescarte = useCallback(
    (p: TaskPatch, voltou: TaskDetail) => {
      const avisos: string[] = [];
      if (p.assigneeIds) {
        const fora = ignorados(p.assigneeIds, voltou.assignees, equipe);
        if (fora.length > 0) {
          avisos.push(
            `responsável: ${fora.map((x) => x.name).join(', ')} não ${fora.length === 1 ? 'entrou' : 'entraram'}`,
          );
        }
      }
      if (p.watcherIds) {
        const fora = ignorados(p.watcherIds, voltou.watchers, equipe);
        if (fora.length > 0) {
          avisos.push(
            `observador: ${fora.map((x) => x.name).join(', ')} não ${fora.length === 1 ? 'entrou' : 'entraram'}`,
          );
        }
      }
      if (p.tagIds) {
        const fora = p.tagIds.filter((id) => !voltou.tags.some((g) => g.id === id));
        if (fora.length > 0) avisos.push(`${fora.length} etiqueta(s) não entraram`);
      }
      setDescartados(
        avisos.length === 0
          ? null
          : `O banco aceitou o resto, mas descartou o que não tem perfil no IDE Works — ${avisos.join(' · ')}. A ficha abaixo mostra o que de fato ficou gravado.`,
      );
    },
    [equipe],
  );

  /* --- salvar o TEXTO (título e briefing) --------------------------------- */

  /*
    TODA GRAVAÇÃO GUARDA O ALVO NO COMEÇO E PERGUNTA NO FIM — F17.AUD01.

    `const alvo = tarefa.id` antes do `await`; `vez.sobre(alvo)` depois. Entre
    os dois a pessoa pode ter ido à mãe: a resposta — ficha relida, recado,
    erro, aviso de descarte — não pode encostar na ficha que está na tela
    agora. Nem mandar para o login uma tela que já não é desta operação.

    ⚠️ `setSalvando(false)` NÃO É GUARDADO, de propósito. `salvando` é "esta
    tela tem uma escrita no ar", e não uma propriedade da ficha: guardá-lo
    deixaria a ficha seguinte travada até nunca. A escrita no ar continua
    desativando a ficha nova por esse instante — que é o lado seguro.

    DEVOLVE SE O SERVIDOR CONFIRMOU — F17.AUD03. É a resposta que `Salvar e
    sair` espera: `true` sai; `false` fica na ficha, com o texto, e o erro já
    está na tela (validação, rede ou banco). O botão Salvar ignora a resposta.
  */

  const salvar = useCallback(async (): Promise<boolean> => {
    if (!tarefa || !rascunho || !inicial) return false;
    if (Object.keys(erros).length > 0) return false;

    const p = mudancas(inicial, rascunho);
    // Nada a gravar é nada a perder: quem perguntou pode sair.
    if (!temMudanca(p)) return true;

    const alvo = tarefa.id;
    if (!vez.sobre(alvo)) return false;
    setSalvando(true);
    setFalhouOTexto(false);
    setRecado(null);
    // O aviso da tentativa anterior sai junto com o novo pedido — F17.AUD08.
    // Sem isto, "Não foi possível renovar agora" ficava ao lado de "Salvo."
    // depois de a renovação voltar; `salvarCampo` e `acao` já limpavam.
    setErro(null);
    setDescartados(null);
    try {
      const r = await api.salvarTarefaDoQuadro(alvo, p);
      if (!vez.sobre(alvo)) return false;
      const voltou = r.task as TaskDetail;
      assentar(voltou, false);
      setRecado('Salvo.');
      conferirDescarte(p, voltou);
      // Gravou de verdade: o rascunho local perdeu a razão de existir, e o
      // temporizador que ainda estivesse agendado não pode recriá-lo.
      rascunhoDoTexto.salvo();
      return true;
    } catch (e) {
      if (!vez.sobre(alvo)) return false;
      if (paraLogin(e)) return false;
      setRecado(null);
      setFalhouOTexto(true);
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
      return false;
    } finally {
      setSalvando(false);
    }
  }, [tarefa, rascunho, inicial, erros, vez, assentar, conferirDescarte, rascunhoDoTexto]);


  /*
    A PORTA DE SAÍDA — F17.AUD03. Registrada uma vez por montagem; o que ela
    responde é lido dos espelhos NA HORA da pergunta, porque `salvar` e
    `textoPendente` mudam a cada tecla e a porta não pode ficar presa à
    primeira versão deles. É o mesmo desenho de `fechar.current` na ficha de
    cliente.
  */
  const espelhoDaSaida = useRef({ textoPendente, salvar });
  espelhoDaSaida.current = { textoPendente, salvar };
  useEffect(
    () =>
      registrarSaida({
        temAlteracao: () => espelhoDaSaida.current.textoPendente,
        salvar: () => espelhoDaSaida.current.salvar(),
        // Só o rascunho DESTA tarefa: a máquina só conhece a ficha aberta.
        descartar: () => rascunhoDoTexto.abandonar(),
      }),
    [rascunhoDoTexto],
  );

  /* --- o chip salva na hora ------------------------------------------------ */

  /**
   * AS GRAVAÇÕES DOS CHIPS SAEM UMA DEPOIS DA OUTRA — revisão de 08/10.
   *
   * O menu de responsáveis (e o de etiquetas) fica aberto enquanto se marca, e
   * cada marca é um `PATCH` com o conjunto inteiro. Em paralelo, a resposta do
   * primeiro clique devolvia o menu ao conjunto de antes do segundo, o terceiro
   * clique partia dele, e uma marca se perdia NO SERVIDOR, sem aviso. Ver
   * `@/board/fila-de-gravacoes`.
   */
  const [filaDosCampos] = useState(criarFilaDeGravacoes);
  /** O que se sabe do servidor, para o desfazer ler a versão de agora e não a do desenho. */
  const inicialAgora = useRef(inicial);
  inicialAgora.current = inicial;

  const salvarCampo = useCallback(
    async (p: TaskPatch, mudancaLocal: Partial<Rascunho>) => {
      if (!tarefa) return;
      const alvo = tarefa.id;
      if (!vez.sobre(alvo)) return;
      mexer(mudancaLocal);
      setSalvando(true);
      setErro(null);
      setRecado(null);
      const gravacao = filaDosCampos.enfileirar(() => api.salvarTarefaDoQuadro(alvo, p));
      try {
        const r = await gravacao.resultado;
        if (!vez.sobre(alvo)) return;
        const voltou = r.task as TaskDetail;
        // Só a resposta da ÚLTIMA gravação decide o que a tela mostra: as
        // anteriores contam ao que se sabe do servidor, e nada além disso.
        const ultima = gravacao.ehAUltima();
        assentar(voltou, false, !ultima);
        if (ultima) conferirDescarte(p, voltou);
      } catch (e) {
        if (!vez.sobre(alvo)) return;
        if (paraLogin(e)) return;
        // A frase do banco, inteira: as travas da F17 dizem o que está no
        // caminho, e trocá-las por "algo deu errado" jogaria o trabalho fora.
        setErro(e instanceof ApiError ? fraseDaRecusa(e) : 'O banco recusou a operação.');
        // O DESFAZER. O chip mostrava a escolha na hora, e o banco não a tem:
        // sem isto ele seguiria dizendo o que não ficou gravado. Volta ao que o
        // servidor confirmou — a menos que haja gravação mais nova no ar, cuja
        // resposta vai dizer o que ficou.
        if (gravacao.ehAUltima()) {
          const confirmado = inicialAgora.current;
          if (confirmado !== null) {
            const volta = Object.fromEntries(
              (Object.keys(mudancaLocal) as (keyof Rascunho)[]).map((k) => [k, confirmado[k]]),
            ) as Partial<Rascunho>;
            mexer(volta);
          }
        }
      } finally {
        // `salvando` só desliga quando não resta gravação de chip no ar.
        if (gravacao.terminou()) setSalvando(false);
      }
    },
    [tarefa, vez, assentar, conferirDescarte, filaDosCampos],
  );

  const acao = useCallback(
    async (fazer: () => Promise<{ task: unknown }>, aviso?: string | ((relida: TaskDetail) => string)) => {
      if (!tarefa) return;
      const alvo = tarefa.id;
      if (!vez.sobre(alvo)) return;
      setSalvando(true);
      setErro(null);
      setRecado(null);
      try {
        const r = await fazer();
        if (!vez.sobre(alvo)) return;
        const relida = r.task as TaskDetail;
        assentar(relida, false);
        /* ⚠️ AQUI, E NÃO EM `salvarCampo` — F17.CARGA02. Por esta porta passam
           trocar de status, concluir, reabrir, arquivar e desarquivar: os cinco
           mudam o `feitas/total` da lista. Renomear e escrever briefing passam
           pela outra, e não mudam contagem nenhuma — invalidar a árvore a cada
           letra salva seria uma leitura da árvore inteira por gravação. */
        void invalidarArvore(cliente);
        if (aviso) setRecado(typeof aviso === 'function' ? aviso(relida) : aviso);
      } catch (e) {
        if (!vez.sobre(alvo)) return;
        if (paraLogin(e)) return;
        setErro(e instanceof ApiError ? e.message : 'O banco recusou a operação.');
      } finally {
        setSalvando(false);
      }
    },
    [tarefa, vez, assentar, cliente],
  );

  /** Trocar de lista é `move_task`: lista e status na mesma escrita. */
  const mover = useCallback(
    async (listId: string) => {
      if (!tarefa || tarefa.listId === listId) return;
      const alvo = tarefa.id;
      if (!vez.sobre(alvo)) return;
      setSalvando(true);
      setErro(null);
      try {
        const r = await moverEntreListas(alvo, listId);
        if (!r) return;
        if (!vez.sobre(alvo)) return;
        setRecado(
          r.move.statusRepositioned
            ? // F43, Fase 6: "esteira" e "status" saíram da ficha; a palavra é "etapa".
              'Movida — a lista nova tem outras etapas, e o banco reposicionou a etapa.'
            : 'Movida.',
        );
        // RELEITURA, e não abertura: se a pessoa já foi para outra tarefa, não
        // há o que reler — e reabrir tornaria esta tarefa a vez de novo com o
        // endereço da outra.
        await ler(alvo, true);
        // Mudou de lista: as contagens de DUAS listas mudaram, e a árvore ao
        // lado desenha as duas. Uma invalidação só, e ela vale para as duas.
        void invalidarArvore(cliente);
      } catch (e) {
        if (!vez.sobre(alvo)) return;
        if (paraLogin(e)) return;
        setErro(e instanceof ApiError ? e.message : 'O banco recusou a mudança de lista.');
      } finally {
        setSalvando(false);
      }
    },
    [moverEntreListas, tarefa, vez, ler, cliente],
  );

  const criarEtiqueta = async (nome: string, cor: string) => {
    if (!tarefa?.spaceId || !rascunho) return;
    const alvo = tarefa.id;
    try {
      const r = await api.criarEtiquetaDoEspaco(tarefa.spaceId, {
        name: nome,
        bgColor: cor,
        fgColor: null,
      });
      if (!vez.sobre(alvo)) return;
      const nova = r.tag as BoardTag;
      setTarefa((t) => (t === null ? t : { ...t, availableTags: [...t.availableTags, nova] }));
      // Nasce já marcada: quem a criou aqui dentro queria usá-la.
      void salvarCampo({ tagIds: [...rascunho.tagIds, nova.id] }, { tagIds: [...rascunho.tagIds, nova.id] });
    } catch (e) {
      if (!vez.sobre(alvo)) return;
      if (paraLogin(e)) return;
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar a etiqueta.');
    }
  };

  /* --- desenho ------------------------------------------------------------- */

  const statusAtual = tarefa?.statuses.find((s) => s.id === tarefa.statusId) ?? null;
  /* O prazo que o chip mostra é o do RASCUNHO (o chip grava na hora e o
     rascunho já tem a data escolhida), com a conclusão do banco. */
  const leituraDoPrazo =
    tarefa && rascunho
      ? lerPrazo({ dueOn: rascunho.dueOn === '' ? null : rascunho.dueOn, completedAt: tarefa.completedAt }, hoje)
      : null;
  const alternar = (nome: string) => setMenu((m) => (m === nome ? null : nome));

  const responsaveis = tarefa?.assignees ?? [];
  const observadores = tarefa?.watchers ?? [];


  /* --- a linha "+": as seções que nascem recolhidas (F43, Fase 6) ---------- */

  /**
   * "+ Checklist" CRIA o checklist — o mesmo pedido do "+ Adicionar checklist"
   * da seção, pela mesma porta de sempre (a vez, `assentar` sem apagar o texto
   * que está sendo digitado). O foco vai ao "+ Adicionar item" do checklist
   * novo: o botão apertado sumiu da linha, e quem criou quer o primeiro item.
   */
  const criarChecklist = async () => {
    if (!tarefa) return;
    const alvo = tarefa.id;
    if (!vez.sobre(alvo)) return;
    setSalvando(true);
    setErro(null);
    setRecado(null);
    try {
      const r = await api.criarChecklist(alvo);
      if (!vez.sobre(alvo)) return;
      focarDepois.current = '.p-cartao .p-adicionar';
      assentar(r.task as TaskDetail, false);
    } catch (e) {
      if (!vez.sobre(alvo)) return;
      if (paraLogin(e)) return;
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar o checklist.');
    } finally {
      setSalvando(false);
    }
  };

  const pedir = (s: SecaoDaFicha) => {
    if (!tarefa) return;
    if (s === 'checklists') {
      void criarChecklist();
      return;
    }
    const id = tarefa.id;
    setPedidas((p) => {
      const antes = p.id === id ? p.secoes : [];
      return { id, secoes: antes.includes(s) ? antes : [...antes, s], focar: s };
    });
  };

  /** Cancelar a linha de criação recolhe de novo a seção — se ela estiver vazia. */
  const recolherSubtarefas = () => {
    if (!tarefa || tarefa.subtasks.length > 0) return;
    focarDepois.current = '[data-acrescentar="subtarefas"]';
    setPedidas((p) => ({ ...p, secoes: p.secoes.filter((x) => x !== 'subtarefas'), focar: null }));
  };

  /*
    O FOCO QUE ESPERA O DESENHO. O alvo só existe depois que a resposta
    assenta (o checklist novo) ou que a seção recolhe (o "+ Subtarefa" volta à
    linha); antes disso não há onde pôr o foco. Sem dependências de propósito:
    roda a cada desenho, e só faz alguma coisa quando há um pedido pendente e o
    alvo já existe. Se a pessoa já foi para outro lugar, o pedido morre com a
    próxima ficha.
  */
  useEffect(() => {
    const seletor = focarDepois.current;
    if (seletor === null) return;
    const alvos = raiz.current?.querySelectorAll<HTMLElement>(seletor);
    if (!alvos || alvos.length === 0) return;
    focarDepois.current = null;
    alvos[alvos.length - 1].focus();
  });

  /* --- o que a linha "+" e o estado do texto mostram (F43, Fase 6) --------- */

  const estadoDoTextoAgora = estadoDoTexto({ porSalvar, escrevendo: salvando, falhouOTexto });
  const vazias = tarefa ? secoesVazias(tarefa) : [];
  const pedidasAqui = tarefa && pedidas.id === tarefa.id ? pedidas.secoes : [];
  const focarAqui = tarefa && pedidas.id === tarefa.id ? pedidas.focar : null;
  /* O que ainda está vazio E não foi pedido. Checklist não entra em `pedidas`:
     o "+" dele cria o checklist, e a seção aparece porque deixou de estar vazia. */
  const faltam = vazias.filter((s) => !pedidasAqui.includes(s));

  return (
    <ProvedorDeMencoes taskId={tarefa?.id}>
      {cabecalho(tarefa)}

      {erro && (
        <div className="mb-3">
          <Aviso
            tipo="erro"
            acao={
              recuperavel && tarefa === null && idDaRota !== null
                ? { rotulo: 'Tentar de novo', aoClicar: () => void ler(idDaRota) }
                : undefined
            }
          >
            {erro}
          </Aviso>
        </div>
      )}
      {recado && (
        <div className="mb-3">
          <Aviso tipo="ok">{recado}</Aviso>
        </div>
      )}
      {descartados && (
        <div className="mb-3">
          <Aviso tipo="atencao">{descartados}</Aviso>
        </div>
      )}

      {/* O RASCUNHO OFERECIDO — F17.AUD03, como na ficha de cliente. Só com a
          tarefa na tela e o dono confirmado; e diz de quando é, porque "há 3
          minutos" e "há 9 horas" pedem decisões diferentes. O que está na
          tela é o que está salvo; quem aplica é a pessoa. */}
      {tarefa && rascunho && usuario !== null && recuperacao.recuperacao === 'pendente' && recuperacao.oferecido && (
        <div className="mb-3">
          <Aviso tipo="atencao">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Há um rascunho do título e do briefing desta tarefa, de{' '}
                {quandoFoi(recuperacao.oferecido.guardadoEm)}. O que está na tela é o que está
                salvo no sistema.
              </span>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="o-btn o-btn-vidro o-btn-sm"
                  disabled={salvando}
                  onClick={recuperarTexto}
                >
                  Recuperar rascunho
                </button>
                <button
                  type="button"
                  className="o-btn o-btn-fantasma o-btn-sm"
                  onClick={() => rascunhoDoTexto.descartar()}
                >
                  Descartar
                </button>
              </span>
            </div>
          </Aviso>
        </div>
      )}

      {carregando && tarefa === null && <p className="eyebrow">Abrindo a tarefa…</p>}

      {tarefa && rascunho && (
        <section
          ref={raiz}
          className="cu-ficha"
          onKeyDown={(e) => {
            // Ctrl+S salva o texto — o gesto que todo mundo tenta antes de
            // procurar o botão.
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
            e.preventDefault();
            void salvar();
          }}
        >
          {/* --- a linha de controle: onde a tarefa PODE IR, e o Salvar ------ */}
          {/* Os nomes de empresa, espaço e pasta saíram daqui na F17.25 — eles
              eram texto morto repetindo a trilha que agora está no topo. O que
              ficou MUDA a tarefa: a lista, o tipo, o salvar e o `···`.

              F07 do plano UX: com texto por salvar esta linha GRUDA logo abaixo
              do cabeçalho (`data-por-salvar`, ver `tarefa.css`). Quem escreve
              um briefing longo não precisa rolar de volta até o botão — e a
              frase "há alterações por salvar" fica à vista enquanto for verdade.
              Sem alteração ela rola com a ficha e não cobre nada. */}
          <div className="cu-trilha" data-por-salvar={porSalvar}>
            {tarefa.listId ? (
              <span className="cu-ancora t-lugar">
                <button
                  type="button"
                  className="cu-seletor"
                  aria-expanded={menu === 'lista'}
                  disabled={salvando}
                  title={`Lista: ${tarefa.listName}`}
                  onClick={() => alternar('lista')}
                >
                  <IconeLista />
                  <span className="nome">{tarefa.listName}</span>
                  <span className="seta">
                    <IconeSeta />
                  </span>
                </button>
                {menu === 'lista' && (
                  <MenuDeListas
                    arvore={arvore}
                    listaAtual={tarefa.listId}
                    aoEscolher={(id) => void mover(id)}
                    aoFechar={() => setMenu(null)}
                  />
                )}
              </span>
            ) : (
              <span className="t-sem-lista">
                sem lista — é demanda de cliente, criada antes de existir quadro
              </span>
            )}

            {tarefa.availableTypes.length > 0 && (
              <span className="cu-ancora t-tipo">
                <button
                  type="button"
                  className="cu-seletor"
                  aria-expanded={menu === 'tipo'}
                  disabled={salvando}
                  onClick={() => alternar('tipo')}
                >
                  <IconeCirculo />
                  <span className="nome">{tarefa.taskTypeName ?? 'Tarefa'}</span>
                  <span className="seta">
                    <IconeSeta />
                  </span>
                </button>
                {menu === 'tipo' && (
                  <MenuDeTipos
                    tipos={tarefa.availableTypes}
                    valor={rascunho.customItemId}
                    aoEscolher={(v) => void salvarCampo({ customItemId: v }, { customItemId: v })}
                    aoFechar={() => setMenu(null)}
                  />
                )}
              </span>
            )}

            <span className="t-salvar">
              {/* O ESTADO DO TEXTO — F43, Fase 6. Sempre à vista, e não só
                  quando há o que salvar: "Salvo" também é informação. O `?`
                  ao lado traz o contrato que era a frase `.t-contrato`. */}
              {/* `role="status"`: "salvo", "há alterações por salvar" e "salvando"
                  mudam sem a página recarregar e só existiam como texto e cor —
                  quem usa leitor de tela não ouvia que o Ctrl+S funcionou
                  (WCAG 4.1.3). A falha tem o aviso próprio, `role="alert"`. */}
              <span
                className="t-estado"
                role="status"
                data-estado={estadoDoTextoAgora}
                title={TITULO_DO_ESTADO[estadoDoTextoAgora]}
              >
                {ROTULO_DO_ESTADO[estadoDoTextoAgora]}
              </span>
              <Ajuda sobre={SOBRE_O_SALVAR}>
                <p>{EXPLICACAO_DO_SALVAR}</p>
              </Ajuda>
              <button
                type="button"
                className="o-btn o-btn-primario o-btn-sm"
                title="Salva o título e o briefing (Ctrl+S)"
                disabled={salvando || !porSalvar || Object.keys(erros).length > 0}
                onClick={() => void salvar()}
              >
                {/* "salvando…" saiu do botão: quem diz agora é o estado ao
                    lado, e o botão não muda de largura no meio do clique. */}
                Salvar
              </button>
              <Chip
                aberto={menu === 'mais' || menu === 'mover'}
                aoAlternar={() => (menu === 'mover' ? setMenu(null) : alternar('mais'))}
                desativado={salvando}
                nome="Mais ações da tarefa"
                icone={<IconeMais />}
                rotulo=""
                balao={
                  menu === 'mover' ? (
                    <MenuDeListas
                      arvore={arvore}
                      listaAtual={tarefa.listId}
                      rotulo="Mover para"
                      lado="baixo"
                      aoEscolher={(id) => void mover(id)}
                      aoFechar={() => setMenu(null)}
                    />
                  ) : (
                    <Balao lado="baixo" aoFechar={() => setMenu(null)} rotulo="Mais">
                      {tarefa.listId && (
                        <ItemDeMenu aoEscolher={() => setMenu('mover')}>
                          <IconeLista />
                          Mover tarefa
                        </ItemDeMenu>
                      )}
                      <ItemDeMenu aoEscolher={() => setMenu('observadores')}>
                        <IconeOlho />
                        Observadores
                        {observadores.length > 0 && <span className="fim">{observadores.length}</span>}
                      </ItemDeMenu>
                      <Separador />
                      <ItemDeMenu
                        aoEscolher={() => {
                          setMenu(null);
                          void acao(
                            () => api.arquivarTarefaDoQuadro(tarefa.id, tarefa.archivedAt === null),
                            tarefa.archivedAt === null ? 'Arquivada.' : 'Desarquivada.',
                          );
                        }}
                      >
                        <IconeArquivo />
                        {tarefa.archivedAt === null ? 'Arquivar' : 'Desarquivar'}
                      </ItemDeMenu>
                    </Balao>
                  )
                }
              />
              {menu === 'observadores' && (
                <span className="cu-ancora">
                  <MenuDePessoas
                    diretorio={equipe}
                    escolhidos={rascunho.watcherIds}
                    meuId={meuId}
                    rotulo="Observadores"
                    aoMudar={(ids) => void salvarCampo({ watcherIds: ids }, { watcherIds: ids })}
                    aoFechar={() => setMenu(null)}
                  />
                </span>
              )}
            </span>
          </div>

          {/* --- o corpo: uma coluna, ou duas quando a ficha é larga --------
              F43, Fase 6. A ORDEM AQUI É A DE UMA COLUNA (a de sempre), e é
              também a ordem do Tab: título, propriedades, briefing… Em duas
              colunas, `.t-lado` (propriedades e carimbos) sobe para a direita
              por posição de grade, sem mudar a ordem do documento; em uma, ele
              some como caixa (`display: contents`) e os carimbos descem para
              antes da conversa por `order`. Ver `tarefa.css`. */}
          <div className="t-corpo">
            {/* "Subtarefa de …" — o caminho de volta, logo acima do nome: sem
                ele, abrir uma subtarefa pelo endereço dela seria abrir uma
                tarefa solta. */}
            {tarefa.parentId !== null && (
              <div className="t-mae">
                <SeloDaMae tarefa={tarefa} />
              </div>
            )}

            {/* --- o título -------------------------------------------------- */}
            <CampoComMencoes
              className="cu-titulo"
              value={rascunho.title}
              rows={1}
              data-erro={erros.title !== undefined}
              aria-label="Título da tarefa"
              /* O erro do título é anunciado e ligado ao campo — WCAG 3.3.1 e
                 4.1.3. Ele aparece enquanto se digita (título apagado), com o
                 foco no próprio campo. */
              aria-invalid={erros.title !== undefined}
              aria-describedby={erros.title ? 't-titulo-erro' : undefined}
              disabled={salvando}
              aoMudar={(title) => mexer({ title })} umaLinha
            />
            {erros.title && (
              <p id="t-titulo-erro" className="o-dica px-3" data-erro="true" role="alert">
                {erros.title}
              </p>
            )}

            {tarefa.archivedAt !== null && (
              <p className="t-aviso-linha">
                Esta tarefa está arquivada — ela não aparece no quadro. Desarquivar a traz de volta;
                nada foi apagado.
              </p>
            )}

            {tarefa.taskTypeMissing && (
              <p className="t-aviso-linha">
                O número de tipo {tarefa.customItemId} não está no catálogo deste espaço.
              </p>
            )}

            {/* --- as propriedades — F07 do plano UX ----------------------------
                Era uma fila de chips que repetia o prazo (chip + texto por
                extenso) e as etiquetas (chip "2 etiquetas" + as etiquetas soltas).
                Agora cada propriedade tem UMA linha, com o nome à esquerda e o
                valor, que é o próprio botão, à direita — o chip continua sendo o
                que abre o menu e grava na hora. No celular o nome vai para cima
                do valor e nada aperta.

                F43, Fase 6: elas moram em `.t-lado` com os carimbos — a coluna
                da direita quando a ficha é larga. Os nomes (`dt`), as linhas
                (`.t-prop`) e os `data-prop` são os mesmos: os e2e de tipo,
                cliente e aprovação os procuram. */}
            <div className="t-lado">
              <dl className="t-props">
                <div className="t-prop">
                  {/* "Etapa" — F43, Fase 6, o vocabulário do plano ("status" e
                      "esteira" saem da tela). O valor continua sendo o status
                      do banco, com a cor dele. */}
                  <dt>Etapa</dt>
                  <dd>
                    {tarefa.statuses.length > 0 ? (
                      <Chip
                        aberto={menu === 'status'}
                        aoAlternar={() => alternar('status')}
                        cheio
                        corStatus={statusAtual?.color ?? null}
                        icone={<span className="cu-ponto" />}
                        rotulo={emFrase(statusAtual?.name ?? 'sem etapa')}
                        desativado={salvando}
                        balao={
                          <MenuDeStatus
                            statuses={tarefa.statuses}
                            valor={tarefa.statusId}
                            aoEscolher={(id) =>
                              void acao(
                                () => api.salvarTarefaDoQuadro(tarefa.id, { statusId: id }),
                                'Etapa trocada — o banco decide o que isso faz com a conclusão.',
                              )
                            }
                            aoFechar={() => setMenu(null)}
                          />
                        }
                      />
                    ) : (
                      <Selo tom="warn">sem etapas</Selo>
                    )}

                    {/* Concluir é a ação mais repetida da ficha; ela mora ao lado
                        do status, que é o que ela muda. Quem escreve a conclusão
                        é `complete_task` — desde a F44_6, o arrasto para a coluna
                        que fecha, com a automação dela; o recado sai da ficha
                        relida (`recadoDaConclusao`). */}
                    <button
                      type="button"
                      className="cu-chip t-concluir"
                      data-cheio={tarefa.completedAt !== null}
                      disabled={salvando}
                      onClick={() =>
                        void acao(
                          () => api.concluirTarefaDoQuadro(tarefa.id, tarefa.completedAt === null),
                          (relida) => recadoDaConclusao(tarefa, relida, tarefa.completedAt === null),
                        )
                      }
                    >
                      <IconeCaixa />
                      <span className="rotulo">{tarefa.completedAt === null ? 'Concluir' : 'Reabrir'}</span>
                    </button>

                    {/* "etapas de Produção" — F43, Fase 6: era "esteira Produção". O
                        nome do conjunto continua aqui (é por ele que se acha a
                        configuração na árvore), e o `title` diz o que ele é. */}
                    {tarefa.statusSetName && (
                      <span
                        className="t-prop-apoio t-prop-esteira"
                        title={`As etapas desta tarefa vêm do conjunto "${tarefa.statusSetName}", o da lista dela`}
                      >
                        etapas de {tarefa.statusSetName}
                      </span>
                    )}
                  </dd>
                </div>

                <div className="t-prop">
                  <dt>Responsáveis</dt>
                  <dd>
                    <Chip
                      aberto={menu === 'pessoas'}
                      aoAlternar={() => alternar('pessoas')}
                      cheio={responsaveis.length > 0}
                      desativado={salvando}
                      icone={
                        responsaveis.length > 0 ? (
                          <span className="cu-pilha">
                            {responsaveis.slice(0, 3).map((p) => (
                              <Avatar key={p.id} pessoa={p} mini />
                            ))}
                          </span>
                        ) : (
                          <IconePessoa />
                        )
                      }
                      rotulo={nomesDosResponsaveis(responsaveis)}
                      balao={
                        <MenuDePessoas
                          diretorio={equipe}
                          escolhidos={rascunho.assigneeIds}
                          meuId={meuId}
                          aoMudar={(ids) => void salvarCampo({ assigneeIds: ids }, { assigneeIds: ids })}
                          aoFechar={() => setMenu(null)}
                        />
                      }
                    />
                  </dd>
                </div>

                <div className="t-prop">
                  <dt>Prazo</dt>
                  <dd>
                    {/* O prazo e o que ele quer dizer hoje, numa peça só: a mesma
                        leitura do cartão (`lerPrazo`), por pedaços, nunca por
                        `Date`. A data inteira fica no `title` e no leitor de tela. */}
                    <Chip
                      aberto={menu === 'data'}
                      aoAlternar={() => alternar('data')}
                      cheio={rascunho.dueOn !== '' || rascunho.startOn !== ''}
                      desativado={salvando}
                      estadoDoPrazo={leituraDoPrazo?.estado}
                      nome={leituraDoPrazo ? `Prazo: ${leituraDoPrazo.completo}` : undefined}
                      icone={<IconeCalendario />}
                      rotulo={
                        leituraDoPrazo?.curto ??
                        (rascunho.startOn !== '' ? `Início ${rotuloDeDia(rascunho.startOn)}` : 'Sem prazo')
                      }
                      balao={
                        <MenuDeData
                          inicio={rascunho.startOn}
                          vencimento={rascunho.dueOn}
                          hoje={hoje}
                          aoMudar={(campo, valor) =>
                            void salvarCampo(
                              campo === 'inicio'
                                ? { startOn: valor === '' ? null : valor }
                                : { dueOn: valor === '' ? null : valor },
                              campo === 'inicio' ? { startOn: valor } : { dueOn: valor },
                            )
                          }
                          aoFechar={() => setMenu(null)}
                        />
                      }
                    />
                    {rascunho.startOn !== '' && rascunho.dueOn !== '' && (
                      <span className="t-prop-apoio tnum">desde {rotuloDeDia(rascunho.startOn)}</span>
                    )}
                  </dd>
                </div>

                <div className="t-prop">
                  <dt>Prioridade</dt>
                  <dd>
                    <Chip
                      aberto={menu === 'prioridade'}
                      aoAlternar={() => alternar('prioridade')}
                      cheio={rascunho.priority !== null}
                      desativado={salvando}
                      icone={
                        <span
                          className="cu-bandeira"
                          style={
                            rascunho.priority
                              ? { ['--cor-bandeira' as string]: PRIORITY_TOKEN[rascunho.priority] }
                              : undefined
                          }
                        >
                          <IconeBandeira />
                        </span>
                      }
                      rotulo={rascunho.priority ? PRIORITY_LABEL[rascunho.priority] : 'Sem prioridade'}
                      balao={
                        <MenuDePrioridade
                          valor={rascunho.priority}
                          aoEscolher={(p) => void salvarCampo({ priority: p }, { priority: p })}
                          aoFechar={() => setMenu(null)}
                        />
                      }
                    />
                  </dd>
                </div>

                <div className="t-prop">
                  <dt>Etiquetas</dt>
                  <dd>
                    {/* As etiquetas moram DENTRO do botão que as troca: antes eram
                        um chip "2 etiquetas" e, mais adiante, as mesmas duas soltas. */}
                    <Chip
                      aberto={menu === 'etiquetas'}
                      aoAlternar={() => alternar('etiquetas')}
                      cheio={tarefa.tags.length > 0}
                      desativado={salvando}
                      nome={
                        tarefa.tags.length > 0
                          ? `Etiquetas: ${tarefa.tags.map((g) => g.name).join(', ')}`
                          : undefined
                      }
                      icone={
                        tarefa.tags.length > 0 ? (
                          <span className="t-etiquetas">
                            {tarefa.tags.map((g) => (
                              <span
                                key={g.id}
                                className="cu-etiqueta"
                                /* A tinta da origem, quando passa de 4,5:1 sobre o fundo
                                   — senão a que o fundo pede (`@/board/tinta-da-etiqueta`). */
                                style={varsDaEtiqueta(g.bgColor, g.fgColor)}
                              >
                                {g.name}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <IconeEtiqueta />
                        )
                      }
                      rotulo={tarefa.tags.length > 0 ? '' : 'Nenhuma'}
                      balao={
                        <MenuDeEtiquetas
                          disponiveis={tarefa.availableTags}
                          escolhidas={rascunho.tagIds}
                          aoMudar={(ids) => void salvarCampo({ tagIds: ids }, { tagIds: ids })}
                          aoCriar={tarefa.spaceId ? criarEtiqueta : undefined}
                          aoFechar={() => setMenu(null)}
                        />
                      }
                    />
                  </dd>
                </div>

                {/* O TIPO DA DEMANDA — F40, Fase 4. Grava ao escolher. Em lista de
                    produção não há "Nenhum" (o servidor recusa apagar); card
                    antigo sem tipo mostra "Sem tipo" e deixa escolher. */}
                {tarefa.listId !== null && (
                  <div className="t-prop" data-prop="tipo">
                    <dt>Tipo</dt>
                    <dd>
                      <SeletorDoTipo
                        rotulo={tarefa.type ? 'Tipo' : ROTULO_SEM_TIPO}
                        valor={tarefa.type ?? null}
                        obrigatorio={tarefa.listIsProduction === true}
                        podeLimpar={tarefa.listIsProduction !== true}
                        desativado={salvando}
                        aoMudar={(type) => void salvarCampo({ type }, {})}
                      />
                    </dd>
                  </div>
                )}

                {/* O CLIENTE, COM A ORIGEM E A TROCA — F38, Fase 7. Aparece
                    sempre que a tarefa está numa lista (antes, só com nome): a
                    tarefa SEM cliente numa lista compartilhada é justamente a
                    que precisa ser vista e corrigida. */}
                {(tarefa.listId !== null || tarefa.clientId !== null) && (
                  <div className="t-prop" data-prop="cliente">
                    <dt>Cliente</dt>
                    <dd>
                      <ClienteNaFicha
                        tarefa={tarefa}
                        aberto={menu === 'cliente'}
                        aoAlternar={() => alternar('cliente')}
                        ocupado={salvando}
                        aoTrocar={(clientId) =>
                          void acao(
                            () => api.trocarClienteDaTarefa(tarefa.id, clientId),
                            'Cliente trocado.',
                          )
                        }
                      />
                    </dd>
                  </div>
                )}
              </dl>

              {/* --- os carimbos ----------------------------------------------- */}
              {/* Na coluna das propriedades quando há duas; em uma coluna, descem
                  para o fim do corpo, antes da conversa — onde sempre estiveram. */}
              <div className="cu-carimbos">
                {rodapeDaFicha(tarefa).map((l) => (
                  <span key={l.rotulo}>
                    <b>{l.rotulo}:</b> <span className="tnum">{l.valor}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* OS DOIS CONTRATOS, DITOS UMA VEZ — F07. O chip grava no clique; o
                texto só vai com Salvar. F43, Fase 6: a frase (`.t-contrato`) saiu
                daqui e foi para o `?` ao lado do estado do texto, na linha do
                Salvar — `EXPLICACAO_DO_SALVAR`. */}
            {/* --- o briefing ------------------------------------------------ */}
            <div className="cu-ficha-corpo">
              <EditorRico
                // O do banco — ou o do rascunho recuperado, enquanto a semente
                // que o trouxe durar (F17.AUD03).
                valorInicial={briefingRecuperado ?? tarefa.description ?? ''}
                semente={`${tarefa.id}:${semente}`}
                desativado={salvando}
                minAltura="12rem"
                aoAnexarImagens={async (arquivos) => {
                  const r = await enviarImagens(tarefa.id, arquivos, (t) => assentar(t, false));
                  if (r.erros.length) erroDaFicha(tarefa.id, r.erros.join(' '));
                  return r.ids;
                }}
                aoMudar={(md) => mexer({ description: md })}
              />
            </div>

            {/* --- os passos: subtarefa e checklist (F17.15) ------------------ */}
            {/*
              A ORDEM É A DA FICHA REAL. No ClickUp, entre o briefing e os anexos
              vêm: campos personalizados (F17.5) · SUBTAREFA · dependências ·
              CHECKLIST · ANEXOS (F17.6). As duas que continuam de fora — campos
              personalizados e dependências — não são desenhadas: botão morto é
              pior que botão ausente, e há teste que falha se aparecerem.
            */}
            <PassosDaTarefa
              tarefa={tarefa}
              equipe={equipe}
              meuId={meuId}
              hoje={hoje}
              ocupado={salvando}
              /* F43, Fase 6: a seção vazia só aparece quando a pessoa a pede
                 pela linha "+" — e a linha de criação de subtarefa deixou de
                 nascer aberta em toda tarefa sem subtarefa. */
              mostrarSubtarefas={!vazias.includes('subtarefas') || pedidasAqui.includes('subtarefas')}
              mostrarChecklists={!vazias.includes('checklists')}
              focarSubtarefa={focarAqui === 'subtarefas'}
              aoFecharSubtarefa={recolherSubtarefas}
              /*
                `false`: a resposta traz a ficha inteira, mas o TÍTULO e o BRIEFING
                que estão sendo digitados têm que sobreviver. Criar uma subtarefa
                no meio de um briefing não pode apagar o briefing.

                E a ficha que volta só entra se ainda for a da vez — é `assentar`
                quem pergunta (F17.AUD01). O erro, idem: `erroDaFicha` leva o id
                desta ficha, e um erro atrasado de outra tarefa não aparece aqui.
              */
              aoAssentar={(t) => {
                assentar(t, false);
                /* SUBTAREFA É TAREFA — F17.CARGA02. Criar, concluir ou apagar
                   uma aqui mexe no `feitas/total` da mesma lista, e a árvore ao
                   lado desenha esse número. */
                void invalidarArvore(cliente);
              }}
              aoErro={(m) => erroDaFicha(tarefa.id, m)}
            />

            {/* --- 📎 anexar arquivo, e o link ao lado (F17.6) ---------------- */}
            {/*
              A ÚLTIMA seção do corpo, como na referência: `📎 Anexar arquivo` vem
              depois de subtarefa e checklist. O link externo entra junto porque
              responde a mesma pergunta — "onde está o arquivo desta tarefa?" —,
              um no balde e outro fora.
            */}
            {(!vazias.includes('anexos') || pedidasAqui.includes('anexos')) && (
              <AnexosDaTarefa
                tarefa={tarefa}
                ocupado={salvando}
                envioPronto={envioDeArquivo.ready}
                variavelQueFalta={envioDeArquivo.variable}
                aoAssentar={(t) => assentar(t, false)}
                aoErro={(m) => erroDaFicha(tarefa.id, m)}
                focar={focarAqui === 'anexos'}
              />
            )}

            {/* --- "+ Subtarefa · + Checklist · + Anexo" — F43, Fase 6 ------- */}
            {faltam.length > 0 && (
              <LinhaDeAcrescentar secoes={faltam} ocupado={salvando} aoEscolher={pedir} />
            )}

            {/* --- "Solicitar aprovação" — F42, Fase 4 ------------------------ */}
            {/* Logo depois dos anexos: é ali que estão os links do Dropbox que a
                janela pré-lista. Só aparece para cliente com a aprovação ligada. */}
            <AprovacaoNaFicha
              tarefa={tarefa}
              descricaoPorSalvar={'description' in pedido}
              aoAssentar={(t) => assentar(t, false)}
            />

            {/* Os carimbos saíram daqui para `.t-lado`, junto das propriedades —
                F43, Fase 6. Em uma coluna eles continuam aparecendo neste
                ponto (`order` em `tarefa.css`). */}

            {/* ⚠️ AQUI HAVIA O BLOCO `O que aconteceu sozinho` DA F17.41, E ELE
                SAIU NA F17.65. Ele desenhava o registro da automação num quadro à
                parte, no pé da ficha. Duas coisas o tornaram errado:

                  · `task_events` passou a guardar a mudança feita À MÃO, e o
                    título mentiria — quase nada ali acontece sozinho;
                  · *"os comentários no meio, na mesma linha do tempo"*. Um bloco
                    à parte não intercala.

                O histórico agora é uma LINHA DO TEMPO dentro da conversa, logo
                abaixo — mudanças e falas na mesma ordem. Ver `board/historico.ts`
                e `ConversaDaTarefa`. */}

            {/* --- a conversa, F17.6 ------------------------------------------ */}
            {/*
              DENTRO DA FICHA DESDE A F43, FASE 6, e não mais um bloco abaixo do
              cartão. A decisão da F17.6 continua de pé — a conversa NÃO é
              coluna; quem vai para o lado, quando a ficha é larga, são as
              propriedades. Ela vem logo depois do conteúdo, na coluna do
              trabalho, e por isso sobe para a primeira dobra a 1440px. Em uma
              coluna (1366px, celular), a ordem é a de antes: carimbos e conversa.
              O porquê inteiro está em `ConversaDaTarefa.tsx`.
            */}
            <ConversaDaTarefa
              key={tarefa.id}
              tarefa={tarefa}
              ocupado={salvando}
              aoAssentar={(t) => assentar(t, false)}
              aoErro={(m) => erroDaFicha(tarefa.id, m)}
            />
          </div>
        </section>
      )}

      {janelaDaMudanca}
    </ProvedorDeMencoes>
  );
}
