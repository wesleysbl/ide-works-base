/**
 * Meta · Contas — etapa F7d.
 *
 * O QUE MUDOU EM RELAÇÃO À TELA ANTERIOR, E POR QUÊ
 *   A primeira versão listava CLIENTES e pendurava contas neles. Estava
 *   invertido: a conta de anúncio existe na BM e a conta do Instagram existe
 *   pendurada numa página — as duas existem na Meta com ou sem cliente
 *   cadastrado aqui.
 *
 *   E a Meta já sabe a estrutura: qual conta é de qual gerenciador, qual
 *   Instagram pende de qual página. Não havia nada a adivinhar; havia estrutura
 *   a mostrar.
 *
 * A ÁREA META É DE RELATÓRIO
 *   Cada conta é uma unidade de análise: uma conta de anúncio rende KPI de
 *   campanha; uma conta do Instagram rende o que aparece no painel profissional
 *   do perfil. Por isso a linha de cada conta mostra quantos dias de série já
 *   existem — é isso que diz se há relatório para abrir.
 *
 * O CLIENTE APARECE, MAS COMO PONTE
 *   Ele é referência cruzada com o Sistema IDE, não o eixo desta tela. Atribuir
 *   se faz na ficha do cliente, do outro lado — e aqui só se vê o resultado.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Ajuda } from '@/board/menus';
import { TelaComBarra } from '@/board/TelaComBarra';
import { ApiError, api, semSessao } from '@/lib/api';
import { AlarmeDaColeta } from '@/meta/AlarmeDaColeta';
import { type EstadoDaConta, ROTULO_DA_CONTA, estadoDaConta } from '@/meta/ativos';
import { dias, quando } from '@/meta/contexto';
import { AlternadorDeVista } from '@/ui/AlternadorDeVista';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { IconeDireita } from '@/ui/Icones';
import { Menu } from '@/ui/Menu';
import { Aviso, CampoDeBusca, PaginaLarga, Selo, type Tom } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';

/** Uma empresa do grupo e a credencial da Meta dela — F7g. */
type EmpresaDaMeta = {
  id: string;
  name: string;
  /** O NOME da variável de ambiente, nunca o token. */
  secretName: string | null;
  contas: number;
  /** Se esse segredo existe NESTE servidor. */
  configurada: boolean;
};

type ContaDaMeta = {
  id: string;
  kind: 'ad_account' | 'instagram_account';
  externalId: string;
  displayName: string | null;
  businessId: string | null;
  businessName: string | null;
  pageId: string | null;
  pageName: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  client: { id: string; name: string } | null;
  /** De qual empresa é a conta — qual TOKEN a alcança (F7g). */
  empresa: { id: string; name: string } | null;
  diasColetados: number;
};

// O rótulo do grupo vazio depende do tipo: uma conta de anúncio sem BM está sem
// GERENCIADOR; um Instagram sem página está sem PÁGINA. Um texto só para os dois
// mentiria em metade dos casos.
const SEM_GERENCIADOR = '— sem gerenciador informado —';
const SEM_PAGINA = '— sem página informada —';

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** A cor acompanha o estado escrito; nunca o substitui. */
const TOM_DA_CONTA: Record<EstadoDaConta, Tom> = {
  inativa: 'neutro',
  falha: 'err',
  sem_coleta: 'neutro',
  sem_registro: 'neutro',
  atrasada: 'warn',
  em_dia: 'ok',
};

type Tipo = 'tudo' | 'ad_account' | 'instagram_account';
/** O tipo no endereço é palavra de gente, não o nome da coluna. */
const TIPO_DO_ENDERECO: Record<string, Tipo> = { anuncios: 'ad_account', instagram: 'instagram_account' };
const ENDERECO_DO_TIPO: Record<Tipo, string | null> = { tudo: null, ad_account: 'anuncios', instagram_account: 'instagram' };

export default function MetaContas() {
  const [contas, setContas] = useState<ContaDaMeta[]>([]);
  const [temToken, setTemToken] = useState(true);
  /* OS FILTROS MORAM NO ENDEREÇO — F14. Abrir o relatório de uma conta e
     voltar (Voltar do navegador) devolvia a lista inteira, sem o recorte que
     levou até ela. `?tipo=`, `?empresa=`, `?q=` e `?sem-cliente=1`. */
  const [params, setParams] = useSearchParams();
  const busca = params.get('q') ?? '';
  const soSemDono = params.get('sem-cliente') === '1';
  const tipo: Tipo = TIPO_DO_ENDERECO[params.get('tipo') ?? ''] ?? 'tudo';
  const empresaFiltro = params.get('empresa');
  const mudar = useCallback(
    (mudancas: Record<string, string | null>) => {
      setParams(
        (atual) => {
          const n = new URLSearchParams(atual);
          for (const [k, v] of Object.entries(mudancas)) {
            if (v === null || v === '') n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const limparFiltros = () => mudar({ q: null, 'sem-cliente': null, tipo: null, empresa: null });
  const temFiltro = busca !== '' || soSemDono || tipo !== 'tudo' || empresaFiltro !== null;
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  /**
   * DE QUEM É O TOKEN QUE TROUXE ESTA LISTA — F19f.
   *
   * A tela dizia O QUE o token alcança e nunca QUEM ele é. Sem o sujeito, a
   * pergunta "por que meu cliente não está aqui?" não tem como ser respondida
   * por quem olha — e ela chegou, sobre o cliente Jatobá, em 25/08/2026.
   *
   * O sujeito é o que decide o conserto: a Meta devolve aqui as contas em que
   * o USUÁRIO DO SISTEMA tem papel. Atribuir a conta ao **app** nas
   * Configurações do Negócio é outra atribuição, e sozinha ela não traz a
   * conta para cá.
   */
  const [identidade, setIdentidade] = useState<{ id: string; nome: string | null } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  /**
   * A LEITURA DA LISTA falhou — e é ela que ganha "Tentar de novo". `erro` serve
   * também às falhas de importar e de atribuir, que têm o próprio botão (o
   * mesmo gesto, de novo); sem esta marca, a falha da leitura inicial deixava
   * só o aviso, sem saída além de recarregar a página.
   */
  const [falhouLer, setFalhouLer] = useState(false);
  const [importando, setImportando] = useState(false);

  /**
   * De qual empresa importar — F7g.
   *
   * `null` é "a credencial padrão", que é o caminho de sempre. A escolha só
   * aparece para o super admin; para os demais o botão continua o de antes.
   */
  const [empresas, setEmpresas] = useState<EmpresaDaMeta[]>([]);
  const [podeEscolher, setPodeEscolher] = useState(false);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  /* O recorte da TELA por empresa (`empresaFiltro`, no endereço) é diferente
     de `empresaId`, que é de qual empresa IMPORTAR. Um filtra o que se vê, o
     outro decide o que entra. */

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await api.contasDaMeta();
      setContas(r.accounts as ContaDaMeta[]);
      setTemToken(r.hasToken);
      setFalhouLer(false);

      // Falhar aqui não pode derrubar a tela: quem não administra recebe 403,
      // e isso não é erro — é a regra funcionando.
      try {
        const e = await api.empresasDaMeta();
        setEmpresas(e.empresas);
        setPodeEscolher(e.podeEscolher);
      } catch {
        setEmpresas([]);
        setPodeEscolher(false);
      }
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar.');
      setFalhouLer(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setCarregando(true);
    void carregar();
  }, [carregar]);

  async function importar() {
    setImportando(true);
    setErro(null);
    setRecado(null);
    setAvisos([]);
    try {
      const r = await api.importarContasDaMeta(empresaId);
      setRecado(
        `A Meta devolveu ${r.total} conta(s)${r.empresa ? ` de ${r.empresa.name}` : ''}. ` +
          `O sistema agora conhece ${r.contas}.`,
      );
      // Aviso NÃO entra no recado de sucesso.
      //
      // Ele entrava, e foi assim que 20 contas de anúncio sumiram sem ninguém
      // notar: a Meta recusou a listagem por causa de um campo privilegiado, o
      // motivo virou a segunda frase de uma tarja VERDE dizendo "A Meta
      // devolveu 21 conta(s)", e a tela ficou só com Instagram por um dia.
      //
      // Falha pintada de verde não é aviso, é disfarce.
      setAvisos(r.avisos);
      setIdentidade(r.identidade);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível importar.');
    } finally {
      setImportando(false);
    }
  }

  /**
   * A EMPRESA FILTRA TUDO O QUE VEM DEPOIS, INCLUSIVE OS NÚMEROS DO TOPO.
   *
   * Ide e Alma Nove têm BM, app e token próprios: são duas operações que só
   * dividem a tela. Escolher a empresa e continuar vendo "102 contas" no topo
   * faria os cartões responderem uma pergunta enquanto a lista responde outra.
   *
   * Por isso o recorte por empresa vem ANTES de tudo, e não junto dos outros
   * filtros.
   */
  const daEmpresa = useMemo(() => {
    if (empresaFiltro === null) return contas;
    // `__sem__` é a conta que ainda não foi carimbada — ela existe de verdade
    // (o Ide Hub é alcançável pelos dois tokens) e some se o filtro só souber
    // falar de empresas nomeadas.
    if (empresaFiltro === '__sem__') return contas.filter((c) => c.empresa === null);
    return contas.filter((c) => c.empresa?.id === empresaFiltro);
  }, [contas, empresaFiltro]);

  /**
   * As empresas que REALMENTE aparecem nas contas, e não o catálogo inteiro.
   *
   * Uma empresa cadastrada e sem conta nenhuma vira um botão que só sabe
   * mostrar lista vazia — e o filtro passa a ser um lugar onde se erra em vez
   * de um atalho.
   */
  const empresasPresentes = useMemo(() => {
    const mapa = new Map<string, { id: string; nome: string; quantas: number }>();
    for (const c of contas) {
      if (!c.empresa) continue;
      const atual = mapa.get(c.empresa.id);
      mapa.set(c.empresa.id, {
        id: c.empresa.id,
        nome: c.empresa.name,
        quantas: (atual?.quantas ?? 0) + 1,
      });
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [contas]);

  const semEmpresa = contas.filter((c) => c.empresa === null).length;

  const visiveis = useMemo(() => {
    const alvo = semAcento(busca.trim());
    return daEmpresa.filter(
      (c) =>
        (tipo === 'tudo' || c.kind === tipo) &&
        (!soSemDono || c.client === null) &&
        (alvo === '' ||
          semAcento(
            `${c.displayName ?? ''} ${c.businessName ?? ''} ${c.pageName ?? ''} ` +
              `${c.externalId} ${c.client?.name ?? ''} ${c.empresa?.name ?? ''}`,
          ).includes(alvo)),
    );
  }, [daEmpresa, busca, soSemDono, tipo]);

  /**
   * Agrupa pela estrutura da própria Meta: conta de anúncio pelo gerenciador,
   * Instagram pela página. É a organização que o dado já traz — inventar outra
   * seria impor uma hierarquia que não existe do outro lado.
   */
  const grupos = useMemo(() => {
    const mapa = new Map<string, ContaDaMeta[]>();
    for (const c of visiveis) {
      const chave =
        c.kind === 'ad_account'
          ? (c.businessName ?? SEM_GERENCIADOR)
          : (c.pageName ?? SEM_PAGINA);
      mapa.set(chave, [...(mapa.get(chave) ?? []), c]);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [visiveis]);

  // Contam sobre `daEmpresa`, e não sobre tudo: ver a nota em `daEmpresa`.
  const anuncios = daEmpresa.filter((c) => c.kind === 'ad_account');
  const instagram = daEmpresa.filter((c) => c.kind === 'instagram_account');
  const semDono = daEmpresa.filter((c) => c.client === null);
  const comSerie = daEmpresa.filter((c) => c.diasColetados > 0);

  const empresaEscolhida = empresas.find((e) => e.id === empresaId) ?? null;
  // Sem empresa escolhida, quem responde pela credencial é `temToken`.
  const credencialPronta = empresaEscolhida ? empresaEscolhida.configurada : true;

  return (
    <PaginaLarga>
      {/* ⚠️ A BARRA CHEGA À META — F17.67, E ISTO É PILAR C, NÃO PILAR B.

          A dúvida foi levantada de propósito: a barra é o mapa do trabalho, e
          Meta é resultado. Duas medições decidiram pelo sim.

          1. O QUE ESTAS TELAS TINHAM PARA NAVEGAR: dois botões — `Contas` e
             `Ranking` — e o `Voltar` da moldura (que saiu na F29: hoje o
             ranking e o relatório trazem a trilha `Meta › …`). Dois botões
             não são um mapa:
             quem vem do quadro para um relatório perdia a árvore inteira e o
             caminho de volta ao próprio trabalho.

          2. A BARRA NÃO CHEGA VAZIA: das 17 contas ativas, NENHUMA tem `meta`
             sem ter também `quadro` e `entrega`. Quem abre estas telas alcança
             tudo o que a barra oferece — o caso do enquadramento vazio não
             existe hoje, e se um dia existir a barra some sozinha por área
             (F17.36), não desenha botão morto.

          Sem `atual`: Meta não é nenhum dos sete itens da barra, e não deve
          ser — é outra área, e um item apontando para área que a pessoa não
          tem é botão que responde 403. */}
      <TelaComBarra>
        {/* O TOPO — F29 (Fase 5a). O título era `Contas`, com `Meta · análise de
            resultado` em cima, e havia um `‹ Sistema IDE` à mão levando ao
            Painel. Agora o título é `Meta` — o nome com que o menu da conta
            leva a esta tela, e o nome do primeiro degrau da trilha do ranking
            e do relatório, que trazem de volta para cá: quem clica em "Meta"
            chega numa tela chamada Meta. O `‹ Sistema IDE` saiu — o Painel
            está na barra. Ficam as ações da página. */}
        <Topo
          titulo="Meta"
          acoes={
            <>
              <Link to="/meta/ranking" className="o-btn o-btn-vidro o-btn-sm">
                Ranking de criativos
              </Link>

              {/* DE QUAL EMPRESA IMPORTAR — F7g, e só para o super admin.
                  Cada empresa tem BM, app e token próprios: o token da Alma Nove
                  não enxerga conta da Ide, e vice-versa. Escolher aqui decide de
                  qual portfólio as contas entram E com que carimbo — errar liga
                  conta da A9 como se fosse da Ide, e o conserto é conta a conta. */}
              {podeEscolher && empresas.length > 0 && (
                <Menu
                  rotulo="Empresa"
                  valor={empresaId}
                  aoEscolher={setEmpresaId}
                  opcoes={[
                    { valor: null, rotulo: 'Credencial padrão' },
                    ...empresas.map((e) => ({
                      valor: e.id,
                      // A credencial que falta é dita AQUI, antes de tentar. Depois
                      // ela chega disfarçada de "conta não encontrada", que é a
                      // mesma resposta de uma conta apagada na Meta.
                      rotulo: e.configurada ? e.name : `${e.name} — sem credencial`,
                      contagem: e.contas,
                    })),
                  ]}
                />
              )}

              <button
                type="button"
                className="o-btn o-btn-solido o-btn-sm"
                disabled={importando || !temToken || !credencialPronta}
                title={
                  !temToken
                    ? 'Sem token da Meta no servidor'
                    : !credencialPronta
                      ? `A empresa escolhida usa ${empresaEscolhida?.secretName ?? 'a credencial padrão'}, que não está definida no servidor`
                      : 'Pergunta à Meta quais contas o token alcança e traz a estrutura delas'
                }
                onClick={() => void importar()}
              >
                {importando
                  ? 'Perguntando à Meta…'
                  : empresaEscolhida
                    ? `Importar de ${empresaEscolhida.name}`
                    : 'Importar da Meta'}
              </button>
            </>
          }
        />

        <AlarmeDaColeta />

        {!temToken && (
          <div className="mt-3">
            <Aviso tipo="atencao">
              Sem token da Meta no servidor. Defina{' '}
              <span className="o-mono">IDEWORKS_META_TOKEN</span> para importar as contas.
            </Aviso>
          </div>
        )}
        {erro && (
          <div className="mt-3">
            <Aviso
              tipo="erro"
              acao={
                falhouLer
                  ? {
                      rotulo: 'Tentar de novo',
                      aoClicar: () => {
                        setCarregando(true);
                        void carregar();
                      },
                    }
                  : undefined
              }
            >
              {erro}
            </Aviso>
          </div>
        )}
        {recado && (
          <div className="mt-3">
            <Aviso tipo="ok">{recado}</Aviso>
          </div>
        )}
        {/* QUEM TROUXE ESTA LISTA. Fica logo abaixo do recado da importação,
            porque é ali que a pessoa está olhando quando conta o que veio — e é
            ali que ela percebe que faltou alguém. */}
        {identidade && (
          <div className="mt-3">
            <Aviso tipo="info">
              <span>
                Esta lista é o que o usuário do sistema{' '}
                <b className="text-plat">{identidade.nome ?? identidade.id}</b> alcança na Meta.{' '}
                <b>Falta alguma conta?</b> Ela precisa estar atribuída a{' '}
                <b className="text-plat">esse usuário do sistema</b> nas Configurações do Negócio —
                em Usuários do sistema → Adicionar ativos. Atribuir a conta ao <i>app</i>, ou
                compartilhar só a página, não a traz para cá: são permissões diferentes.
              </span>
            </Aviso>
          </div>
        )}
        {avisos.length > 0 && (
          <div className="mt-3">
            <Aviso tipo="atencao">
              <span>
                <b>A Meta não entregou tudo.</b>
                {avisos.map((a) => (
                  <span key={a} className="mt-1 block">
                    {a}
                  </span>
                ))}
              </span>
            </Aviso>
          </div>
        )}

        {carregando && <EstadoDaPagina tipo="carregando" titulo="Carregando as contas…" linhas={4} />}

        {/* NADA DE ZERO ANTES DE SABER — F14. Os quatro números apareciam como
            0 enquanto a lista não chegava, e "0 contas" é afirmação. */}
        {!carregando && contas.length === 0 && !erro && (
          <EstadoDaPagina tipo="vazio" titulo="Nenhuma conta importada">
            Use Importar da Meta: o sistema pergunta ao token quais contas ele alcança e traz a estrutura
            de cada uma — de qual gerenciador é a conta de anúncio, de qual página pende o Instagram.
            Importar não atribui cliente a nada: isso se faz na ficha do cliente.
          </EstadoDaPagina>
        )}

        {!carregando && contas.length > 0 && (
          <>
            {/* O resumo numa faixa — é apoio da lista, como em Pessoas (F13). */}
            <dl className="ad-numeros mm-numeros" aria-label="Resumo das contas">
              <div className="ad-numero">
                <dt>Contas de anúncio</dt>
                <dd className="ad-numero-valor tnum">{anuncios.length}</dd>
              </div>
              <div className="ad-numero">
                <dt>Perfis do Instagram</dt>
                <dd className="ad-numero-valor tnum">{instagram.length}</dd>
              </div>
              <div className="ad-numero" data-tom={comSerie.length === 0 ? 'warn' : undefined}>
                <dt>Com série coletada</dt>
                <dd className="ad-numero-valor tnum">{comSerie.length}</dd>
                {comSerie.length === 0 && <dd className="ad-numero-nota">a coleta ainda não rodou</dd>}
              </div>
              <div className="ad-numero">
                {/* "atribui-se na ficha do cliente" era a nota fixa embaixo do
                    número: diz ONDE fazer, não avisa de nada. F43 Fase 10: vai
                    para o "?" ao lado do nome do número. A nota do vizinho
                    ("a coleta ainda não rodou") fica: ela é estado do dado. */}
                <dt>
                  Sem cliente atribuído{' '}
                  <Ajuda sobre="onde se atribui o cliente" lado="baixo-direita">
                    Atribui-se na ficha do cliente.
                  </Ajuda>
                </dt>
                <dd className="ad-numero-valor tnum">{semDono.length}</dd>
              </div>
            </dl>

            {/* --- OS RECORTES, JUNTOS -------------------------------------
                Eram três faixas de pílulas empilhadas (empresa, tipo) e uma
                busca solta embaixo. Agora uma linha só: o tipo é escolha de
                um (segmentado), a empresa é menu — ela vem PRIMEIRO e leva
                junto os números do resumo, como antes —, a busca e o "só sem
                cliente". O que o recorte deixou ver é dito ao lado. */}
            <div className="mm-filtros" role="group" aria-label="Recortes das contas">
              {empresasPresentes.length > 1 && (
                <Menu
                  rotulo="Empresa"
                  valor={empresaFiltro}
                  aoEscolher={(v) => mudar({ empresa: v })}
                  opcoes={[
                    { valor: null, rotulo: 'Todas', contagem: contas.length },
                    ...empresasPresentes.map((e) => ({ valor: e.id, rotulo: e.nome, contagem: e.quantas })),
                    // `__sem__` é a conta que ainda não foi carimbada — ela
                    // existe de verdade (o Ide Hub é alcançável pelos dois
                    // tokens) e some se o filtro só souber falar de empresas
                    // nomeadas.
                    ...(semEmpresa > 0 ? [{ valor: '__sem__', rotulo: 'Sem empresa', contagem: semEmpresa }] : []),
                  ]}
                />
              )}
              <AlternadorDeVista<Tipo>
                rotulo="Tipo de conta"
                valor={tipo}
                aoEscolher={(t) => mudar({ tipo: ENDERECO_DO_TIPO[t] })}
                opcoes={[
                  { valor: 'tudo', rotulo: 'Tudo', contagem: daEmpresa.length },
                  { valor: 'ad_account', rotulo: 'Gerenciadores', contagem: anuncios.length },
                  { valor: 'instagram_account', rotulo: 'Instagram', contagem: instagram.length },
                ]}
              />
              <CampoDeBusca
                rotulo="Buscar conta, gerenciador, página ou cliente"
                exemplo="Conta, gerenciador, página ou cliente…"
                valor={busca}
                aoMudar={(t) => mudar({ q: t })}
                className="mm-filtros-busca"
              />
              <button
                type="button"
                aria-pressed={soSemDono}
                onClick={() => mudar({ 'sem-cliente': soSemDono ? null : '1' })}
                className="o-btn o-btn-vidro o-btn-sm"
              >
                Só sem cliente
              </button>
              <span className="mm-filtros-conta" aria-live="polite">
                {visiveis.length === daEmpresa.length
                  ? `${visiveis.length} ${visiveis.length === 1 ? 'conta' : 'contas'}`
                  : `${visiveis.length} de ${daEmpresa.length} contas`}
              </span>
            </div>

            {visiveis.length === 0 && (
              <EstadoDaPagina
                tipo="sem-resultado"
                titulo="Nenhuma conta com esses filtros"
                acao={temFiltro ? { rotulo: 'Limpar filtros', aoClicar: limparFiltros } : undefined}
              >
                A lista tem {contas.length} {contas.length === 1 ? 'conta' : 'contas'}; o recorte escolhido não deixou nenhuma.
              </EstadoDaPagina>
            )}

            {/* --- gerenciador ou Instagram ----------------------------------
                As duas coisas se leem de formas diferentes: o gerenciador se
                organiza por BM e responde sobre dinheiro; o perfil pende de uma
                página e responde sobre audiência. */}
            {grupos.map(([grupo, doGrupo]) => (
              <section key={grupo} className="mm-grupo" aria-label={grupo}>
                <h2 className="mm-grupo-titulo mm-grupo-titulo-lista">
                  {grupo}
                  <span className="tnum mm-grupo-conta">{doGrupo.length}</span>
                </h2>
                <ul className="mm-contas">
                  {doGrupo.map((c) => (
                    <LinhaDaConta key={c.id} c={c} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}

/**
 * A linha de uma conta — F14.
 *
 * Quem é (tipo, nome que abre o relatório, id, cliente), o estado da coleta
 * ESCRITO (e a cor acompanhando) e a ação. A falha vem com a frase da Meta,
 * embaixo do nome, sem espremer a linha: no celular ela quebrava letra a
 * letra ao lado do selo.
 */
function LinhaDaConta({ c }: { c: ContaDaMeta }) {
  const estado = estadoDaConta(c);
  const tom = TOM_DA_CONTA[estado];
  const serie = c.diasColetados > 0 ? `${dias(c.diasColetados)} de série` : null;
  const ads = c.kind === 'ad_account';

  return (
    <li className="mm-conta" data-estado={estado}>
      <span className={`mm-conta-tipo o-mono ${ads ? 'mm-conta-tipo-ads' : 'mm-conta-tipo-ig'}`} title={ads ? 'Conta de anúncio' : 'Perfil do Instagram'}>
        <span aria-hidden>{ads ? 'ADS' : 'IG'}</span>
        <span className="sr-only">{ads ? 'Conta de anúncio' : 'Perfil do Instagram'}</span>
      </span>

      <div className="mm-conta-quem">
        <p className="mm-conta-titulo">
          {/* O nome abre o relatório: a conta é a unidade de análise. */}
          <Link to={`/meta/${c.id}`} className="mm-conta-nome" title="Abrir o relatório desta conta">
            {c.displayName ?? c.externalId}
          </Link>
          {/* A ponte com o Sistema IDE — referência cruzada, não o eixo. */}
          {c.client ? (
            <Link
              to={`/cliente/${c.client.id}`}
              className="o-etiqueta hover:underline"
              style={{ borderColor: 'var(--luz)', color: 'var(--luz-texto)' }}
              title="Cliente do Sistema IDE ligado a esta conta"
            >
              {c.client.name}
            </Link>
          ) : (
            <span className="mm-conta-fraco">sem cliente</span>
          )}
        </p>
        <p className="mm-conta-id o-mono">{c.externalId}</p>
        {estado === 'falha' && c.lastError && <p className="mm-conta-erro">{c.lastError}</p>}
      </div>

      <div className="mm-conta-coleta">
        <Selo tom={tom}>{ROTULO_DA_CONTA[estado]}</Selo>
        <span className="mm-conta-fraco">
          {serie ?? 'nenhum dia coletado'}
          {c.lastSeenAt && ` · visto ${quando(c.lastSeenAt)}`}
        </span>
      </div>

      <Link
        to={`/meta/${c.id}`}
        className="o-btn o-btn-fantasma o-btn-sm mm-conta-abrir"
        aria-label={`Relatório de ${c.displayName ?? c.externalId}`}
        title={ads ? 'KPIs e gráficos das campanhas' : 'KPIs e gráficos do perfil'}
      >
        relatório
        <IconeDireita />
      </Link>
    </li>
  );
}
