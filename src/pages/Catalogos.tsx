/**
 * Planos, categorias e etiquetas — etapa F2.4.
 *
 * OS TRÊS CATÁLOGOS QUE ALIMENTAM O RESTO DO SISTEMA
 *   O selo colorido no cartão do cliente, as unidades de negócio e os filtros
 *   por etiqueta saem daqui. Até esta tela existir, eles só se editavam por
 *   SQL. (As abas de unidade do painel saíram; desde a F31 a unidade só decide
 *   QUEM VÊ o cliente — ver a seção dela.)
 *
 * A CONTAGEM DE USO APARECE SEMPRE, INCLUSIVE ZERO
 *   É ela que diz se dá para apagar. Sem o número, apagar vira tentativa: a
 *   pessoa clica, o banco recusa por causa de clientes que ela não via, e a
 *   mensagem chega sem contexto.
 *
 * A TELA NÃO ESCONDE O QUE VOCÊ NÃO PODE FAZER
 *   Mexer no catálogo é de administrador, e a recusa vem do banco com a frase
 *   certa. Esconder os botões de quem não é pareceria defeito; recusar com o
 *   motivo ensina onde está o limite. Mesma escolha da ficha do cliente.
 */

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { TelaComBarra } from '@/board/TelaComBarra';
import { Ajuda } from '@/board/menus';
import { ApiError, api, semSessao } from '@/lib/api';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { IconeLapis, IconeLixeira, IconeMais } from '@/ui/Icones';
import { Aviso, Campo, PaginaLarga, Pilula, Selo } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';

type Plano = {
  id: string;
  name: string;
  colorBg: string;
  colorText: string;
  colorBorder: string;
  sortOrder: number;
  isActive: boolean;
  clientCount: number;
};
type Categoria = {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  clientCount: number;
  /** F31, Fase 3a — só vem (e só `true`) para o super admin. Ver `SelosDaUnidade`. */
  omitida?: boolean;
};
type Etiqueta = { id: string; name: string; color: string; clientCount: number };

/** `id` nulo é o plano novo — o mesmo formulário serve para criar e editar. */
type RascunhoDePlano = Omit<Plano, 'clientCount' | 'id'> & { id: string | null };
type RascunhoDeCategoria = { id: string | null; name: string; sortOrder: number };
type RascunhoDeEtiqueta = { id: string | null; name: string; color: string };

const PLANO_NOVO: RascunhoDePlano = {
  id: null,
  name: '',
  colorBg: '#111114',
  colorText: '#f4f1ea',
  colorBorder: '#00ff66',
  sortOrder: 0,
  isActive: true,
};

/** Campo de cor com o valor em texto ao lado — o olho escolhe, o texto confere. */
function CampoDeCor({
  rotulo,
  valor,
  aoMudar,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="o-rotulo">{rotulo}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border bg-transparent"
          style={{ borderColor: 'var(--hair-2)' }}
        />
        <input
          className="o-campo tnum font-mono text-[0.75rem]"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
        />
      </div>
    </label>
  );
}

/**
 * Os selos de uma unidade de negócio: "padrão" e "omitida".
 *
 * "OMITIDA" — F31, Fase 3a. A unidade em `IDEWORKS_EMPRESAS_OMITIDAS` some de
 * todas as telas, e de Catálogos também — menos para o super admin: quem cuida
 * do sistema precisa lembrar que ela existe (tem clientes, espaço e contas da
 * Meta sendo coletadas). QUEM DECIDE É O SERVIDOR: para os outros ela nem vem
 * na resposta. Esta peça só desenha o que chegou.
 */
export function SelosDaUnidade({ unidade }: { unidade: Pick<Categoria, 'isDefault' | 'omitida'> }) {
  return (
    <>
      {unidade.isDefault && <Selo tom="ok">padrão</Selo>}
      {unidade.omitida && (
        <Selo
          tom="warn"
          titulo="Fora de todas as telas (IDEWORKS_EMPRESAS_OMITIDAS). Nada foi apagado: esvaziar a variável traz de volta."
        >
          omitida
        </Selo>
      )}
    </>
  );
}

/**
 * Os botões de uma unidade de negócio: "Tornar padrão", "Editar" e apagar.
 *
 * A UNIDADE OMITIDA NÃO TEM BOTÃO NENHUM — F31, Fase 3b. Só o selo. Cada uma
 * das três ações desligaria a omissão sem ninguém perceber: a padrão nunca é
 * omitida (o resolvedor a ignora), o nome novo deixaria de casar com
 * `IDEWORKS_EMPRESAS_OMITIDAS`, e apagar mandaria os clientes dela para a
 * padrão, que aparece. Para mexer nela, primeiro tira-se o nome da variável.
 * O servidor recusa as três do mesmo jeito (`catalogos.ts`); aqui só se deixa
 * de oferecer o que seria recusado.
 */
export function AcoesDaUnidade({
  unidade,
  aoTornarPadrao,
  aoEditar,
  aoApagar,
}: {
  unidade: Pick<Categoria, 'isDefault' | 'omitida'> & { name?: string };
  aoTornarPadrao: () => void;
  aoEditar: () => void;
  aoApagar: () => void;
}) {
  if (unidade.omitida) return null;
  const qual = unidade.name ? ` ${unidade.name}` : '';
  return (
    <div className="ad-item-acoes">
      {!unidade.isDefault && (
        <button
          type="button"
          className="o-btn o-btn-vidro o-btn-sm"
          title="Vira o destino de quem perder a categoria"
          onClick={aoTornarPadrao}
        >
          Tornar padrão
        </button>
      )}
      <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={aoEditar}>
        Editar
      </button>
      {/* A LIXEIRA COM NOME — F13. Era um `✕` solto: para o leitor de tela,
          "cruz de multiplicação"; para o olho, o mesmo desenho do Fechar. */}
      <button
        type="button"
        className="o-btn o-btn-fantasma o-btn-icone"
        disabled={unidade.isDefault}
        aria-label={`Apagar a unidade${qual}`}
        title={
          unidade.isDefault
            ? 'A padrão não pode ser apagada: é ela que recebe os clientes das outras.'
            : 'Apagar, movendo os clientes para a padrão'
        }
        onClick={aoApagar}
      >
        <IconeLixeira />
      </button>
    </div>
  );
}

/**
 * O `aviso` de cada seção virou o `?` do lado do título — F17.37.
 *
 * As três frases desta tela eram exatamente o caso que a etapa veio resolver:
 * regra que se aprende UMA vez ("renomear não toca em cliente", "apagar uma
 * unidade move os clientes dela"), escrita como se precisasse ser relida toda
 * vez que alguém abre a tela para trocar o nome de uma etiqueta.
 */
function Secao({
  id,
  titulo,
  total,
  aviso,
  acao,
  children,
}: {
  id: string;
  titulo: string;
  total: number;
  aviso?: React.ReactNode;
  /** A ação da seção, no cabeçalho dela — F13: cada catálogo cria o seu. */
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ad-secao" aria-labelledby={id}>
      <div className="ad-secao-cabeca">
        <h2 id={id} className="ad-secao-titulo">
          {titulo} <span className="tnum">{total}</span>
        </h2>
        {aviso && <Ajuda sobre={titulo.toLowerCase()}>{aviso}</Ajuda>}
        {acao && <div className="ad-secao-acoes">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

/** "3 clientes", "1 cliente", "sem uso" — o número que diz se dá para apagar. */
function Uso({ n }: { n: number }) {
  return (
    <span className="ad-uso tnum" data-zero={n === 0 || undefined}>
      {n === 0 ? 'sem uso' : `${n} cliente${n === 1 ? '' : 's'}`}
    </span>
  );
}

/** O que o formulário vai fazer ao salvar, e a recusa, se houver — F13. */
function RodapeDoFormulario({
  efeito,
  recusa,
  salvando,
  aoCancelar,
}: {
  efeito: string;
  recusa: string | null;
  salvando: boolean;
  aoCancelar: () => void;
}) {
  return (
    <>
      {recusa && <Aviso tipo="erro">{recusa}</Aviso>}
      <div className="ad-form-rodape">
        <p className="ad-efeito">{efeito}</p>
        <div className="ad-form-botoes">
          <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={aoCancelar}>
            Cancelar
          </button>
          <button type="submit" className="o-btn o-btn-solido o-btn-sm" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function Catalogos() {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);

  const [plano, setPlano] = useState<RascunhoDePlano | null>(null);
  const [categoria, setCategoria] = useState<RascunhoDeCategoria | null>(null);
  const [etiqueta, setEtiqueta] = useState<RascunhoDeEtiqueta | null>(null);
  const [fundindo, setFundindo] = useState<Etiqueta | null>(null);
  /** O destino escolhido da fusão — F13: escolher e confirmar são dois gestos. */
  const [destino, setDestino] = useState<Etiqueta | null>(null);

  const [falha, setFalha] = useState<{ mensagem: string; status: number | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** A recusa do formulário aberto, mostrada DENTRO dele — F13. */
  const [recusa, setRecusa] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const escrevendo = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api.catalogosCompletos();
      setPlanos(r.plans);
      setCategorias(r.categories);
      setEtiquetas(r.tags);
      setFalha(null);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setFalha({
        mensagem: e instanceof ApiError ? e.message : 'Não foi possível carregar os catálogos.',
        status: e instanceof ApiError ? e.status : null,
      });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setCarregando(true);
    void carregar();
  }, [carregar]);

  /**
   * Roda a escrita, conta o que aconteceu, e recarrega.
   *
   * F13: devolve se deu certo — o formulário só fecha quando salvou, e a
   * recusa aparece nele (`noFormulario`) em vez de no alto da página com o
   * rascunho perdido. A trava (`escrevendo`) impede o segundo pedido de um
   * duplo clique.
   */
  async function executar(
    acao: () => Promise<unknown>,
    aoDarCerto?: (r: unknown) => string,
    { noFormulario = false }: { noFormulario?: boolean } = {},
  ): Promise<boolean> {
    if (escrevendo.current) return false;
    escrevendo.current = true;
    setOcupado(true);
    setErro(null);
    setRecusa(null);
    setRecado(null);
    let certo = true;
    try {
      const r = await acao();
      if (aoDarCerto) setRecado(aoDarCerto(r));
    } catch (e) {
      certo = false;
      const frase = e instanceof ApiError ? e.message : 'Não foi possível concluir. Tente de novo.';
      if (noFormulario) setRecusa(frase);
      else setErro(frase);
    }
    await carregar();
    escrevendo.current = false;
    setOcupado(false);
    return certo;
  }

  /** Abrir um formulário fecha os outros: um rascunho por vez. */
  function abrir(qual: 'plano' | 'categoria' | 'etiqueta' | 'fundir') {
    setRecusa(null);
    if (qual !== 'plano') setPlano(null);
    if (qual !== 'categoria') setCategoria(null);
    if (qual !== 'etiqueta') setEtiqueta(null);
    if (qual !== 'fundir') {
      setFundindo(null);
      setDestino(null);
    }
  }

  async function salvarPlano(e: FormEvent) {
    e.preventDefault();
    if (!plano) return;
    const nome = plano.name.trim();
    if (await executar(() => api.salvarCatalogo('plans', plano.id, plano), () =>
      plano.id ? `Plano "${nome}" salvo.` : `Plano "${nome}" criado.`, { noFormulario: true })) {
      setPlano(null);
    }
  }

  async function salvarCategoria(e: FormEvent) {
    e.preventDefault();
    if (!categoria) return;
    const nome = categoria.name.trim();
    if (await executar(() => api.salvarCatalogo('categories', categoria.id, categoria), () =>
      categoria.id ? `Unidade "${nome}" salva.` : `Unidade "${nome}" criada.`, { noFormulario: true })) {
      setCategoria(null);
    }
  }

  async function salvarEtiqueta(e: FormEvent) {
    e.preventDefault();
    if (!etiqueta) return;
    const nome = etiqueta.name.trim();
    if (await executar(() => api.salvarCatalogo('tags', etiqueta.id, etiqueta), () =>
      etiqueta.id ? `Etiqueta "${nome}" salva.` : `Etiqueta "${nome}" criada.`, { noFormulario: true })) {
      setEtiqueta(null);
    }
  }

  const usoDoPlano = plano?.id ? (planos.find((x) => x.id === plano.id)?.clientCount ?? 0) : 0;
  const usoDaCategoria = categoria?.id ? (categorias.find((x) => x.id === categoria.id)?.clientCount ?? 0) : 0;
  const usoDaEtiqueta = etiqueta?.id ? (etiquetas.find((x) => x.id === etiqueta.id)?.clientCount ?? 0) : 0;

  return (
    <PaginaLarga>
      {/* A BARRA CHEGA AOS CATÁLOGOS — F17.67, e SEM `atual`.

          Catálogos não é nenhum dos sete itens da barra, e nem deveria ser: a
          barra só oferece o que a pessoa alcança, e `catalogos` é outra área
          (F17.36). Acender `Painel` aqui — que foi o que a F17.62 fez na ficha
          do cliente — seria a barra dizendo que a pessoa está onde ela não
          está. Sem `atual`, nenhum item fica aceso; ver `BarraLateral`.

          ⚠️ E A BARRA NÃO FICA VAZIA AQUI, ISSO FOI MEDIDO: das 17 contas
          ativas, NENHUMA tem `catalogos` sem ter também `quadro` e `entrega`.
          Quem chega a esta tela vê a barra inteira. */}
      <TelaComBarra contexto="administracao">
        {/* O TOPO — F29 (Fase 5a). Saíram o ícone de etiqueta do título e o
            `‹ Painel` à mão: Catálogos é tela principal (o menu da conta leva
            a ela), e o caminho para o Painel é a barra. O `+` de cada bloco
            continua no bloco — é de cada catálogo, não da página.

            O subtítulo saiu na F17.37: era a lista dos três blocos que vêm
            logo abaixo, com os mesmos nomes que eles. */}
        <Topo titulo="Catálogos" />

        {carregando && <EstadoDaPagina tipo="carregando" titulo="Carregando os catálogos…" linhas={5} />}

        {!carregando && falha?.status === 403 && (
          <EstadoDaPagina tipo="sem-acesso" titulo="Catálogos não está entre as suas áreas">
            {falha.mensagem}
          </EstadoDaPagina>
        )}
        {!carregando && falha && falha.status !== 403 && (
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

            {/* --- planos ----------------------------------------------------- */}
            <Secao
              id="cat-planos"
              titulo="Planos"
              total={planos.length}
              /* Encurtado ao mudar de lugar: a metade que sobrou falava do sistema
                 antigo e de como o dado é guardado lá dentro — assunto de quem
                 mantém, não de quem renomeia um plano. */
              aviso="Renomear um plano aqui não toca em nenhum cliente: quem já está no plano continua nele, com o nome novo."
              acao={
                <button
                  type="button"
                  className="o-btn o-btn-vidro o-btn-sm"
                  onClick={() => {
                    abrir('plano');
                    setPlano(PLANO_NOVO);
                  }}
                >
                  <IconeMais />
                  Novo plano
                </button>
              }
            >
              {planos.length === 0 ? (
                <EstadoDaPagina tipo="vazio" titulo="Nenhum plano ainda">
                  O plano é o selo colorido no cartão do cliente.
                </EstadoDaPagina>
              ) : (
                <ul className="ad-lista">
                  {planos.map((p) => (
                    <li key={p.id} className="ad-item" data-inativo={p.isActive ? undefined : 'true'}>
                      <span className="ad-item-nome">
                        <Selo
                          estilo={{
                            background: p.colorBg,
                            color: p.colorText,
                            borderColor: p.colorBorder,
                          }}
                        >
                          {p.name}
                        </Selo>
                        {!p.isActive && <Selo tom="warn">inativo</Selo>}
                      </span>
                      <Uso n={p.clientCount} />
                      <div className="ad-item-acoes">
                        <button
                          type="button"
                          className="o-btn o-btn-vidro o-btn-sm"
                          aria-label={`Editar o plano ${p.name}`}
                          onClick={() => {
                            abrir('plano');
                            setPlano({ ...p, id: p.id });
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="o-btn o-btn-fantasma o-btn-icone"
                          disabled={ocupado}
                          aria-label={`Apagar o plano ${p.name}`}
                          title={
                            p.clientCount > 0
                              ? 'Há clientes usando — o banco vai recusar. Desative em vez de apagar.'
                              : 'Apagar plano'
                          }
                          onClick={() => {
                            const aviso =
                              p.clientCount > 0
                                ? `\n\n${p.clientCount} cliente(s) usam este plano: o banco vai recusar. Desative em vez de apagar.`
                                : '\n\nNenhum cliente usa este plano.';
                            if (!window.confirm(`Apagar o plano "${p.name}"?${aviso}`)) return;
                            void executar(
                              () => api.excluirCatalogo('plans', p.id),
                              () => `Plano "${p.name}" apagado.`,
                            );
                          }}
                        >
                          <IconeLixeira />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {plano && (
                <form onSubmit={salvarPlano} className="ad-form-inline o-form" aria-label={plano.id ? 'Editar plano' : 'Novo plano'}>
                  <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                    <Campo
                      rotulo="Nome do plano *"
                      value={plano.name}
                      autoFocus
                      required
                      onChange={(e) => setPlano({ ...plano, name: e.target.value })}
                    />
                    <Campo
                      rotulo="Ordem"
                      type="number"
                      value={String(plano.sortOrder)}
                      onChange={(e) => setPlano({ ...plano, sortOrder: Number(e.target.value) || 0 })}
                    />
                  </div>

                  {/* Fundo, texto e borda do selo do plano. A F43 Fase 5 chegou a
                      tirar "Borda" daqui e voltou atrás no mesmo dia: o contorno
                      do selo do plano é escolha da agência, não ruído do
                      sistema ("não esconder nenhum botão ou função sem querer",
                      Wesley, 08/10). */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <CampoDeCor
                      rotulo="Fundo"
                      valor={plano.colorBg}
                      aoMudar={(v) => setPlano({ ...plano, colorBg: v })}
                    />
                    <CampoDeCor
                      rotulo="Texto"
                      valor={plano.colorText}
                      aoMudar={(v) => setPlano({ ...plano, colorText: v })}
                    />
                    <CampoDeCor
                      rotulo="Borda"
                      valor={plano.colorBorder}
                      aoMudar={(v) => setPlano({ ...plano, colorBorder: v })}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className="eyebrow">Fica assim:</span>
                    <Selo
                      estilo={{
                        background: plano.colorBg,
                        color: plano.colorText,
                        borderColor: plano.colorBorder,
                      }}
                    >
                      {plano.name || 'exemplo'}
                    </Selo>

                    <label className="flex items-center gap-2 text-sm text-plat-dim">
                      <input
                        type="checkbox"
                        className="accent-[var(--luz)]"
                        checked={plano.isActive}
                        onChange={(e) => setPlano({ ...plano, isActive: e.target.checked })}
                      />
                      Ativo — aparece no formulário de cliente
                    </label>
                  </div>

                  <RodapeDoFormulario
                    efeito={
                      plano.id
                        ? `Renomear não mexe em cliente: ${usoDoPlano === 0 ? 'nenhum cliente usa este plano' : `os ${usoDoPlano} cliente(s) continuam nele, com o nome novo`}.` +
                          (plano.isActive ? '' : ' Inativo, ele some do formulário de cliente.')
                        : plano.isActive
                          ? 'O plano novo passa a aparecer no formulário de cliente.'
                          : 'Inativo, o plano novo não aparece no formulário de cliente.'
                    }
                    recusa={recusa}
                    salvando={ocupado}
                    aoCancelar={() => {
                      setPlano(null);
                      setRecusa(null);
                    }}
                  />
                </form>
              )}
            </Secao>

            {/* --- categorias -----------------------------------------------------
                O TEXTO DIZ O QUE A UNIDADE DECIDE HOJE — F31. Ele falava das "abas
                do topo do painel", que não existem desde `90cab18`. O que ficou é
                acesso: quem recebe a unidade em Pessoas vê todos os clientes dela.
                O título continua "Unidades de negócio" porque as linhas são isso;
                o `?` diz para que servem. */}
            <Secao
              id="cat-unidades"
              titulo="Unidades de negócio"
              total={categorias.length}
              aviso="Decidem quem vê cada cliente: quem recebe uma unidade em Pessoas vê todos os clientes dela. Uma delas é sempre a padrão — apagar outra move os clientes dela para a padrão, de uma vez."
              acao={
                <button
                  type="button"
                  className="o-btn o-btn-vidro o-btn-sm"
                  onClick={() => {
                    abrir('categoria');
                    setCategoria({ id: null, name: '', sortOrder: 0 });
                  }}
                >
                  <IconeMais />
                  Nova unidade
                </button>
              }
            >
              <ul className="ad-lista">
                {categorias.map((c) => (
                  <li key={c.id} className="ad-item">
                    <span className="ad-item-nome">
                      <span className="ad-item-texto">{c.name}</span>
                      <SelosDaUnidade unidade={c} />
                    </span>
                    <Uso n={c.clientCount} />
                    <AcoesDaUnidade
                      unidade={c}
                      aoTornarPadrao={() =>
                        void executar(
                          () => api.definirCategoriaPadrao(c.id),
                          () => `"${c.name}" agora é a padrão: recebe os clientes de unidades apagadas.`,
                        )
                      }
                      aoEditar={() => {
                        abrir('categoria');
                        setCategoria({ id: c.id, name: c.name, sortOrder: c.sortOrder });
                      }}
                      aoApagar={() => {
                        const alvo = categorias.find((x) => x.isDefault)?.name ?? 'a padrão';
                        if (
                          !window.confirm(
                            `Apagar "${c.name}"? Os ${c.clientCount} cliente(s) dela vão para "${alvo}".`,
                          )
                        ) {
                          return;
                        }
                        void executar(
                          () => api.excluirCatalogo('categories', c.id),
                          (r) => {
                            const n = (r as { reallocated?: number }).reallocated ?? 0;
                            return n === 0
                              ? 'Categoria apagada. Nenhum cliente precisou ser movido.'
                              : `Categoria apagada. ${n} cliente(s) foram para "${alvo}".`;
                          },
                        );
                      }}
                    />
                  </li>
                ))}
              </ul>

              {categoria && (
                <form onSubmit={salvarCategoria} className="ad-form-inline o-form" aria-label={categoria.id ? 'Editar unidade' : 'Nova unidade'}>
                  <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                    <Campo
                      rotulo="Nome *"
                      value={categoria.name}
                      autoFocus
                      required
                      onChange={(e) => setCategoria({ ...categoria, name: e.target.value })}
                    />
                    <Campo
                      rotulo="Ordem"
                      type="number"
                      value={String(categoria.sortOrder)}
                      onChange={(e) =>
                        setCategoria({ ...categoria, sortOrder: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <RodapeDoFormulario
                    efeito={
                      categoria.id
                        ? `Renomear não move ninguém: ${usoDaCategoria === 0 ? 'nenhum cliente está nela' : `os ${usoDaCategoria} cliente(s) continuam nela`}, e quem a recebeu em Pessoas continua vendo-os.`
                        : 'A unidade nova nasce vazia: ninguém vê cliente por ela até recebê-la em Pessoas.'
                    }
                    recusa={recusa}
                    salvando={ocupado}
                    aoCancelar={() => {
                      setCategoria(null);
                      setRecusa(null);
                    }}
                  />
                </form>
              )}
            </Secao>

            {/* --- etiquetas ------------------------------------------------------ */}
            <Secao
              id="cat-etiquetas"
              titulo="Etiquetas"
              total={etiquetas.length}
              aviso="Fundir move os clientes de uma etiqueta para outra e apaga a original — é o remédio para as variações que aparecem quando cada pessoa cria a sua."
              acao={
                <button
                  type="button"
                  className="o-btn o-btn-vidro o-btn-sm"
                  onClick={() => {
                    abrir('etiqueta');
                    setEtiqueta({ id: null, name: '', color: '#6b7280' });
                  }}
                >
                  <IconeMais />
                  Nova etiqueta
                </button>
              }
            >
              {etiquetas.length === 0 ? (
                <EstadoDaPagina tipo="vazio" titulo="Nenhuma etiqueta ainda">
                  Etiquetas marcam clientes para filtrar a carteira.
                </EstadoDaPagina>
              ) : (
                <ul className="ad-lista ad-etiquetas">
                  {etiquetas.map((t) => (
                    <li key={t.id} className="ad-etiqueta" data-escolhida={fundindo?.id === t.id || undefined}>
                      {/* A cor da etiqueta pinta o ponto, nunca a letra — F17.37.
                          Nesta tela ela chegava a 3,59 de contraste, e é
                          justamente a tela onde se LÊ o nome da etiqueta para
                          renomeá-la. Ver `.o-etiqueta[data-cor]` em `ui/obsidian.css`. */}
                      <i aria-hidden className="ad-etiqueta-cor" style={{ background: t.color }} />
                      <span className="ad-etiqueta-texto">
                        <span className="ad-etiqueta-nome">{t.name}</span>
                        <Uso n={t.clientCount} />
                      </span>
                      <span className="ad-item-acoes">
                        <button
                          type="button"
                          className="o-btn o-btn-fantasma o-btn-icone"
                          aria-label={`Editar a etiqueta ${t.name}`}
                          title="Editar"
                          onClick={() => {
                            abrir('etiqueta');
                            setEtiqueta({ id: t.id, name: t.name, color: t.color });
                          }}
                        >
                          <IconeLapis />
                        </button>
                        <button
                          type="button"
                          className="o-btn o-btn-fantasma o-btn-icone"
                          aria-label={`Fundir a etiqueta ${t.name} com outra`}
                          title="Fundir com outra"
                          disabled={etiquetas.length < 2}
                          onClick={() => {
                            abrir('fundir');
                            setFundindo(t);
                            setDestino(null);
                          }}
                        >
                          <IconeFundir />
                        </button>
                        <button
                          type="button"
                          className="o-btn o-btn-fantasma o-btn-icone"
                          disabled={ocupado}
                          aria-label={`Apagar a etiqueta ${t.name}`}
                          title="Apagar — sai de todos os clientes que a têm"
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Apagar "${t.name}"? Ela sai dos ${t.clientCount} cliente(s) que a têm.`,
                              )
                            ) {
                              return;
                            }
                            void executar(
                              () => api.excluirCatalogo('tags', t.id),
                              () => `Etiqueta "${t.name}" apagada.`,
                            );
                          }}
                        >
                          <IconeLixeira />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {etiqueta && (
                <form onSubmit={salvarEtiqueta} className="ad-form-inline o-form" aria-label={etiqueta.id ? 'Editar etiqueta' : 'Nova etiqueta'}>
                  <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
                    <Campo
                      rotulo="Nome *"
                      value={etiqueta.name}
                      autoFocus
                      required
                      onChange={(e) => setEtiqueta({ ...etiqueta, name: e.target.value })}
                    />
                    <CampoDeCor
                      rotulo="Cor"
                      valor={etiqueta.color}
                      aoMudar={(v) => setEtiqueta({ ...etiqueta, color: v })}
                    />
                  </div>
                  <RodapeDoFormulario
                    efeito={
                      etiqueta.id
                        ? `Renomear vale para ${usoDaEtiqueta === 0 ? 'os clientes que a receberem' : `os ${usoDaEtiqueta} cliente(s) que já a têm`}: ninguém perde a etiqueta.`
                        : 'A etiqueta nova nasce sem cliente; quem vê o cliente pode marcá-la.'
                    }
                    recusa={recusa}
                    salvando={ocupado}
                    aoCancelar={() => {
                      setEtiqueta(null);
                      setRecusa(null);
                    }}
                  />
                </form>
              )}

              {/* FUNDIR EM DOIS GESTOS — F13. Antes o clique no nome do destino
                  já fundia: o botão que parecia "escolher" era o que apagava a
                  etiqueta. Agora escolhe-se, lê-se o efeito com os números, e
                  confirma-se num botão que diz o que faz. */}
              {fundindo && (
                <div className="ad-fusao" role="group" aria-label={`Fundir ${fundindo.name}`}>
                  <p className="ad-fusao-pergunta">
                    Mover os <b className="tnum">{fundindo.clientCount}</b> cliente(s) de{' '}
                    <b>{fundindo.name}</b> para qual etiqueta?
                  </p>
                  <div className="ad-fusao-opcoes">
                    {etiquetas
                      .filter((t) => t.id !== fundindo.id)
                      .map((t) => (
                        <Pilula key={t.id} ativo={destino?.id === t.id} aoClicar={() => setDestino(t)}>
                          {t.name}
                        </Pilula>
                      ))}
                  </div>
                  <div className="ad-form-rodape">
                    <p className="ad-efeito">
                      {destino
                        ? `"${fundindo.name}" é apagada e os clientes dela passam a ter "${destino.name}". Quem já tinha as duas fica com uma só. Não tem volta.`
                        : 'Escolha o destino. A original é apagada.'}
                    </p>
                    {/* UMA AÇÃO PRINCIPAL POR TELA — F43 Fase 10. O "Salvar"
                        dos formulários é o verde desta tela; fundir é um
                        gesto sem volta, e o verde sólido o vendia como o
                        caminho natural. Fica o tom (vidro), com o cancelar em
                        texto, e a frase acima diz o que acontece. */}
                    <div className="ad-form-botoes">
                      <button
                        type="button"
                        className="o-btn o-btn-fantasma o-btn-sm"
                        onClick={() => {
                          setFundindo(null);
                          setDestino(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="o-btn o-btn-vidro o-btn-sm"
                        disabled={!destino || ocupado}
                        onClick={() => {
                          if (!destino) return;
                          const de = fundindo;
                          const para = destino;
                          void executar(
                            () => api.fundirEtiquetas(de.id, para.id),
                            (r) =>
                              `Fundidas. ${(r as { moved: number }).moved} vínculo(s) movidos para "${para.name}".`,
                          ).then(() => {
                            setFundindo(null);
                            setDestino(null);
                          });
                        }}
                      >
                        {destino ? `Fundir em "${destino.name}"` : 'Fundir'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </Secao>
          </>
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}

/** Duas setas que se juntam: fundir uma etiqueta em outra. */
function IconeFundir() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M6 4v5a4 4 0 0 0 4 4h8M14 9l4 4-4 4M6 20v-4" />
    </svg>
  );
}
