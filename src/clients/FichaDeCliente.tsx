/**
 * A ficha do cliente em janela — etapa F4.5.
 *
 * UM COMPONENTE PARA CRIAR E PARA EDITAR
 *   São o mesmo formulário. Dois componentes divergem no terceiro campo novo:
 *   alguém acrescenta em um e esquece o outro, e o campo "não salva" só na
 *   edição. A diferença entre os dois modos cabe em `clienteId === null`.
 *
 * A VALIDAÇÃO NÃO MORA AQUI
 *   Mora em `clients/formulario.ts`, e a mesma função roda no servidor. Aqui
 *   só se pinta o erro que ela devolve.
 *
 * O QUE ACONTECE COM QUEM NÃO É ADMINISTRADOR
 *   O botão de salvar existe e a recusa vem do banco, traduzida. Esconder o
 *   formulário de quem não pode salvar pareceria defeito; recusar com a frase
 *   certa ensina onde está o limite.
 *
 * O RASCUNHO TEM DONO, E A DECISÃO DE GRAVAR NÃO MORA AQUI — F17.AUD02
 *   A ficha pergunta à sessão quem é (`useSessao`, uma chamada por abertura —
 *   e é AQUI, não no pai, porque a identidade precisa ser a do instante em que
 *   a ficha abre, não a de quando a página carregou). Só com o id confirmado
 *   ela lê, oferece ou guarda rascunho. Quando gravar, quando calar e o que
 *   fazer ao fechar é conta de `ui/rascunho-da-ficha.ts`, que tem teste; a
 *   tela só repassa o que aconteceu: carregou, mudou, recuperou, salvou.
 *
 *   Se a identidade confirmada MUDAR com a ficha aberta — alguém saiu ou
 *   entrou por outra aba —, a ficha se fecha: o que está na tela é de quem
 *   estava aqui antes, e não há como oferecê-lo a quem chegou.
 *
 * A DATA DE INÍCIO SUGERIDA É O DIA DE QUEM CADASTRA — F17.AUD07
 *   Era `new Date().toISOString().slice(0, 10)`, que é o dia UTC: em São Paulo,
 *   a partir das 21h, o cliente novo nascia com a data de amanhã (achado 8 da
 *   auditoria de 09/09/2026). Agora é `iso(today())` — o mesmo dia civil local
 *   que o quadro usa para dizer "hoje" e a mesma escrita `AAAA-MM-DD` do
 *   seletor de data, sem passar por instante nem fuso. Só o preenchimento
 *   inicial de cliente NOVO muda: a data salva de quem já existe e a data que
 *   a pessoa escolher no campo continuam exatamente como vieram.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';

import { today } from '@/board/board';
import { iso } from '@/board/calendario';
import { Ajuda } from '@/board/menus';
import type { FullTreeRow } from '@/board/arvore';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import {
  ENTRADA_VAZIA,
  type EntradaDeCliente,
  type Erros,
  formatarDocumento,
  formatarTelefone,
  validarCliente,
} from '@/clients/formulario';
import {
  FRASE_AO_DESLIGAR_LISTA,
  avisoDeTransferenciaDaLista,
  listasAlcancaveisDaArvore,
  rotuloDaListaDoQuadro,
  rotuloDeListaLigada,
  type ClientBoardList,
  type ListaAlcancavelDoQuadro,
} from '@/clients/listas-do-quadro';
import { SeletorDeListaDoQuadro } from '@/clients/SeletorDeListaDoQuadro';
import { ApiError, api } from '@/lib/api';
import { quandoFoi } from '@/ui/rascunho';
import {
  type EstadoDoRascunho,
  SEM_RASCUNHO,
  criarRascunhoDaFicha,
} from '@/ui/rascunho-da-ficha';
import { prenderOTab, useDevolverFoco, useFocoDaJanela } from '@/ui/foco';
import { IconeMais } from '@/ui/Icones';
import { BotaoDeFechar } from '@/ui/janela';
import { Area, Aviso, Campo, Selecao } from '@/ui/primitivos';
import { useSessao } from '@/ui/sessao';

const TIPO_ROTULO: Record<ContentType, string> = {
  video: 'Vídeos',
  arte: 'Artes',
  foto: 'Fotos',
  ads: 'ADS',
};

type Catalogos = Awaited<ReturnType<typeof api.catalogos>>;

/**
 * `ajuda` chegou na F17.37 — o `?` que substitui o parágrafo cinza que várias
 * seções tinham embaixo do título. Ver `RotuloDeBloco` em `@/ui/primitivos`.
 */
function Secao({
  titulo,
  ajuda,
  children,
}: {
  titulo: string;
  ajuda?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="o-rotulo-linha mb-2">
        <span className="eyebrow">{titulo}</span>
        {ajuda}
      </h3>
      <div className="o-card space-y-3 p-3">{children}</div>
    </section>
  );
}

export function FichaDeCliente({
  clienteId,
  aoFechar,
  aoSalvar,
}: {
  /** `null` cria; um id edita. */
  clienteId: string | null;
  aoFechar: () => void;
  aoSalvar: (id: string) => void;
}) {
  const [entrada, setEntrada] = useState<EntradaDeCliente>(ENTRADA_VAZIA);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [listasAlcancaveis, setListasAlcancaveis] = useState<ListaAlcancavelDoQuadro[]>(
    [],
  );
  const [listasLigadas, setListasLigadas] = useState<ClientBoardList[]>([]);
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  // O foco que faz o `Esc` desta janela existir — F17.33.
  const janela = useFocoDaJanela<HTMLFormElement>();
  // O foco volta ao botão que abriu (Novo cliente, Editar) ao fechar — antes ele caía no `<body>`.
  useDevolverFoco(true);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  /**
   * O rascunho OFERECIDO — não o aplicado. Ver `ui/rascunho.ts`.
   *
   * Restaurar em silêncio seria pior que perder: a pessoa abriria a ficha, veria
   * campos preenchidos e não saberia se aquilo é o que está no sistema ou uma
   * edição de ontem que ela abandonou. E gravaria por cima do certo achando que
   * estava só confirmando.
   *
   * O estado vem de `rascunhoDaFicha`, que é quem decide; aqui só se desenha.
   */
  const [rascunho, setRascunho] = useState<EstadoDoRascunho<EntradaDeCliente>>(SEM_RASCUNHO);
  const [rascunhoDaFicha] = useState(() =>
    criarRascunhoDaFicha<EntradaDeCliente>({ aoMudar: setRascunho }),
  );

  // Quem está na sessão — o dono de qualquer rascunho. `null` enquanto a
  // sessão carrega ou se ela falhou: nesses dois casos não há rascunho.
  const { sessao } = useSessao();
  const usuario = sessao?.userId ?? null;

  const campo = <K extends keyof EntradaDeCliente>(chave: K, valor: EntradaDeCliente[K]) =>
    setEntrada((e) => ({ ...e, [chave]: valor }));

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErroGeral(null);

    Promise.all([
      api.catalogos(),
      clienteId ? api.fichaDoCliente(clienteId) : Promise.resolve(null),
      clienteId
        ? api.listasDoQuadroDoCliente(clienteId)
        : Promise.resolve({ lists: [] as ClientBoardList[] }),
      api.arvoreCompleta(),
    ])
      .then(([cat, ficha, quadro, arvore]) => {
        if (cancelado) return;
        setCatalogos(cat);
        const ligadas = quadro.lists;
        setListasLigadas(ligadas);
        setListasAlcancaveis(listasAlcancaveisDaArvore(arvore.spaces as FullTreeRow[]));

        // O que veio do sistema é a base: rascunho é o que DIFERE disto.
        const carregado: EntradaDeCliente = ficha
          ? {
              ...(ficha.client as EntradaDeCliente),
              // A leitura das listas é a da Fase 2 — um caminho só. Não se
              // monta uma segunda opinião a partir do `/form`.
              boardListIds: ligadas.map((l) => l.id),
            }
          : {
              // Cliente novo começa na categoria padrão — a que o banco garante
              // ser exatamente uma. Sem isto o formulário abre com o seletor em
              // branco e a primeira tentativa de salvar falha por um campo que
              // ninguém tocou.
              ...ENTRADA_VAZIA,
              categoryId:
                (cat.categories.find((c) => c.isDefault) ?? cat.categories[0])?.id ?? '',
              // O dia civil de quem cadastra, não o dia UTC — F17.AUD07. Ver o
              // cabeçalho do arquivo.
              startedOn: iso(today()),
            };
        rascunhoDaFicha.carregou(carregado);
        setEntrada(carregado);
      })
      .catch((e) => {
        if (!cancelado) setErroGeral(e instanceof ApiError ? e.message : 'Não foi possível abrir.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [clienteId, rascunhoDaFicha]);

  /**
   * A identidade confirmada abre a ficha para o rascunho — e só ela. Enquanto
   * `usuario` é `null`, nada se lê nem se grava. Há rascunho? Só PERGUNTA —
   * quem decide aplicar é a pessoa.
   */
  useEffect(() => {
    rascunhoDaFicha.abrir(usuario === null ? null : { usuario, tipo: 'cliente', id: clienteId });
  }, [rascunhoDaFicha, usuario, clienteId]);

  /**
   * A identidade MUDOU com a ficha aberta: alguém saiu ou entrou por outra
   * aba. O que está na tela é de quem estava aqui antes — a ficha se fecha.
   * `aoFechar` vai por espelho para o efeito só correr quando `usuario` muda.
   */
  const donoAnterior = useRef<string | null>(null);
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;
  useEffect(() => {
    const antes = donoAnterior.current;
    if (usuario !== null) donoAnterior.current = usuario;
    if (antes !== null && usuario !== antes) fechar.current();
  }, [usuario]);

  /**
   * GUARDA ENQUANTO SE DIGITA, e não a cada tecla — mas quem decide se este
   * valor merece gravação, e quando, é `rascunhoDaFicha`: só o que difere do
   * carregado, nunca com uma recuperação pendente, meio segundo depois da
   * última mudança. Ver o cabeçalho de `ui/rascunho-da-ficha.ts`.
   */
  useEffect(() => {
    rascunhoDaFicha.mudou(entrada);
  }, [rascunhoDaFicha, entrada]);

  // Fechar com edição em curso conclui a gravação local antes de desmontar.
  useEffect(() => () => rascunhoDaFicha.encerrar(), [rascunhoDaFicha]);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErroGeral(null);

    const conferido = validarCliente(entrada);
    if (!conferido.ok) {
      setErros(conferido.erros);
      return;
    }
    setErros({});
    setSalvando(true);

    try {
      const r = clienteId
        ? await api.salvarCliente(clienteId, entrada)
        : await api.criarCliente(entrada);
      // Gravou de verdade: o rascunho perdeu a razão de existir. Deixá-lo lá
      // faria a próxima abertura oferecer de volta o que já está salvo — e o
      // temporizador que ainda estivesse agendado o recriaria.
      rascunhoDaFicha.salvo();
      aoSalvar(r.id);
    } catch (e) {
      // O servidor valida de novo, e pode enxergar o que a tela não enxerga —
      // uma categoria apagada por outra pessoa entre abrir e salvar, por exemplo.
      if (e instanceof ApiError && e.erros) setErros(e.erros as Erros);
      setErroGeral(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="o-scrim"
      role="dialog"
      aria-modal
      aria-label={clienteId ? 'Editar cliente' : 'Novo cliente'}
      onMouseDown={(e) => {
        // Só fecha em clique no fundo. Sem o teste de alvo, arrastar para
        // selecionar texto de dentro e soltar fora fecharia o formulário
        // preenchido.
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <form
        onSubmit={enviar}
        /*
          ⚠️ O `Esc` E O FOCO CHEGARAM NA F17.33 — antes esta janela fechava por
          `X` e por clique fora, e a tecla não fazia nada. Ver a tabela do "o que
          havia" no cabeçalho de `@/ui/janela`.

          O `ref` não é enfeite: o ouvinte mora neste elemento, e tecla só passa
          por onde está o foco. O primeiro campo do formulário costuma tomá-lo
          sozinho, e nesse caso `useFocoDaJanela` não mexe em nada.
        */
        ref={janela}
        tabIndex={-1}
        onKeyDown={(e) => {
          // A janela é `aria-modal` (o `role` mora no véu, aqui fora): o `Tab`
          // não pode sair dela para a página coberta. Só as pontas.
          if (e.key === 'Tab') {
            prenderOTab(e, e.currentTarget.closest<HTMLElement>('[role="dialog"]'));
            return;
          }
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          aoFechar();
        }}
        className="o-modal max-w-3xl p-5"
      >
        <header className="flex items-start justify-between gap-4">
          <h2 className="o-titulo text-xl">{clienteId ? 'Editar cliente' : 'Novo cliente'}</h2>
          {/* Era um `✕` solto, sem nome — quem usa leitor de tela ouvia "cruz
              de multiplicação". F17.33. */}
          <BotaoDeFechar aoFechar={aoFechar} />
        </header>

        {carregando && <p className="mt-4 text-sm text-mute">Carregando…</p>}

        {/* O RASCUNHO SE OFERECE, NÃO SE IMPÕE.
            Diz de quando é, porque "há 3 minutos" e "há 9 horas" pedem decisões
            diferentes — e sem isso a pessoa não tem como saber se aquilo é o
            trabalho que ela acabou de perder ou uma edição que ela abandonou de
            propósito ontem. */}
        {!carregando && usuario !== null && rascunho.recuperacao === 'pendente' && rascunho.oferecido && (
          <div className="mt-4">
            <Aviso tipo="atencao">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Há um rascunho desta ficha, de {quandoFoi(rascunho.oferecido.guardadoEm)}. O
                  que está na tela é o que está salvo no sistema.
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="o-btn o-btn-vidro o-btn-sm"
                    onClick={() => {
                      const valor = rascunhoDaFicha.recuperar();
                      if (valor !== null) {
                        setEntrada({
                          ...ENTRADA_VAZIA,
                          ...valor,
                          boardListIds: valor.boardListIds ?? [],
                        });
                      }
                    }}
                  >
                    Recuperar rascunho
                  </button>
                  <button
                    type="button"
                    className="o-btn o-btn-fantasma o-btn-sm"
                    onClick={() => rascunhoDaFicha.descartar()}
                  >
                    Descartar
                  </button>
                </span>
              </div>
            </Aviso>
          </div>
        )}

        {!carregando && catalogos && (
          <>
            <Secao titulo="Identificação">
              <Campo
                rotulo="Nome do cliente *"
                placeholder="Digite o nome do cliente"
                value={entrada.name}
                erro={erros.name}
                onChange={(e) => campo('name', e.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  rotulo="CPF / CNPJ"
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  value={entrada.taxId}
                  erro={erros.taxId}
                  dica="Os dígitos são conferidos."
                  onChange={(e) => campo('taxId', e.target.value)}
                  // Formata ao sair do campo, não a cada tecla: máscara que se
                  // monta enquanto se digita empurra o cursor e atrapalha quem
                  // corrige o meio do número.
                  onBlur={(e) => campo('taxId', formatarDocumento(e.target.value))}
                />
                <Campo
                  rotulo="E-mail da empresa"
                  type="email"
                  placeholder="contato@empresa.com"
                  value={entrada.companyEmail}
                  erro={erros.companyEmail}
                  onChange={(e) => campo('companyEmail', e.target.value)}
                />
              </div>
            </Secao>

            <Secao titulo="Contrato">
              <div className="grid gap-3 sm:grid-cols-2">
                <Selecao
                  rotulo="Tipo de plano"
                  value={entrada.planId ?? ''}
                  erro={erros.planId}
                  onChange={(e) => campo('planId', e.target.value === '' ? null : e.target.value)}
                >
                  <option value="">Sem plano</option>
                  {catalogos.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Selecao>

                <Selecao
                  rotulo="Categoria *"
                  value={entrada.categoryId}
                  erro={erros.categoryId}
                  onChange={(e) => campo('categoryId', e.target.value)}
                >
                  {catalogos.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Selecao>

                <Campo
                  rotulo="Data de início *"
                  type="date"
                  value={entrada.startedOn}
                  erro={erros.startedOn}
                  onChange={(e) => campo('startedOn', e.target.value)}
                />
                <Campo
                  rotulo="Data de renovação"
                  type="date"
                  value={entrada.renewsOn}
                  erro={erros.renewsOn}
                  onChange={(e) => campo('renewsOn', e.target.value)}
                />
              </div>
            </Secao>

            <Secao
              titulo="Demandas contratadas"
              ajuda={
                <Ajuda sobre="a cota que se altera aqui">
                  É a cota de hoje. Alterar aqui não reescreve mês já aberto — o
                  contrato de cada mês é congelado quando o mês abre.
                </Ajuda>
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {CONTENT_TYPES.map((t) => (
                  <Campo
                    key={t}
                    rotulo={TIPO_ROTULO[t]}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={String(entrada.quotas[t])}
                    onChange={(e) =>
                      campo('quotas', {
                        ...entrada.quotas,
                        // Campo numérico vazio devolve "", e Number("") é 0 —
                        // que aqui é o valor certo: apagar significa "nenhum".
                        [t]: e.target.value === '' ? 0 : Number(e.target.value),
                      })
                    }
                  />
                ))}
              </div>
              {erros.quotas && (
                <p className="o-dica" data-erro="true" role="alert">
                  {erros.quotas}
                </p>
              )}
            </Secao>

            <Secao titulo="Links do cliente">
              {entrada.links.map((l, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
                  <Campo
                    rotulo="Título"
                    placeholder="Ex: Instagram"
                    value={l.title}
                    onChange={(e) =>
                      campo(
                        'links',
                        entrada.links.map((x, j) =>
                          j === i ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <Campo
                    rotulo="Endereço"
                    placeholder="instagram.com/… ou sheinlink://…"
                    value={l.url}
                    erro={erros[`link${i}`]}
                    onChange={(e) =>
                      campo(
                        'links',
                        entrada.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="o-btn o-btn-fantasma o-btn-icone self-end"
                    title="Remover link"
                    onClick={() =>
                      campo(
                        'links',
                        entrada.links.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="o-btn o-btn-vidro o-btn-sm"
                onClick={() => campo('links', [...entrada.links, { title: '', url: '' }])}
              >
                <IconeMais />
                Adicionar link
              </button>
            </Secao>

            <Secao
              titulo="Listas do quadro"
              ajuda={
                <Ajuda sobre="o que acontece ao desligar uma lista">{FRASE_AO_DESLIGAR_LISTA}</Ajuda>
              }
            >
              <p className="text-[0.72rem] text-mute">{FRASE_AO_DESLIGAR_LISTA}</p>

              {(entrada.boardListIds ?? []).map((id, i) => {
                const escolhidas = new Set(
                  (entrada.boardListIds ?? []).filter((x, j) => j !== i && x !== ''),
                );
                const opcoes = listasAlcancaveis.filter((l) => !escolhidas.has(l.id));
                const alcancavel = listasAlcancaveis.find((l) => l.id === id);
                const ligada = listasLigadas.find((l) => l.id === id);
                const rotuloAtual =
                  id === ''
                    ? ''
                    : alcancavel
                      ? rotuloDaListaDoQuadro(alcancavel)
                      : ligada
                        ? rotuloDeListaLigada(ligada)
                        : 'Lista fora do seu alcance no quadro';
                const aviso = alcancavel
                  ? avisoDeTransferenciaDaLista(alcancavel, clienteId)
                  : null;

                return (
                  <div key={i} className="space-y-2">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <SeletorDeListaDoQuadro
                        valor={id}
                        opcoes={opcoes}
                        rotuloAtual={rotuloAtual}
                        aoEscolher={(novo) =>
                          campo(
                            'boardListIds',
                            (entrada.boardListIds ?? []).map((x, j) =>
                              j === i ? novo : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="o-btn o-btn-fantasma o-btn-icone self-start"
                        title="Soltar vínculo desta lista"
                        onClick={() =>
                          campo(
                            'boardListIds',
                            (entrada.boardListIds ?? []).filter((_, j) => j !== i),
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                    {aviso && <Aviso tipo="atencao">{aviso}</Aviso>}
                  </div>
                );
              })}

              <button
                type="button"
                className="o-btn o-btn-vidro o-btn-sm"
                onClick={() =>
                  campo('boardListIds', [...(entrada.boardListIds ?? []), ''])
                }
              >
                <IconeMais />
                Adicionar lista
              </button>
            </Secao>

            <Secao titulo="Contato">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  rotulo="Telefone"
                  placeholder="(11) 99999-9999"
                  value={entrada.phone}
                  erro={erros.phone}
                  onChange={(e) => campo('phone', e.target.value)}
                  onBlur={(e) => campo('phone', formatarTelefone(e.target.value))}
                />
                <Campo
                  rotulo="WhatsApp"
                  placeholder="(11) 99999-9999"
                  value={entrada.whatsapp}
                  erro={erros.whatsapp}
                  onChange={(e) => campo('whatsapp', e.target.value)}
                  onBlur={(e) => campo('whatsapp', formatarTelefone(e.target.value))}
                />
              </div>
              <Campo
                rotulo="Endereço"
                placeholder="Rua, número, cidade - estado"
                value={entrada.address}
                onChange={(e) => campo('address', e.target.value)}
              />
            </Secao>

            <Secao titulo="Proprietário">
              <Campo
                rotulo="Nome do proprietário"
                placeholder="Nome completo"
                value={entrada.ownerName}
                onChange={(e) => campo('ownerName', e.target.value)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  rotulo="Celular"
                  placeholder="(11) 99999-9999"
                  value={entrada.ownerPhone}
                  erro={erros.ownerPhone}
                  onChange={(e) => campo('ownerPhone', e.target.value)}
                  onBlur={(e) => campo('ownerPhone', formatarTelefone(e.target.value))}
                />
                <Campo
                  rotulo="WhatsApp"
                  placeholder="(11) 99999-9999"
                  value={entrada.ownerWhatsapp}
                  erro={erros.ownerWhatsapp}
                  onChange={(e) => campo('ownerWhatsapp', e.target.value)}
                  onBlur={(e) => campo('ownerWhatsapp', formatarTelefone(e.target.value))}
                />
              </div>
            </Secao>

            <Secao titulo="Etiquetas">
              {catalogos.tags.length === 0 ? (
                <p className="text-[0.72rem] text-mute">
                  Nenhuma etiqueta cadastrada ainda. Elas se criam na tela de Catálogos.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {catalogos.tags.map((t) => {
                    const marcada = entrada.tagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={marcada}
                        onClick={() =>
                          campo(
                            'tagIds',
                            marcada
                              ? entrada.tagIds.filter((x) => x !== t.id)
                              : [...entrada.tagIds, t.id],
                          )
                        }
                        className="rounded border px-2 py-1 text-[0.75rem] transition"
                        style={{
                          borderColor: t.color,
                          color: marcada ? 'var(--ink-0)' : t.color,
                          background: marcada ? t.color : 'var(--ink-2)',
                        }}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Secao>

            <Secao titulo="Observações">
              <Area
                rotulo="Informações importantes do cliente"
                placeholder="Observações adicionais sobre o cliente…"
                value={entrada.notes}
                onChange={(e) => campo('notes', e.target.value)}
              />
            </Secao>

            {erroGeral && (
              <div className="mt-4">
                <Aviso tipo="erro">{erroGeral}</Aviso>
              </div>
            )}

            <footer className="mt-5 flex justify-end gap-2">
              <button type="button" className="o-btn o-btn-vidro" onClick={aoFechar}>
                Cancelar
              </button>
              <button type="submit" className="o-btn o-btn-solido" disabled={salvando}>
                {salvando ? 'Salvando…' : clienteId ? 'Salvar' : 'Criar cliente'}
              </button>
            </footer>
          </>
        )}

        {!carregando && !catalogos && erroGeral && (
          <div className="mt-4">
            <Aviso tipo="erro">{erroGeral}</Aviso>
          </div>
        )}
      </form>
    </div>
  );
}
