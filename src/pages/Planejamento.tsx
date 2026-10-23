/**
 * Planejamento do mês — etapa F5.3; desde a F43 (Fase 2), com o contrato na frente.
 *
 * O QUE ESTA TELA RESPONDE
 *   "O que cada cliente tem de contrato, e está acontecendo?" — o pedido mais
 *   importante do Wesley em 08/10/2026 ("tem gente do planejamento que
 *   esquece de atender o cliente porque não viu"). Ela abre na visão
 *   **Contrato**: no alto, a faixa "Precisa de atenção" com o motivo escrito
 *   e uma ação; embaixo, a carteira inteira por responsável, uma barra por
 *   tipo (entregue · marcada · sem dia) e o mês do cliente.
 *
 *   A visão **Semanas** é a grade da F35 (a antiga aba Semana), intacta. A
 *   visão **Calendário** é o calendário editorial de todos, que até a Fase 4
 *   era a tela `/calendario` (o endereço continua e leva para cá).
 *
 * O CLIENTE ABRE AO LADO — Fase 3
 *   Clicar no nome do cliente (ou na ação da faixa) abre o painel do cliente
 *   à direita, sem sair da tela: os passos do mês com as chaves "Planejamento
 *   OK" e "Cliente aprovou" (que moravam na antiga aba Mês), o contrato por
 *   tipo e as peças por semana (`PainelDoCliente`). O cliente mora no
 *   endereço (`?cliente=`), e o link colado abre o painel. A ordem das travas
 *   continua sendo do servidor (`decideRitualChange`): nenhuma tela a copia.
 *
 * UM MÊS SÓ, PARA AS TRÊS VISÕES — e no endereço desde a Fase 4
 *   O mês mora aqui (`?mes=AAAA-MM`, `replace`), e as duas leituras dele
 *   (ritual e semanas) chegam juntas (`usePlanejamentoDoMes`). Trocar de visão
 *   não relê nada nem perde o mês; os números levam o mês de que são (regra
 *   da F35). O link colado — com ou sem `?cliente=` — abre no mês de quem
 *   colou; sem `mes`, ou com um inválido, vale o mês de hoje.
 *
 * UM CONTROLE DE CADA COISA NA TELA — Fase 4
 *   Na visão Calendário, o mês do topo dá lugar à barra do calendário (‹ ›,
 *   o campo do mês, Hoje, o período, Mês/Agenda), que já fazia tudo o que o
 *   topo faz e mais: dois "Próximo mês" na mesma tela seriam dois botões com
 *   o mesmo nome. E o `+ Peça` do topo é o `+ Marcar` do Calendário — a mesma
 *   janela, a mesma lista —: um botão só, que na visão Calendário se chama
 *   `+ Marcar`, como sempre se chamou ali (a agenda vazia manda usar o
 *   "+ Marcar").
 *
 * ELA FALA EM MÊS, NÃO EM INTERVALO
 *   O que se planeja e se aprova é o contrato de um mês. Intervalo não tem
 *   contrato.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { TelaComBarra } from '@/board/TelaComBarra';
import { ApiError, api, semSessao } from '@/lib/api';
import { CalendarioGeral } from '@/painel/CalendarioGeral';
import { FaixaDeAtencao } from '@/painel/FaixaDeAtencao';
import { GradeDaSemana, type PedidoDeCriacao } from '@/painel/GradeDaSemana';
import { PainelDoCliente } from '@/painel/PainelDoCliente';
import { planejarMes } from '@/painel/planejamento-do-mes';
import { usePlanejamentoDoMes } from '@/painel/usar-planejamento-do-mes';
import { VisaoDoContrato } from '@/painel/VisaoDoContrato';
import {
  ROTULO_DA_VISAO,
  VISOES,
  type Visao,
  clienteDoEndereco,
  enderecoDoPainel,
  fraseDaFalha,
  itemDaBarraDaVisao,
  mesDoEndereco,
  mudancasDaVisao,
  mudancasDoMes,
  mudancasDoPainel,
  visaoDoEndereco,
} from '@/painel/visoes-do-planejamento';
import type { PlanningWeeksRow } from '@/server/planning-weeks';
import { idDaAba } from '@/ui/abas';
import { Abas } from '@/ui/AlternadorDeVista';
import { useParametrosNoEndereco } from '@/ui/endereco';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import {
  type EntradaDoMes,
  deslocarMes,
  hojeNaAgencia,
  meioDiaDoDia,
  mesDeHoje,
  nomeDoMes as nomeDoMesMinusculo,
} from '@/ui/grade-do-mes';
import { IconeDireita, IconeEsquerda } from '@/ui/Icones';
import { type AlvoDaMarcacao, type ClienteParaEscolher, MarcarNoDia } from '@/ui/MarcarNoDia';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { SeletorDeDia } from '@/ui/SeletorDeDia';
import { Aviso, PaginaLarga } from '@/ui/primitivos';
import { ehAdmin, useSessao } from '@/ui/sessao';
import { Topo } from '@/ui/Topo';

/** "Setembro de 2026" — sem `Date`, e o mês corrente no fuso da agência (F12). */
const nomeDoMes = (mes: string) => {
  const texto = nomeDoMesMinusculo(mes);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

export default function Planejamento() {
  /* A VISÃO MORA NO ENDEREÇO — F35/F43. `?visao=semanas` colado num
     comentário abre a grade; o `?aba=semana` de antes da F43 também
     (`visaoDoEndereco`). `replace`, como toda escolha de tela: o VOLTAR sai
     da tela. Escolher grava `visao` e apaga o `aba` antigo. */
  const [parametros, definirParametros] = useParametrosNoEndereco();
  const visao = visaoDoEndereco(parametros);
  const escolherVisao = (v: Visao) => definirParametros(mudancasDaVisao(v));

  /* O MÊS TAMBÉM — Fase 4. Sem `?mes=`, o mês de hoje no fuso da agência
     (F12), fixado ao ABRIR a tela: quem a deixa aberta na virada do mês não
     vê o mês trocar sozinho embaixo do que estava fazendo — era o que o
     `useState` de antes garantia. */
  const [mesDePartida] = useState(() => mesDeHoje());
  const mes = mesDoEndereco(parametros, mesDePartida);
  const irParaMes = (novo: string) => definirParametros(mudancasDoMes(novo));

  const [vez, setVez] = useState(0);
  const { dados, erro, carregando, proximaLeitura } = usePlanejamentoDoMes(mes, vez);
  /* Relê o mês e devolve a promessa de quando ele CHEGA — a `Semanal` do
     painel do cliente espera por ela antes de soltar o próximo clique (ver
     `criarEsperaDaReleitura`). A espera é pedida ANTES de aumentar `vez`, para
     contar só a leitura que este pedido dispara. */
  const recarregar = () => {
    const relido = proximaLeitura();
    setVez((v) => v + 1);
    return relido;
  };
  // O dia de Brasília, não o do computador (F12): é ele que decide "esta
  // semana", o atrasado e o "em risco".
  const hoje = hojeNaAgencia();
  const linhas = useMemo(
    () => (dados ? planejarMes({ ritual: dados.ritual, semanas: dados.semanas, mes, hoje }) : null),
    [dados, mes, hoje],
  );
  /** O "Filtrar cliente" da visão Contrato. Fica ao trocar de mês: é o mesmo cliente. */
  const [filtro, setFiltro] = useState('');
  /** O "Só o que falta" da antiga aba Mês (Fase 4), na visão Contrato. Fica ao trocar de mês, como o filtro. */
  const [soFalta, setSoFalta] = useState(false);

  /* O PAINEL DO CLIENTE MORA NO ENDEREÇO — Fase 3. `?cliente=<id>` abre o
     painel (o link colado também); fechar tira a chave. Os dois com
     `replace`, como a visão. O cliente sai da MESMA leitura do mês: trocar de
     mês com o painel aberto mostra o mês novo do mesmo cliente. */
  const idDoPainel = clienteDoEndereco(parametros);
  const linhaDoPainel = idDoPainel === null ? null : (linhas?.find((l) => l.id === idDoPainel) ?? null);
  const hrefDoPainel = (id: string) => enderecoDoPainel(parametros, id);
  const fecharPainel = () => definirParametros(mudancasDoPainel(null));
  /* As chaves do mês são de administrador (a política do banco). Enquanto a
     sessão não chega, `null`: chaves desligadas, sem dizer "só administrador"
     a quem talvez seja um. */
  const { sessao, carregando: lendoASessao } = useSessao();
  const souAdmin = sessao === null && lendoASessao ? null : ehAdmin(sessao);

  /* `+ PEÇA` / `+ MARCAR` — uma janela só (`MarcarNoDia`) para o botão do
     topo e, na visão Calendário, para o `+` de cada dia e o clique na peça.
     Do topo ela abre no modo novo, sem dia e sem cliente escolhidos.

     DE QUEM É — F17.44. A lista sai da MESMA rota que a tela de carteira usa
     (`clientesParaCarteira`): ela lê `ideworks.clients` sob o ator, então o
     recorte é `can_see_client`, e não uma segunda regra escrita aqui — a
     F17.32 corrigiu esse alcance depois de 61 contas da Alma 9 aparecerem
     para quem era da Ide. Buscada uma vez, ao abrir a tela; sem ela, a janela
     diz sozinha que não há de quem marcar (um aviso vermelho por causa de um
     seletor que ninguém abriu seria alarme falso). */
  const [alvo, setAlvo] = useState<AlvoDaMarcacao | null>(null);
  const [clientes, setClientes] = useState<ClienteParaEscolher[]>([]);
  useEffect(() => {
    let vivo = true;
    api
      .clientesParaCarteira()
      .then((r) => {
        if (vivo) setClientes(r.clientes ?? []);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <PaginaLarga>
      {/* A BARRA CHEGA AO PLANEJAMENTO — F17.67. Na visão Calendário, o item
          aceso é o `Calendário` (foi por ele que se chegou); nas outras, o
          Planejamento (`itemDaBarraDaVisao`). */}
      <TelaComBarra atual={itemDaBarraDaVisao(visao)}>
        {/* O TOPO — F29/F43. O título, e as três coisas da página na ordem do
            protótipo aprovado: o mês, a visão e a ação principal. No celular
            elas descem para a linha de baixo (o `Topo` quebra), sem empurrar
            a página para o lado. Na visão Calendário o mês daqui sai: quem o
            troca é a barra do calendário, logo abaixo (ver o cabeçalho). */}
        <Topo
          titulo={ROTULO_DO_ITEM.planejamento}
          acoes={
            <>
              {visao !== 'calendario' && (
                <div className="plc-mes" role="group" aria-label="Mês do planejamento">
                  <button
                    type="button"
                    className="o-btn o-btn-fantasma o-btn-icone"
                    onClick={() => irParaMes(deslocarMes(mes, -1))}
                    title="Mês anterior"
                    aria-label="Mês anterior"
                  >
                    <IconeEsquerda />
                  </button>
                  <span className="plc-mes-nome tnum" aria-live="polite">
                    {nomeDoMes(mes)}
                  </span>
                  <button
                    type="button"
                    className="o-btn o-btn-fantasma o-btn-icone"
                    onClick={() => irParaMes(deslocarMes(mes, 1))}
                    title="Próximo mês"
                    aria-label="Próximo mês"
                  >
                    <IconeDireita />
                  </button>
                </div>
              )}
              <Abas
                rotulo="Visão do planejamento"
                base="pl"
                idDoPainel="pl-painel"
                valor={visao}
                aoEscolher={escolherVisao}
                opcoes={VISOES.map((v) => ({ valor: v, rotulo: ROTULO_DA_VISAO[v] }))}
              />
              <button
                type="button"
                className="o-btn o-btn-solido plc-nova-peca"
                aria-haspopup="dialog"
                onClick={() => setAlvo({ modo: 'novo', dia: null })}
              >
                {visao === 'calendario' ? '+ Marcar' : '+ Peça'}
              </button>
            </>
          }
        />

        <div role="tabpanel" id="pl-painel" aria-labelledby={idDaAba('pl', visao)}>
          {/* O CALENDÁRIO TEM A LEITURA DELE — `GET /calendar`, com o
              carregando, o erro e o vazio próprios; os do ritual e das
              semanas não são dele e ficam fora desta visão. A leitura do mês
              continua chegando por trás: o painel do cliente e as outras
              visões a usam sem reler. */}
          {visao === 'calendario' ? (
            <CalendarioGeral mes={mes} aoMudarMes={irParaMes} hoje={hoje} recarga={vez} aoMarcar={setAlvo} />
          ) : (
            <>
              {/* O ERRO DIZ DE QUE MÊS É — e nenhum número de outro mês fica
                  embaixo dele (`leituraDoMes`). */}
              {erro !== null && (
                <div className="mb-3">
                  <Aviso tipo="erro" acao={{ rotulo: 'Tentar de novo', aoClicar: recarregar }}>
                    {fraseDaFalha(mes, erro)}
                  </Aviso>
                </div>
              )}

              {carregando && <EstadoDaPagina tipo="carregando" titulo={`Carregando ${nomeDoMesMinusculo(mes)}…`} />}

              {linhas !== null && linhas.length === 0 && (
                <EstadoDaPagina tipo="vazio" titulo="Nenhum cliente ativo neste mês.">
                  Clientes ativos aparecem aqui com o contrato do mês e as peças de cada semana.
                </EstadoDaPagina>
              )}

              {dados !== null && linhas !== null && linhas.length > 0 &&
                (visao === 'contrato' ? (
                  <>
                    <FaixaDeAtencao linhas={linhas} mes={mes} hoje={hoje} enderecoDoPainel={hrefDoPainel} />
                    <VisaoDoContrato
                      linhas={linhas}
                      mes={mes}
                      hoje={hoje}
                      filtro={filtro}
                      aoFiltrar={setFiltro}
                      soFalta={soFalta}
                      aoMudarSoFalta={setSoFalta}
                      enderecoDoPainel={hrefDoPainel}
                    />
                  </>
                ) : (
                  // `key`: trocar de mês recomeça o pedido de criação, o erro dela
                  // e a rolagem até a semana atual.
                  <SemanaDoMes key={mes} mes={mes} hoje={hoje} clientes={dados.semanas} aoMudar={recarregar} />
                ))}
            </>
          )}
        </div>

        {/* Gravou aqui (em qualquer visão), relê tudo: o mês das visões e o
            calendário (`recarga`). */}
        {alvo && (
          <MarcarNoDia
            alvo={alvo}
            clienteFixo={null}
            clientes={clientes}
            aoFechar={() => setAlvo(null)}
            aoMudar={recarregar}
          />
        )}

        {/* `key`: outro cliente é outro painel — a recusa e a chave virada
            do anterior não passam para ele. */}
        {idDoPainel !== null && (
          <PainelDoCliente
            key={idDoPainel}
            id={idDoPainel}
            linha={linhaDoPainel}
            mes={mes}
            hoje={hoje}
            carregando={carregando}
            erro={erro}
            souAdmin={souAdmin}
            aoFechar={fecharPainel}
            aoMudar={recarregar}
            aoMudarMes={(passo) => irParaMes(deslocarMes(mes, passo))}
          />
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}

/**
 * A visão Semanas — F35 (a antiga aba Semana). O mês cliente a cliente, por
 * responsável, semanas nas colunas. Os dados chegam da página (a mesma
 * leitura da visão Contrato); esta parte só cria, abre e rola. O desenho é
 * `GradeDaSemana`, puro.
 */
function SemanaDoMes({
  mes,
  hoje,
  clientes,
  aoMudar,
}: {
  mes: string;
  hoje: string;
  clientes: readonly PlanningWeeksRow[];
  /** Releia o mês — depois de criar ou de mexer numa peça. */
  aoMudar: () => void;
}) {
  const [aberta, setAberta] = useState<EntradaDoMes | null>(null);
  /** O `+` que abriu o seletor de dia — nada grava antes do clique no dia. */
  const [pedido, setPedido] = useState<PedidoDeCriacao | null>(null);
  const [criando, setCriando] = useState(false);
  /** A recusa da criação, na frase do servidor. A grade não muda. */
  const [erroDaCriacao, setErroDaCriacao] = useState<string | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);

  /* CRIAR PELA CÉLULA — F35, Fase 4. A mesma criação da ficha e do
     Calendário (`POST /items`), SEM `isExtra`: omitir é dizer "decida você",
     e o servidor decide com a cota do mês (ver `api.criarItem`). Deu certo,
     relê o mês; recusou, a frase dele vira aviso e nada se relê. */
  async function criarNoDia(p: PedidoDeCriacao, dia: string) {
    setPedido(null);
    setCriando(true);
    setErroDaCriacao(null);
    try {
      await api.criarItem(p.cliente.id, `${mes}-01`, p.tipo, undefined, meioDiaDoDia(dia));
      aoMudar();
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setErroDaCriacao(e instanceof ApiError ? e.message : 'Não foi possível criar a entrega.');
    } finally {
      setCriando(false);
    }
  }

  /* A SEMANA ATUAL JÁ À VISTA — no celular a grade rola de lado, e abrir na
     semana 1 no dia 27 esconderia justamente a semana que importa. Rola só o
     contêiner da grade (nunca a página), descontando a coluna fixa dos nomes.
     Depende de "há grade", não dos dados: reler depois de criar não arrasta a
     rolagem de quem está olhando outra semana. */
  const temGrade = clientes.length > 0;
  useEffect(() => {
    if (!temGrade) return;
    const caixa = rolagem.current?.querySelector<HTMLElement>('[data-pls-rolagem]');
    const atual = caixa?.querySelector<HTMLElement>('th[data-atual]');
    const fixa = caixa?.querySelector<HTMLElement>('thead .pls-quem');
    if (!caixa || !atual) return;
    const largura = fixa?.getBoundingClientRect().width ?? 0;
    const desvio = atual.getBoundingClientRect().left - caixa.getBoundingClientRect().left;
    if (desvio < largura || desvio + atual.offsetWidth > caixa.clientWidth) {
      caixa.scrollLeft += desvio - largura;
    }
  }, [temGrade, mes]);

  return (
    <div ref={rolagem}>
      {erroDaCriacao && (
        <div className="mb-3">
          <Aviso tipo="erro">{erroDaCriacao}</Aviso>
        </div>
      )}

      <GradeDaSemana
        mes={mes}
        hoje={hoje}
        clientes={clientes}
        aoAbrirPeca={setAberta}
        aoCriar={setPedido}
        ocupado={criando}
      />

      {/* O SELETOR DE DIA DA FICHA, limitado à semana do `+`. Preso ao botão
          por `ancora`: o balão vai para o `body` e a rolagem lateral da grade
          não o corta. Nenhum dia nasce marcado. */}
      {pedido && (
        <SeletorDeDia
          rotulo="Escolher o dia"
          mesInicial={mes}
          faixa={{ de: pedido.semana.de, ate: pedido.semana.ate }}
          apenasNaFaixa
          ancora={pedido.ancora}
          aoFechar={() => setPedido(null)}
          aoEscolher={(dia) => void criarNoDia(pedido, dia)}
        />
      )}

      {/* A MESMA JANELA DO CALENDÁRIO — abrir a peça aqui ou lá é a mesma coisa. */}
      {aberta && (
        <MarcarNoDia
          alvo={{ modo: 'existente', entrada: aberta }}
          clienteFixo={null}
          clientes={[]}
          aoFechar={() => setAberta(null)}
          aoMudar={aoMudar}
        />
      )}
    </div>
  );
}
