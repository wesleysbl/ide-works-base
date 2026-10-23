/**
 * Pessoas: hierarquia, empresas, áreas e carteira — etapas F12 a F14.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUATRO EIXOS, E CADA UM RESPONDE UMA PERGUNTA DIFERENTE
 *
 *   PAPEL     o que a pessoa pode FAZER com o sistema e com as outras pessoas.
 *             super admin > administrador > funcionário.
 *
 *   EMPRESA   de qual carteira ela participa. Alma9, Ide, Ide Hub — que é o
 *             balde do que as duas compartilham. Quem é da A9 recebe
 *             {Alma9, Ide Hub}; quem é da Ide recebe {Ide, Ide Hub}.
 *
 *             ⚠️ NA TELA ELA SE CHAMA "UNIDADE" DESDE A F31. O sistema "será
 *             apenas Ide" (Wesley, 25/09), e "Empresas" num botão de cada
 *             linha fazia a Alma parecer parte da operação. O eixo continua
 *             o mesmo (`user_categories`), com o nome que Catálogos já usava.
 *
 *   ÁREA      quais TELAS ela alcança. Entrega, Meta, Catálogos, Pessoas.
 *
 *   CARTEIRA  clientes soltos, fora da empresa dela. É a exceção, não a regra:
 *             o normal é a empresa decidir.
 *
 *   Misturar dois deles numa chave só foi tentador e seria errado: há
 *   funcionário da Ide que precisa de um cliente da A9, e há administrador que
 *   não deve ver a Meta.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE SÓ O SUPER ADMIN FAZ
 *   Criar outro super admin, apagar pessoa, e mudar empresa. As três são as
 *   irreversíveis ou as que mudam o alcance inteiro de alguém de uma vez.
 *
 *   A tela esconde esses botões de quem não é — mas a regra que vale está no
 *   banco, e vale para qualquer caminho. Esconder é cortesia com quem clica.
 *
 * A FILA NÃO É DE APROVAÇÃO
 *   No legado qualquer um se cadastrava e alguém auditava depois. Aqui não há
 *   autocadastro (decisão D3), então a fila é outra coisa: os convites que
 *   existem e ainda não viraram conta. O que se faz nela é cobrar quem não
 *   entrou, ou cancelar o código.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { INVITATION_TTL_HOURS, formatCode } from '@/auth/activation-code';
import { type Area, AREAS, DESCRICAO_DA_AREA, ROTULO_DA_AREA } from '@/auth/areas';
import { CODE_SHOWN_ONCE_WARNING, buildResetMessage } from '@/auth/invitation-message';
import {
  type Papel,
  DESCRICAO_DO_PAPEL,
  PAPEIS,
  ROTULO_DO_PAPEL,
  podeAtribuir,
  podeMexerNoPapel,
} from '@/auth/papeis';
import { TelaComBarra } from '@/board/TelaComBarra';
import { Ajuda } from '@/board/menus';
import { ApiError, api, semSessao } from '@/lib/api';
/* MUDAR PESSOA MUDA O DIRETÓRIO — F17.CARGA03. O seletor de responsável das
   telas do quadro lê `/team` de um cache compartilhado; sem este aviso ele
   continuaria oferecendo quem acabou de ser desativado. */
import { invalidarEquipe, useClienteDeConsultas } from '@/lib/consultas';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { dataCurtaDoInstante } from '@/ui/grade-do-mes';
import { IconeLixeira } from '@/ui/Icones';
// As janelas desta tela abrem POR CIMA desde a F17.33 — antes elas caíam como
// um cartão no fim da página. Ver o cabeçalho de `@/ui/janela`.
import { BotaoDeFechar, Janela } from '@/ui/janela';
import { Menu, type Opcao } from '@/ui/Menu';
import { Aviso, CampoDeBusca, Chave, PaginaLarga, Pilula, Selo } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';

type Pessoa = {
  id: string;
  email: string;
  nome: string | null;
  papel: Papel;
  isSuperadmin: boolean;
  isActive: boolean;
  todosOsClientes: boolean;
  areas: Area[];
  clientes: number;
  empresas: number;
  criadaEm: string | null;
};

type Item = { id: string; nome: string };

type Convite = {
  id: string;
  email: string;
  expiraEm: string;
  tentativasFalhas: number;
  criadoEm: string;
  vencido: boolean;
  /** `invite` dá acesso; `reset` deixa escolher senha nova — F17.31. */
  intencao: 'invite' | 'reset';
};

/** O código recém-gerado, mostrado uma vez e nunca mais — F17.31. */
type Redefinicao = { pessoa: Pessoa; code: string; expiraEm: string; origem: HTMLElement | null };

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** O que a pessoa alcança, numa frase. É a coluna que a tela existe para ter. */
function alcanceDe(p: Pessoa): { texto: string; tom: 'ok' | 'warn' | 'neutro' } {
  if (!p.isActive) return { texto: 'desativada — não entra', tom: 'warn' };
  if (p.papel === 'super_admin') return { texto: 'tudo, e manda no sistema', tom: 'ok' };
  if (p.areas.length === 0) {
    // Sem área nenhuma a pessoa entra e não alcança tela alguma — nem com a
    // carteira cheia. Vem antes porque é o que manda.
    return { texto: 'nenhuma área — não abre tela nenhuma', tom: 'warn' };
  }
  if (p.todosOsClientes) return { texto: 'todos os clientes', tom: 'ok' };
  // "UNIDADE", E NÃO "EMPRESA" — F31. É o mesmo nome do botão da linha e da
  // seção de Catálogos; três palavras para a mesma coisa pediam tradução.
  if (p.empresas === 0 && p.clientes === 0) {
    return { texto: 'nenhuma unidade nem cliente — telas vazias', tom: 'warn' };
  }
  const partes = [];
  if (p.empresas > 0) partes.push(`${p.empresas} unidade(s)`);
  if (p.clientes > 0) partes.push(`${p.clientes} cliente(s) à parte`);
  return { texto: partes.join(' · '), tom: 'neutro' };
}

export default function Pessoas() {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [eu, setEu] = useState('');
  const [meuPapel, setMeuPapel] = useState<Papel>('funcionario');
  /** A falha da LEITURA — a tela não tem o que mostrar. */
  const [falha, setFalha] = useState<{ mensagem: string; status: number | null } | null>(null);
  /** A falha de uma ESCRITA — a lista continua valendo, e a frase vem do banco. */
  const [erro, setErro] = useState<string | null>(null);
  /** O que acabou de dar certo, dito com o nome de quem mudou — F13. */
  const [recado, setRecado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  /** A linha (pessoa ou convite) com uma escrita em curso: só ela trava. */
  const [ocupada, setOcupada] = useState<string | null>(null);
  // A TRAVA DE VERDADE É A REF: dois cliques no mesmo quadro de animação
  // chegam antes de o `disabled` desenhar, e os dois leriam `ocupada` nula.
  const escrevendo = useRef(false);
  const [busca, setBusca] = useState('');
  const [porPapel, setPorPapel] = useState<Papel | null>(null);
  const [editando, setEditando] = useState<{ pessoa: Pessoa; que: 'carteira' | 'empresas' } | null>(
    null,
  );
  const [cadastro, setCadastro] = useState<{ pessoa: Pessoa; origem: HTMLElement } | null>(null);
  const [redefinicao, setRedefinicao] = useState<Redefinicao | null>(null);

  const cliente = useClienteDeConsultas();

  const carregar = useCallback(async () => {
    try {
      const [r, f] = await Promise.all([api.pessoas(), api.filaDeAcesso().catch(() => null)]);
      const lista = r.pessoas as Pessoa[];
      setPessoas(lista);
      setEu(r.eu);
      setMeuPapel(lista.find((p) => p.id === r.eu)?.papel ?? 'funcionario');
      if (f) setConvites(f.convites);
      setFalha(null);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setFalha({
        mensagem: e instanceof ApiError ? e.message : 'Não foi possível carregar as pessoas.',
        status: e instanceof ApiError ? e.status : null,
      });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * O FUNIL DE TODA ESCRITA DESTA TELA — e por isso a invalidação mora aqui.
   *
   * Aprovar quem estava na fila, trocar papel, desativar, apagar, mudar as
   * áreas, as empresas ou a carteira: os seis passam por aqui. Chamar
   * `invalidarEquipe` em cada um seria seis lugares para o sétimo esquecer.
   *
   * ⚠️ DEPOIS DO GESTO, E NÃO AO MONTAR A TELA — F17.CARGA03. A leitura do
   * diretório é compartilhada e vale trinta segundos; invalidar na montagem
   * faria toda visita a `Pessoas` pagar uma leitura que ninguém pediu.
   *
   * Nem toda escrita daqui muda o diretório (trocar as áreas de alguém não
   * muda quem pode receber tarefa), e mesmo assim todas invalidam: uma
   * invalidação a mais custa UMA leitura de oito nomes na próxima tela que
   * precisar dela; uma a menos custa um seletor que mente até o cache vencer.
   *
   * F13: a linha que está salvando trava (`ocupada`) — dois cliques rápidos
   * numa chave não mandam dois pedidos —, e o resultado é DITO: "Papel de Ana:
   * Administrador" em vez de a lista recarregar calada. Devolve a frase da
   * recusa (ou nula), para a janela que chamou mostrá-la ao lado do campo.
   */
  async function mudar(
    acao: () => Promise<unknown>,
    { linha, feito, naJanela = false }: { linha: string; feito: string; naJanela?: boolean },
  ): Promise<string | null> {
    if (escrevendo.current) return null;
    escrevendo.current = true;
    setErro(null);
    setRecado(null);
    setOcupada(linha);
    let recusa: string | null = null;
    try {
      await acao();
      setRecado(feito);
    } catch (e) {
      // A frase vem do banco e chega inteira: "só o super admin cria outro
      // super admin" só serve se a pessoa a ler.
      recusa = e instanceof ApiError ? e.message : 'Não foi possível salvar. Tente de novo.';
      if (!naJanela) setErro(recusa);
    }
    void invalidarEquipe(cliente);
    await carregar();
    escrevendo.current = false;
    setOcupada(null);
    return recusa;
  }

  const visiveis = useMemo(() => {
    const alvo = semAcento(busca.trim());
    return pessoas
      .filter((p) => porPapel === null || p.papel === porPapel)
      .filter((p) => alvo === '' || semAcento(`${p.nome ?? ''} ${p.email}`).includes(alvo));
  }, [pessoas, busca, porPapel]);

  const contagem = useMemo(() => {
    const m = new Map<Papel, number>();
    for (const p of pessoas) m.set(p.papel, (m.get(p.papel) ?? 0) + 1);
    return m;
  }, [pessoas]);

  const opcoesDePapel = useMemo<Opcao[]>(
    () => [
      { valor: null, rotulo: 'Todos os papéis', contagem: pessoas.length },
      ...PAPEIS.map((p) => ({
        valor: p,
        rotulo: ROTULO_DO_PAPEL[p],
        contagem: contagem.get(p) ?? 0,
      })),
    ],
    [contagem, pessoas.length],
  );

  /**
   * Gera o código e o mostra. UMA VEZ — o banco guarda só a impressão digital.
   *
   * Não recarrega a lista antes de mostrar: a recarga é o que fecharia a
   * janela, e com ela o único momento em que o código existe.
   */
  async function redefinir(p: Pessoa, origem: HTMLElement | null) {
    if (escrevendo.current) return;
    escrevendo.current = true;
    setErro(null);
    setRecado(null);
    setOcupada(p.id);
    try {
      const r = await api.gerarRedefinicao(p.id);
      setRedefinicao({ pessoa: p, code: r.code, expiraEm: r.expiresAt, origem });
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível gerar o código. Tente de novo.');
    } finally {
      escrevendo.current = false;
      setOcupada(null);
    }
  }

  const naFila = convites.filter((c) => c.intencao === 'invite');
  const ativas = pessoas.filter((p) => p.isActive);
  const semAlcance = ativas.filter(
    (p) =>
      p.papel !== 'super_admin' &&
      (p.areas.length === 0 || (!p.todosOsClientes && p.empresas === 0 && p.clientes === 0)),
  );
  const supers = ativas.filter((p) => p.papel === 'super_admin');
  const filtrando = busca.trim() !== '' || porPapel !== null;
  // SEM ACESSO NÃO GANHA CAMINHO NOVO — F13. Quem recebeu 403 aqui não vê o
  // `Convidar alguém`: a rota do convite recusaria do mesmo jeito.
  const semAcesso = falha?.status === 403;
  const nomeDe = (p: Pessoa) => p.nome ?? p.email;

  return (
    <PaginaLarga>
      {/* A BARRA CHEGA A PESSOAS — F17.67, e sem `atual` pelo mesmo motivo dos
          catálogos: `pessoas` é outra área, e nenhum dos sete itens da barra é
          esta tela. Medido: das 17 contas ativas, nenhuma tem `pessoas` sem ter
          `quadro` e `entrega` — a barra chega cheia a quem entra aqui.

          As duas janelas do fim (editar lista e código de senha) ficam FORA da
          grade: são sobreposições da tela inteira, não conteúdo de coluna. */}
      <TelaComBarra contexto="administracao">
        {/* O TOPO — F29 (Fase 5a). Saíram o `Sistema IDE · administração` de
            cima do título e o `‹ Painel` à mão: Pessoas é tela principal (o
            menu da conta leva a ela), e o caminho para o Painel é a barra.
            Fica a ação da página, convidar.

            Havia aqui "Papel, empresa, telas e carteira — nesta ordem de
            importância". Saiu na F17.37: é a tela lendo em voz alta os
            próprios cabeçalhos, que estão logo abaixo dela. */}
        <Topo
          titulo="Pessoas"
          acoes={
            semAcesso ? undefined : (
              <Link to="/contas" className="o-btn o-btn-solido o-btn-sm">
                Convidar alguém
              </Link>
            )
          }
        />

        {carregando && <EstadoDaPagina tipo="carregando" titulo="Carregando as pessoas…" linhas={4} />}

        {!carregando && semAcesso && (
          <EstadoDaPagina tipo="sem-acesso" titulo="Pessoas não está entre as suas áreas">
            {falha?.mensagem}
          </EstadoDaPagina>
        )}

        {!carregando && falha && !semAcesso && (
          <EstadoDaPagina
            tipo="erro"
            titulo={falha.mensagem}
            acao={{
              rotulo: 'Tentar de novo',
              aoClicar: () => {
                setCarregando(true);
                void carregar();
              },
            }}
          />
        )}

        {!carregando && !falha && (
          <>
            {erro && (
              <div className="ad-aviso">
                <Aviso tipo="erro">{erro}</Aviso>
              </div>
            )}
            {recado && (
              <p className="ad-recado" role="status">
                {recado}
              </p>
            )}

            <dl className="ad-numeros" aria-label="Resumo das pessoas">
              <Numero rotulo="Pessoas ativas" valor={ativas.length} />
              <Numero
                rotulo="Super admins"
                valor={supers.length}
                // Um só é ponto único de falha: se essa pessoa sair, ninguém mais
                // cria super admin nem apaga conta — e não há conserto por dentro.
                tom={supers.length === 1 ? 'warn' : undefined}
                nota={supers.length === 1 ? 'só um: se ele sair, ninguém assume' : undefined}
              />
              <Numero
                rotulo="Sem alcance"
                valor={semAlcance.length}
                tom={semAlcance.length > 0 ? 'warn' : undefined}
                nota={semAlcance.length > 0 ? 'entram e não veem nada' : undefined}
              />
              {/* Só os convites: um código de senha é de quem JÁ entrou, e contá-lo
                  aqui faria a fila dizer que alguém está esperando sem estar. */}
              <Numero rotulo="Na fila" valor={naFila.length} nota="convidados, ainda não entraram" />
            </dl>

            {/* --- a fila ------------------------------------------------------- */}
            {convites.length > 0 && (
              <section className="ad-secao" aria-labelledby="ad-codigos">
                <div className="ad-secao-cabeca">
                  <h2 id="ad-codigos" className="ad-secao-titulo">
                    Códigos em aberto <span className="tnum">{convites.length}</span>
                  </h2>
                  <Ajuda sobre="os códigos em aberto">
                    Não é fila de aprovação: aqui ninguém se cadastra sozinho. São os
                    códigos que existem e ainda não foram usados.
                  </Ajuda>
                </div>
                <ul className="ad-lista">
                  {convites.map((c) => (
                    <li key={c.id} className="ad-convite" data-tom={c.vencido ? 'warn' : undefined}>
                      <span className="ad-convite-email">{c.email}</span>
                      <span className="ad-convite-selos">
                        {/* Código pendente é credencial viva. O de senha aparece aqui
                            desde a F17.31 justamente para poder ser cancelado. */}
                        <Selo tom={c.intencao === 'reset' ? 'ok' : 'neutro'}>
                          {c.intencao === 'reset' ? 'senha nova' : 'acesso novo'}
                        </Selo>
                        <Selo tom={c.vencido ? 'warn' : 'neutro'}>
                          {c.vencido ? 'código vencido' : `vale até ${dataCurtaDoInstante(c.expiraEm)}`}
                        </Selo>
                      </span>
                      <span className="ad-convite-meta">
                        convidado em {dataCurtaDoInstante(c.criadoEm)}
                        {c.tentativasFalhas > 0 && (
                          <span className="tnum" data-tom="warn">
                            {' '}· {c.tentativasFalhas} tentativa(s) errada(s)
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="o-btn o-btn-fantasma o-btn-sm ad-convite-acao"
                        disabled={ocupada !== null}
                        aria-label={`Cancelar o código de ${c.email}`}
                        title="Cancelar o convite — o código deixa de valer na hora"
                        onClick={() =>
                          void mudar(() => api.cancelarConvite(c.id), {
                            linha: c.id,
                            feito: `Código de ${c.email} cancelado: ele deixou de valer.`,
                          })
                        }
                      >
                        {ocupada === c.id ? 'Cancelando…' : 'Cancelar'}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* --- filtros e lista ---------------------------------------------- */}
            <section className="ad-secao" aria-labelledby="ad-equipe">
              <div className="ad-secao-cabeca">
                <h2 id="ad-equipe" className="ad-secao-titulo">
                  Equipe <span className="tnum">{pessoas.length}</span>
                </h2>
              </div>
              <div className="ad-ferramentas">
                <Menu
                  rotulo="Papel"
                  opcoes={opcoesDePapel}
                  valor={porPapel}
                  aoEscolher={(v) => setPorPapel(v as Papel | null)}
                />
                <CampoDeBusca
                  rotulo="Buscar por nome ou e-mail"
                  valor={busca}
                  aoMudar={setBusca}
                />
                {filtrando && (
                  <span className="ad-contagem tnum">
                    {visiveis.length} de {pessoas.length}
                  </span>
                )}
              </div>

              {visiveis.length > 0 && (
                <ul className="ad-lista ad-pessoas">
                  {visiveis.map((p) => (
                    <LinhaDePessoa
                      key={p.id}
                      p={p}
                      souEu={p.id === eu}
                      meuPapel={meuPapel}
                      ocupada={ocupada === p.id}
                      travada={ocupada !== null}
                      aoMudar={(acao, feito) => void mudar(acao, { linha: p.id, feito })}
                      aoAbrir={(que) => setEditando({ pessoa: p, que })}
                      aoEditar={(origem) => setCadastro({ pessoa: p, origem })}
                      aoRedefinir={(origem) => void redefinir(p, origem)}
                    />
                  ))}
                </ul>
              )}
              {visiveis.length === 0 && filtrando && (
                <EstadoDaPagina
                  tipo="sem-resultado"
                  titulo="Ninguém com esse filtro"
                  acao={{
                    rotulo: 'Limpar filtros',
                    aoClicar: () => {
                      setBusca('');
                      setPorPapel(null);
                    },
                  }}
                >
                  {[porPapel && `papel ${ROTULO_DO_PAPEL[porPapel]}`, busca.trim() && `busca “${busca.trim()}”`]
                    .filter(Boolean)
                    .join(' · ')}
                </EstadoDaPagina>
              )}
              {pessoas.length === 0 && !filtrando && (
                <EstadoDaPagina
                  tipo="vazio"
                  titulo="Ninguém por aqui ainda"
                  acao={{ rotulo: 'Convidar alguém', para: '/contas' }}
                >
                  Toda conta nasce de um convite.
                </EstadoDaPagina>
              )}
            </section>
          </>
        )}
      </TelaComBarra>
      {cadastro && (
        <EditorDeCadastro pessoa={cadastro.pessoa} origem={cadastro.origem}
          aoFechar={() => setCadastro(null)}
          aoSalvar={async (nome, email) => mudar(
            () => api.editarCadastro(cadastro.pessoa.id, { nome, email, anterior: { nome: cadastro.pessoa.nome, email: cadastro.pessoa.email } }),
            { linha: cadastro.pessoa.id, feito: `Cadastro de ${nome} atualizado.`, naJanela: true },
          )} />
      )}
      {editando && (
        <EditorDeLista
          titulo={
            editando.que === 'empresas' ? 'Acesso aos clientes por unidade' : 'Clientes à parte'
          }
          subtitulo={nomeDe(editando.pessoa)}
          explicacao={
            /* SEM A ALMA NO TEXTO — F31. A frase explicava a Ide Hub como "o
               que Alma9 e Ide compartilham"; o sistema agora fala só da Ide, e
               o que a pessoa precisa saber aqui é o efeito de marcar. */
            editando.que === 'empresas'
              ? 'A pessoa passa a ver TODOS os clientes das unidades marcadas.'
              : 'Clientes soltos, fora das unidades dela. É a exceção — o normal é a unidade decidir.'
          }
          efeito={
            editando.que === 'empresas'
              ? 'Ao salvar, ela passa a ver todos os clientes das unidades marcadas — e deixa de ver os das desmarcadas.'
              : 'Ao salvar, ela passa a ver exatamente os clientes marcados, além dos das unidades dela.'
          }
          carregar={async () =>
            editando.que === 'empresas'
              ? await (async () => {
                  const oferecidas = (await api.empresas()).empresas;
                  const dela = (await api.empresasDaPessoa(editando.pessoa.id)).empresas;
                  /* F31, Fase 3a: a unidade OMITIDA não vem em nenhuma das duas
                     listas (o servidor a tira) e, se a pessoa a tiver, o
                     servidor a devolve no salvamento — ver `setEmpresas`.

                     ⚠️ SÓ AS QUE EU PODERIA DAR VÊM MARCADAS — F17.36c.
                     Quem administra Ide pode abrir a ficha de alguém que também
                     é da Alma 9. A Alma 9 não aparece na lista, e mandá-la de
                     volta no salvamento seria pedir ao banco uma empresa que ele
                     vai recusar — recusa que a pessoa não teria como entender.
                     Ela não some por isso: o banco preserva o que está fora do
                     alcance de quem salva. */
                  const alcance = new Set(oferecidas.map((e) => e.id));
                  return [oferecidas, dela.filter((e) => alcance.has(e.id))];
                })()
              : [
                  (await api.clientesParaCarteira()).clientes,
                  (await api.carteiraDaPessoa(editando.pessoa.id)).clientes,
                ]
          }
          aoFechar={() => setEditando(null)}
          aoSalvar={async (ids) => {
            const quem = nomeDe(editando.pessoa);
            const recusa = await mudar(
              () =>
                editando.que === 'empresas'
                  ? api.definirEmpresas(editando.pessoa.id, ids)
                  : api.definirCarteira(editando.pessoa.id, ids),
              {
                linha: editando.pessoa.id,
                naJanela: true,
                feito:
                  editando.que === 'empresas'
                    ? `Unidades de ${quem} salvas: ${ids.length} marcada(s).`
                    : `Clientes à parte de ${quem} salvos: ${ids.length} marcado(s).`,
              },
            );
            // A RECUSA FICA NA JANELA — F13. Antes a janela fechava de
            // qualquer jeito e a frase aparecia no alto da página, longe da
            // lista que a pessoa acabou de marcar (e com a marcação perdida).
            if (recusa === null) setEditando(null);
            return recusa;
          }}
        />
      )}

      {redefinicao && (
        <CodigoDeSenha dados={redefinicao} aoFechar={() => setRedefinicao(null)} />
      )}
    </PaginaLarga>
  );
}

/** Um número do resumo, com o rótulo antes e a consequência embaixo — F13. */
function Numero({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string;
  valor: number;
  nota?: string;
  tom?: 'warn' | 'ok';
}) {
  return (
    <div className="ad-numero" data-tom={tom}>
      <dt>{rotulo}</dt>
      <dd className="ad-numero-valor tnum">{valor}</dd>
      {nota && <dd className="ad-numero-nota">{nota}</dd>}
    </div>
  );
}

/**
 * O código de senha, mostrado UMA VEZ — F17.31.
 *
 * O banco guarda só a impressão digital dele. Fechada esta janela, ele não
 * existe em lugar nenhum: a saída é gerar outro, e gerar outro mata este.
 * Por isso o aviso vem ANTES do código, e não depois.
 *
 * A senha não aparece aqui porque ela não existe aqui: quem a escolhe é o dono
 * da conta, e quem gerou o código nunca vai sabê-la.
 */
function CodigoDeSenha({
  dados,
  aoFechar,
}: {
  dados: Redefinicao;
  aoFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  const mensagem = buildResetMessage({
    email: dados.pessoa.email,
    code: dados.code,
    resetUrl: `${window.location.origin}/redefinir`,
    expiresAt: new Date(dados.expiraEm),
  });

  return (
    <Janela rotulo="Senha nova" aoFechar={aoFechar} devolverFoco={dados.origem}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Senha nova</div>
          <h2 className="o-titulo text-lg">{dados.pessoa.nome ?? dados.pessoa.email}</h2>
        </div>
        <BotaoDeFechar aoFechar={aoFechar} />
      </header>

      <div className="mt-3 space-y-3">
        <Aviso tipo="atencao">{CODE_SHOWN_ONCE_WARNING}</Aviso>

        <div className="rounded-md border border-hair-2 bg-ink-2 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-mute">Código</div>
          <div className="mt-1 font-mono text-2xl tracking-widest text-luz">
            {formatCode(dados.code)}
          </div>
          <div className="mt-1 text-xs text-mute">
            vale {INVITATION_TTL_HOURS} horas, uma vez só
          </div>
        </div>

        <pre className="whitespace-pre-wrap rounded-md border border-hair-2 bg-ink-2 p-3 text-xs text-plat-dim">
          {mensagem}
        </pre>
      </div>

      <footer className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="o-btn o-btn-fantasma" onClick={aoFechar}>
          Fechar
        </button>
        <button
          type="button"
          className="o-btn o-btn-solido"
          onClick={async () => {
            await navigator.clipboard.writeText(mensagem);
            setCopiado(true);
          }}
        >
          {copiado ? 'Copiado — cole no WhatsApp' : 'Copiar instruções'}
        </button>
      </footer>
    </Janela>
  );
}

function LinhaDePessoa({
  p,
  souEu,
  meuPapel,
  ocupada,
  travada,
  aoMudar,
  aoAbrir,
  aoRedefinir,
  aoEditar,
}: {
  p: Pessoa;
  souEu: boolean;
  meuPapel: Papel;
  /** Esta linha está salvando: os controles dela mostram e travam. */
  ocupada: boolean;
  /** Alguma linha está salvando: as escritas esperam a vez. */
  travada: boolean;
  aoMudar: (acao: () => Promise<unknown>, feito: string) => void;
  aoAbrir: (que: 'carteira' | 'empresas') => void;
  aoRedefinir: (origem: HTMLElement) => void;
  aoEditar: (origem: HTMLElement) => void;
}) {
  const alcance = alcanceDe(p);
  const mexeNoPapel = podeMexerNoPapel(meuPapel, p.papel, souEu);
  const souSuper = meuPapel === 'super_admin';
  const nome = p.nome ?? p.email;

  const opcoes = useMemo<Opcao[]>(
    () =>
      PAPEIS.filter((x) => podeAtribuir(meuPapel, x) || x === p.papel).map((x) => ({
        valor: x,
        rotulo: ROTULO_DO_PAPEL[x],
      })),
    [meuPapel, p.papel],
  );

  return (
    <li
      className="ad-pessoa"
      data-tom={alcance.tom === 'warn' ? 'warn' : undefined}
      data-ativa={p.isActive ? undefined : 'false'}
      aria-busy={ocupada || undefined}
      aria-label={nome}
    >
      <div className="ad-pessoa-quem">
        <div className="ad-pessoa-nome">
          <span className="ad-pessoa-texto">{nome}</span>
          {souEu && <Selo tom="neutro">você</Selo>}
          {p.papel === 'super_admin' && <Selo tom="ok">super admin</Selo>}
          {p.papel === 'admin' && <Selo tom="neutro">administrador</Selo>}
          {!p.isActive && <Selo tom="warn">desativada</Selo>}
        </div>
        <p className="ad-pessoa-email">{p.email}</p>
      </div>

      <p className="ad-pessoa-alcance" data-tom={alcance.tom}>
        <span className="ad-ponto" aria-hidden="true" />
        <span>
          <span className="sr-only">Alcance: </span>
          {alcance.texto}
        </span>
      </p>

      <div className="ad-pessoa-acoes">
        {souSuper && <button type="button" className="o-btn o-btn-vidro o-btn-sm"
          disabled={travada} aria-label={`Editar cadastro de ${nome}`}
          onClick={(e) => aoEditar(e.currentTarget)}>Editar cadastro</button>}
        {mexeNoPapel ? (
          <Menu
            rotulo="Papel"
            opcoes={opcoes}
            valor={p.papel}
            aoEscolher={(v) =>
              v !== null &&
              v !== p.papel &&
              !travada &&
              aoMudar(
                () => api.definirPapel(p.id, v, p.todosOsClientes),
                `Papel de ${nome}: ${ROTULO_DO_PAPEL[v as Papel]}.`,
              )
            }
          />
        ) : (
          <span
            className="o-btn o-btn-vidro o-btn-sm ad-papel-fixo"
            title={
              souEu
                ? 'Ninguém muda o próprio papel — seria a porta trancada por dentro'
                : DESCRICAO_DO_PAPEL[p.papel]
            }
          >
            <span className="eyebrow">Papel</span>
            {ROTULO_DO_PAPEL[p.papel]}
          </span>
        )}

        {/* QUEM ADMINISTRA REPARTE, E SÓ O QUE TEM — F17.36. Antes só o topo
            abria isto. A única ficha que continua fechada é a própria: sem
            empresa, quem administra não consegue se devolver nenhuma, e a
            conta não teria volta. */}
        <button
          type="button"
          className="o-btn o-btn-vidro o-btn-sm"
          disabled={meuPapel === 'funcionario' || (!souSuper && souEu) || travada}
          aria-label={`Unidades de ${nome}: ${p.empresas}`}
          title={
            !souSuper && souEu
              ? 'As suas unidades quem muda é o super admin'
              : 'Acesso aos clientes por unidade — de quais unidades ela vê todos os clientes'
          }
          onClick={() => aoAbrir('empresas')}
        >
          Unidades
          <span className="tnum o-mono ml-1 text-[0.70rem]">{p.empresas}</span>
        </button>

        <button
          type="button"
          className="o-btn o-btn-vidro o-btn-sm"
          disabled={p.todosOsClientes || p.papel === 'super_admin' || travada}
          aria-label={`Clientes à parte de ${nome}: ${p.clientes}`}
          title={
            p.todosOsClientes || p.papel === 'super_admin'
              ? 'Já alcança todos os clientes — carteira não muda nada'
              : 'Clientes soltos, fora das unidades dela'
          }
          onClick={() => aoAbrir('carteira')}
        >
          Clientes
          <span className="tnum o-mono ml-1 text-[0.70rem]">{p.clientes}</span>
        </button>

        {/* REDEFINIR — F17.31, e só de outra pessoa.
            Gera o código; a senha quem escolhe é o dono da conta. */}
        {!souEu && meuPapel !== 'funcionario' && (
          <button
            type="button"
            className="o-btn o-btn-vidro o-btn-sm"
            disabled={travada}
            title="Gerar um código para esta pessoa escolher uma senha nova. Você entrega o código; a senha continua sendo só dela."
            onClick={(e) => aoRedefinir(e.currentTarget)}
          >
            Redefinir
          </button>
        )}

      </div>

      {/* As áreas ficam na segunda linha: são cinco desde a F17.36 e todas
          visíveis de relance, que é exatamente onde a pílula ganha do menu. */}
      <div className="ad-telas" role="group" aria-label={`Telas que ${nome} alcança`}>
        <span className="ad-telas-rotulo">Telas</span>
        {AREAS.map((a) => {
          const tem = p.papel === 'super_admin' || p.areas.includes(a);
          return (
            <Pilula
              key={a}
              ativo={tem}
              titulo={
                p.papel === 'super_admin'
                  ? `Super admin alcança tudo — ${DESCRICAO_DA_AREA[a]}`
                  : DESCRICAO_DA_AREA[a]
              }
              aoClicar={() => {
                if (p.papel === 'super_admin' || travada) return;
                const novas = tem ? p.areas.filter((x) => x !== a) : [...p.areas, a];
                aoMudar(
                  () => api.definirAreas(p.id, novas),
                  tem
                    ? `${nome} deixa de alcançar ${ROTULO_DA_AREA[a]}.`
                    : `${nome} passa a alcançar ${ROTULO_DA_AREA[a]}.`,
                );
              }}
            >
              {ROTULO_DA_AREA[a]}
            </Pilula>
          );
        })}
        {souEu && (
          <span className="ad-telas-nota">
            Você não muda o próprio papel nem se desativa.
          </span>
        )}
        {ocupada && (
          <span className="ad-telas-nota" role="status">
            Salvando…
          </span>
        )}
      </div>
      {/* LIGADO/DESLIGADO NA LINHA DAS TELAS — F13. As chaves e a lixeira
          mudam o ESTADO da conta, não o alcance: ficam na ponta da segunda
          linha, longe de Papel/Unidades/Clientes, que abrem escolhas. */}
      {!souEu && (
        <div className="ad-pessoa-estado">
          <span className="ad-chaves">
              <Chave
                rotulo="Todos"
                ligada={p.todosOsClientes}
                desativada={travada}
                aoMudar={(v) =>
                  aoMudar(
                    () => api.definirPapel(p.id, p.papel, v),
                    v ? `${nome} passa a ver todos os clientes.` : `${nome} volta a ver só as unidades e a carteira dela.`,
                  )
                }
              />
              <Chave
                rotulo="Ativa"
                ligada={p.isActive}
                desativada={travada}
                aoMudar={(v) =>
                  aoMudar(
                    () => api.definirPessoaAtiva(p.id, v),
                    v ? `${nome} foi reativada e volta a entrar.` : `${nome} foi desativada: não entra mais.`,
                  )
                }
              />
          </span>

          {/* APAGAR é só do super admin, e só de outra pessoa. */}
          {souSuper && (
            <button
              type="button"
              className="o-btn o-btn-fantasma o-btn-icone"
              disabled={travada}
              aria-label={`Apagar ${nome} do IDE Works`}
              title="Apagar do IDE Works — não mexe no cadastro compartilhado com o sistema antigo"
              onClick={() => {
                if (
                  window.confirm(
                    `Apagar ${nome} do IDE Works?\n\n` +
                      'Ela perde o acesso a este sistema, junto com a carteira e as unidades.\n' +
                      'O cadastro de login continua existindo, porque é compartilhado com o ' +
                      'Sistema IDE antigo — apagar de lá tiraria a pessoa dos dois.',
                  )
                ) {
                  aoMudar(() => api.apagarPessoa(p.id), `${nome} foi apagada do IDE Works.`);
                }
              }}
            >
              <IconeLixeira />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Escolher itens de uma lista — serve para empresa e para carteira.
 *
 * MANDA A LISTA COMPLETA, e não "adiciona" e "remove" separados. Dois gestos
 * para uma decisão é onde nasce o estado meio-salvo: a pessoa fecha a tela no
 * meio e fica com metade da lista nova e metade da velha.
 */
export function EditorDeLista({
  titulo,
  subtitulo,
  explicacao,
  efeito,
  carregar,
  aoFechar,
  aoSalvar,
}: {
  titulo: string;
  subtitulo: string;
  explicacao: string;
  /** O que o Salvar faz, dito ao lado dele — F13. */
  efeito?: string;
  carregar: () => Promise<[Item[], Item[]]>;
  aoFechar: () => void;
  /** Devolve a frase da recusa (a janela fica aberta com ela) ou nula. */
  aoSalvar: (ids: string[]) => Promise<string | null | void>;
}) {
  const [todos, setTodos] = useState<Item[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);
  const salvandoAgora = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const [lista, atuais] = await carregar();
        setTodos(lista);
        setMarcados(new Set(atuais.map((x) => x.id)));
      } catch (e) {
        setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar.');
      } finally {
        setCarregandoLista(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visiveis = useMemo(() => {
    const alvo = semAcento(busca.trim());
    return alvo === '' ? todos : todos.filter((c) => semAcento(c.nome).includes(alvo));
  }, [todos, busca]);

  return (
    <Janela rotulo={titulo} largura="max-w-2xl" aoFechar={aoFechar} devolverFoco>
      {/* O × FICA NA LINHA DO TÍTULO — F31, Fase 3a. Com `flex-wrap`, em 390 px
          o título longo ("Acesso aos clientes por unidade") empurrava o × para
          uma linha sozinho, longe de onde o olho procura a saída. Sem quebra:
          o bloco do título encolhe (`min-w-0 flex-1`) e quebra DENTRO dele; a
          contagem e o × não encolhem. */}
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="o-rotulo-linha">
            <span className="eyebrow">{titulo}</span>
            {/* A explicação era um parágrafo cinza embaixo do título; virou o
                `?` na F17.37. Ela responde "o que esta lista significa", que é
                pergunta de uma vez só — e quem já sabe não precisa dela
                ocupando a primeira linha da janela toda vez que abre. */}
            <Ajuda sobre={`o que esta lista muda`}>{explicacao}</Ajuda>
          </div>
          <h2 className="o-titulo text-lg">{subtitulo}</h2>
        </div>
        <span className="shrink-0 whitespace-nowrap tnum text-[0.72rem] text-mute">
          {marcados.size} marcado(s)
        </span>
        <BotaoDeFechar aoFechar={aoFechar} />
      </header>

      {erro && (
        <div className="mt-3">
          <Aviso tipo="erro">{erro}</Aviso>
        </div>
      )}

      {carregandoLista && <p className="mt-3 text-sm text-mute">Carregando…</p>}

      {!carregandoLista && (
        <>
          {todos.length > 8 && (
            <div className="mt-3">
              <CampoDeBusca rotulo="Buscar na lista" valor={busca} aoMudar={setBusca} />
            </div>
          )}

          <div
            className="mt-2 flex flex-wrap gap-1"
            style={{ maxHeight: '18rem', overflowY: 'auto' }}
          >
            {visiveis.map((c) => (
              <Pilula
                key={c.id}
                ativo={marcados.has(c.id)}
                aoClicar={() =>
                  setMarcados((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(c.id)) novo.delete(c.id);
                    else novo.add(c.id);
                    return novo;
                  })
                }
              >
                {c.nome}
              </Pilula>
            ))}
            {visiveis.length === 0 && (
              <span className="text-[0.8125rem] text-mute" role="status">
                Nada com esse nome.
              </span>
            )}
          </div>

          {marcados.size === 0 && (
            <p className="mt-2 text-[0.72rem]" style={{ color: 'var(--warn)' }}>
              Sem nada marcado, esta pessoa não alcança cliente algum por aqui.
            </p>
          )}
        </>
      )}

      {recusa && (
        <div className="mt-3">
          <Aviso tipo="erro">{recusa}</Aviso>
        </div>
      )}

      {efeito && !carregandoLista && !erro && <p className="ad-efeito">{efeito}</p>}

      <footer className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="o-btn o-btn-fantasma" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          type="button"
          className="o-btn o-btn-solido"
          disabled={salvando || carregandoLista || erro !== null}
          onClick={() => {
            // O SALVAR NÃO DISPARA DUAS VEZES — F13: o segundo clique chega
            // antes de o `disabled` desenhar, e por isso a trava é a variável.
            if (salvandoAgora.current) return;
            salvandoAgora.current = true;
            setSalvando(true);
            setRecusa(null);
            void aoSalvar([...marcados])
              .then((r) => {
                if (typeof r === 'string') setRecusa(r);
              })
              .finally(() => {
                salvandoAgora.current = false;
                setSalvando(false);
              });
          }}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </footer>
    </Janela>
  );
}


function EditorDeCadastro({ pessoa, origem, aoFechar, aoSalvar }: {
  pessoa: Pessoa; origem: HTMLElement; aoFechar: () => void;
  aoSalvar: (nome: string, email: string) => Promise<string | null>;
}) {
  const [nome, setNome] = useState(pessoa.nome ?? '');
  const [email, setEmail] = useState(pessoa.email);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const trava = useRef(false);
  const fechar = () => { if (!trava.current) aoFechar(); };
  const mudou = nome.trim() !== (pessoa.nome ?? '') || email.trim().toLowerCase() !== pessoa.email;
  return <Janela rotulo="Editar cadastro" aoFechar={fechar} devolverFoco={origem}>
    <header className="flex items-start justify-between gap-2">
      <div><h2 className="o-titulo text-lg">Editar cadastro</h2><p className="text-sm text-mute">{pessoa.nome ?? pessoa.email}</p></div>
      <BotaoDeFechar aoFechar={fechar} />
    </header>
    <form className="mt-4 grid gap-4" onSubmit={async (e) => {
      e.preventDefault();
      if (trava.current || !mudou) return;
      if (!nome.trim()) { setErro('Informe o nome da pessoa.'); return; }
      trava.current = true; setSalvando(true); setErro(null);
      try {
        const recusa = await aoSalvar(nome.trim(), email.trim().toLowerCase());
        if (recusa) setErro(recusa); else aoFechar();
      } catch { setErro('Não foi possível confirmar o salvamento. Reabra o cadastro para conferir.'); }
      finally { trava.current = false; setSalvando(false); }
    }}>
      <label className="grid gap-1 text-sm">Nome
        <input className="o-campo" name="nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={160} required disabled={salvando} autoComplete="off" />
      </label>
      <label className="grid gap-1 text-sm">E-mail
        <input className="o-campo" type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} required disabled={salvando} autoComplete="off" aria-describedby="cadastro-email-ajuda" />
      </label>
      <p id="cadastro-email-ajuda" className="text-sm text-mute">O novo e-mail será usado para entrar. Se esta conta também acessa outros sistemas com o mesmo login, a mudança vale para eles. A senha permanece a mesma.</p>
      {erro && <p role="alert" className="a-erro">{erro}</p>}
      <footer className="flex justify-end gap-2">
        <button type="button" className="o-btn o-btn-vidro" disabled={salvando} onClick={fechar}>Cancelar</button>
        <button type="submit" className="o-btn o-btn-solido" disabled={salvando || !mudou} aria-busy={salvando}>{salvando ? 'Salvando…' : 'Salvar cadastro'}</button>
      </footer>
    </form>
  </Janela>;
}
