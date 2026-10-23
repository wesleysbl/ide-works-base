/**
 * Tela de convite — etapa F1.9, ampliada na F14d.
 *
 * O ACESSO SE DECIDE AQUI, E NÃO DEPOIS
 *   Antes esta tela pedia só o e-mail. A pessoa ativava, entrava com o padrão,
 *   e alguém precisava lembrar de abrir a ficha dela para dizer de qual empresa
 *   é e quais telas alcança.
 *
 *   Decisão separada do ato é decisão que alguém esquece — e aqui o esquecimento
 *   não dá erro nenhum: a pessoa simplesmente fica com o mínimo, ou some numa
 *   lista sem ninguém notar.
 *
 * O CÓDIGO APARECE UMA VEZ SÓ, E A TELA PRECISA DIZER ISSO ANTES
 *   O banco guarda apenas a impressão digital do código. Se ele se perder,
 *   ninguém o recupera — nem olhando o banco. Avisar depois de a pessoa fechar
 *   a janela não serve para nada.
 *
 * O SISTEMA NÃO ENVIA NADA
 *   Aqui se monta o texto pronto para colar no WhatsApp. E-mail cai em spam e
 *   some; o canal real de contato da agência já é o WhatsApp. Automatizar
 *   trocaria um caminho que funciona por um que falha em silêncio.
 *
 * O NOME É O PRIMEIRO CAMPO, E É OBRIGATÓRIO — F17.29
 *   Achado do usuário nesta tela: não havia onde escrever o nome. Sem ele a
 *   pessoa entrava e aparecia pelo e-mail na lista de responsáveis, nos
 *   avatares do cartão, nos comentários e em quem observa.
 *
 *   Quem convida sugere; quem ativa confirma ou corrige. Este é o único
 *   momento em que o vazio ainda pode ser impedido de graça.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { INVITATION_TTL_HOURS, formatCode } from '@/auth/activation-code';
import { AREAS, type Area, ROTULO_DA_AREA } from '@/auth/areas';
import { CODE_SHOWN_ONCE_WARNING, buildInvitationMessage } from '@/auth/invitation-message';
import { NAME_MAX_LENGTH, checkInvitedName } from '@/auth/invited-name';
import { DESCRICAO_DO_PAPEL, PAPEIS, type Papel, ROTULO_DO_PAPEL } from '@/auth/papeis';
import { TelaComBarra } from '@/board/TelaComBarra';
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDeDetalhe } from '@/board/trilha';
import { ApiError, api, semSessao } from '@/lib/api';
import { useSessao } from '@/ui/sessao';
import { IconeChevron } from '@/ui/Icones';
import { Ajuda } from '@/board/menus';
import { Aviso, Botao, Campo, PaginaLarga, Pilula, RotuloDeBloco } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';

type Convite = { email: string; nome: string; code: string; expiresAt: string };
type Empresa = { id: string; nome: string };

export default function Contas() {
  const { sessao } = useSessao();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<Papel>('funcionario');
  // Entrega e quadro juntas: era uma área só até a F17.36, e quem chega para
  // trabalhar precisa das duas. Quem quiser separar desmarca — separar é ato
  // deliberado, não o padrão.
  const [areas, setAreas] = useState<Area[]>(['entrega', 'quadro']);
  const [empresas, setEmpresas] = useState<string[]>([]);

  const [todasAsEmpresas, setTodasAsEmpresas] = useState<Empresa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /** A recusa que é de UM campo fica embaixo dele — F13. */
  const [erroDoNome, setErroDoNome] = useState<string | null>(null);
  const [erroDoEmail, setErroDoEmail] = useState<string | null>(null);
  const [convidando, setConvidando] = useState(false);
  // O ENTER DUAS VEZES NÃO CRIA DOIS CÓDIGOS — F13. O `disabled` do botão só
  // desenha depois; a segunda submissão chega antes e lê `convidando` falso.
  const enviando = useRef(false);
  const resultado = useRef<HTMLHeadingElement>(null);
  const [convite, setConvite] = useState<Convite | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await api.empresas();
        if (vivo) setTodasAsEmpresas(r.empresas);
      } catch {
        // Quem não administra recebe 403 aqui, e isso não é erro — é a regra
        // funcionando. A tela segue sem a escolha de empresa.
        if (vivo) setTodasAsEmpresas([]);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const alternar = <T,>(lista: T[], valor: T): T[] =>
    lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviando.current) return;
    setErro(null);
    setErroDoNome(null);
    setErroDoEmail(null);
    setConvite(null);
    setCopiado(false);

    // A MESMA conferência que a rota faz. Aqui ela poupa a ida à rede; lá ela
    // vale, porque um POST montado à mão não passa por tela nenhuma.
    const conferido = checkInvitedName(nome);
    if (!conferido.ok) {
      setErroDoNome(conferido.message);
      return;
    }

    enviando.current = true;
    setConvidando(true);
    try {
      const r = await api.convidar(email, conferido.value, { papel, areas, empresas });
      setConvite({ email, nome: conferido.value, code: r.code, expiresAt: r.expiresAt });
      setNome('');
      setEmail('');
      // O RESULTADO RECEBE O FOCO — F13: quem enviou pelo teclado ouve "Acesso
      // criado para…" e o próximo Tab chega ao Copiar, e não ao topo.
      requestAnimationFrame(() => resultado.current?.focus());
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      const frase = e instanceof ApiError ? e.message : 'Não foi possível criar o convite. Tente de novo.';
      // A frase do servidor sobre o e-mail vai para o campo do e-mail; o resto
      // (permissão, rede) fica ao lado do botão, que é onde se tenta de novo.
      if (/e-?mail/i.test(frase)) setErroDoEmail(frase);
      else setErro(frase);
    } finally {
      enviando.current = false;
      setConvidando(false);
    }
  }

  const mensagem = convite
    ? buildInvitationMessage({
        email: convite.email,
        name: convite.nome,
        code: convite.code,
        activationUrl: `${window.location.origin}/ativar`,
        expiresAt: new Date(convite.expiresAt),
      })
    : '';

  // Só o topo cria outro super admin — a mesma trava que a rota aplica.
  // Mostrar o que ela vai recusar seria oferecer uma porta fechada.
  //
  // A EMPRESA DEIXOU DE SER DAQUI — F17.36. Ela não depende mais de quem olha,
  // e sim do que a lista traz: quem administra recebe as suas, o topo recebe
  // todas. Ver o bloco de empresas abaixo.
  const eSuper = sessao?.isSuper === true;
  const papeisOferecidos = PAPEIS.filter((p) => p !== 'super_admin' || eSuper);

  return (
    /* O subtítulo saiu na F17.37. Ele dizia "Criar acesso para alguém da
       equipe" embaixo de um título escrito `Convidar`, o que é a tela lendo o
       próprio nome em voz alta. */
    <PaginaLarga>
      {/* ⚠️ ESTA TELA SAIU DA MOLDURA ESTREITA — F17.67, e é a única mudança de
          moldura da etapa. Está escrita porque é a que mais se vê.

          `Convidar` usava `Pagina`: a moldura de `max-w-md`, centrada na
          vertical, que existe para as telas SEM SESSÃO — entrar, ativar,
          redefinir. Ela nasceu ali na F1.9, com aquelas três, e ficou; não foi
          uma decisão sobre o convite, foi a vizinhança de quando ele nasceu.

          Uma barra lateral de altura de árvore dentro de uma caixa de 448px
          centrada na vertical não tem como funcionar. Então a moldura passa a
          ser a larga — a mesma de `Pessoas`, de onde se chega aqui pelo botão
          `Convidar alguém`.

          O FORMULÁRIO NÃO MUDOU DE LARGURA: os `max-w-md` continuam, agora na
          coluna de conteúdo. O que muda é que ele encosta no topo em vez de
          flutuar no meio — e ganha o mapa que não tinha. */}
      <TelaComBarra contexto="administracao">
        {/* O TOPO — F29 (Fase 5a). Convidar é DETALHE de Pessoas — chega-se
            aqui pelo `Convidar alguém` de lá, e as duas telas são da mesma
            área (`pessoas`, `/admin/`). Então tem trilha: `Pessoas › Convidar`.
            Até a F29 a saída era o `‹ Voltar` da moldura, que sem histórico
            não ia a lugar nenhum — esta rota não estava na tabela de "acima". */}
        <Topo
          titulo="Convidar"
          trilha={<Trilha degraus={trilhaDeDetalhe({ nome: 'Pessoas', destino: '/pessoas' }, 'Convidar')} />}
        />

        {/* O FORMULÁRIO EM GRUPOS — F13. Quem recebe, o que pode fazer, onde
            entra: as três perguntas do convite, na ordem em que se decide. A
            largura continua a de leitura (36rem), agora num painel. */}
        <div className="ad-convidar">
          <form onSubmit={enviar} className="ad-form" aria-busy={convidando || undefined}>
            <fieldset className="ad-grupo" disabled={convidando}>
              <legend className="ad-grupo-titulo">Quem recebe</legend>
              <div className="o-form">
                <Campo
                  rotulo="Nome de quem vai receber o acesso"
                  ajuda={
                    <Ajuda sobre="o nome de quem recebe">
                      É por ele que a equipe encontra essa pessoa — na lista de
                      responsáveis, nos avatares do cartão e nos comentários. Quem ativa
                      pode corrigir.
                    </Ajuda>
                  }
                  autoComplete="name"
                  required
                  maxLength={NAME_MAX_LENGTH}
                  value={nome}
                  erro={erroDoNome ?? undefined}
                  onChange={(e) => {
                    setNome(e.target.value);
                    if (erroDoNome) setErroDoNome(null);
                  }}
                />

                <Campo
                  rotulo="E-mail de quem vai receber o acesso"
                  type="email"
                  required
                  value={email}
                  erro={erroDoEmail ?? undefined}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (erroDoEmail) setErroDoEmail(null);
                  }}
                />
              </div>
            </fieldset>

            <fieldset className="ad-grupo" disabled={convidando}>
              <legend className="ad-grupo-titulo">Papel</legend>
              <div className="flex flex-wrap gap-1.5">
                {papeisOferecidos.map((p) => (
                  <Pilula key={p} ativo={papel === p} aoClicar={() => setPapel(p)}>
                    {ROTULO_DO_PAPEL[p]}
                  </Pilula>
                ))}
              </div>
              <p className="ad-grupo-nota">{DESCRICAO_DO_PAPEL[papel]}.</p>
            </fieldset>

            <fieldset className="ad-grupo" disabled={convidando}>
              <legend className="ad-grupo-titulo">Telas que essa pessoa alcança</legend>
              <div className="flex flex-wrap gap-1.5">
                {AREAS.map((a) => (
                  <Pilula key={a} ativo={areas.includes(a)} aoClicar={() => setAreas(alternar(areas, a))}>
                    {ROTULO_DA_AREA[a]}
                  </Pilula>
                ))}
              </div>
              {/* Esta continua na tela, e a F17.37 não a cortou de propósito: ela
                  não explica a tela, ela descreve o ESTADO em que o formulário
                  está agora — nenhuma marcada — e a consequência de enviá-lo
                  assim. Só aparece quando é verdade. */}
              {areas.length === 0 && (
                <div className="mt-2">
                  <Aviso tipo="atencao">
                    Sem nenhuma tela marcada, a pessoa entra e não alcança nada.
                  </Aviso>
                </div>
              )}

              {/* QUEM ADMINISTRA TAMBÉM REPARTE, E SÓ O QUE TEM — F17.36.
                  A lista já chega recortada: quem é de Ide e Ide Hub recebe as duas e
                  mais nada. Esconder não é a trava — o banco recusa a empresa que
                  quem convida não possui, e um pedido montado à mão não passa por
                  tela nenhuma. */}
              {/* UM DETALHE DE ACESSO, RECOLHIDO — F31. O bloco ficava aberto,
                  com o título "Empresas cujos clientes e contas ela vê", e fazia o
                  convite parecer perguntar "de que empresa é esta pessoa" — num
                  sistema que "será apenas Ide" (Wesley, 25/09). A escolha é a
                  mesma (vira `invitations.categories`), só mora num `<details>`
                  como o de "Vínculos pendentes" do painel: fechado por padrão,
                  com a contagem marcada à vista para ninguém enviar sem saber —
                  "nenhuma marcada" diz, fechado, que a pessoa entraria só com a
                  carteira. */}
              {todasAsEmpresas.length > 0 && (
                <div className="mt-3">
                  <AcessoPorUnidade
                    todas={todasAsEmpresas}
                    marcadas={empresas}
                    aoAlternar={(id) => setEmpresas(alternar(empresas, id))}
                  />
                </div>
              )}
            </fieldset>

            <div className="ad-form-fim">
              {erro && <Aviso tipo="erro">{erro}</Aviso>}
              <Botao type="submit" disabled={convidando} aria-disabled={convidando || undefined}>
                {convidando ? 'Criando…' : 'Criar acesso'}
              </Botao>
            </div>
          </form>

          {convite && (
            <section className="ad-resultado" aria-labelledby="ad-resultado-titulo">
              <h2 id="ad-resultado-titulo" ref={resultado} tabIndex={-1} className="ad-resultado-titulo">
                Acesso criado para {convite.nome}
              </h2>
              <p className="ad-resultado-quem">{convite.email}</p>

              <Aviso tipo="atencao">{CODE_SHOWN_ONCE_WARNING}</Aviso>

              <div className="rounded-md border border-hair-2 bg-ink-2 p-4 text-center">
                <div className="text-xs uppercase tracking-wide text-mute">Código de ativação</div>
                <div className="mt-1 font-mono text-2xl tracking-widest text-luz" data-segredo>
                  {formatCode(convite.code)}
                </div>
                <div className="mt-1 text-xs text-mute">
                  vale {INVITATION_TTL_HOURS} horas, uma vez só
                </div>
              </div>

              <pre className="whitespace-pre-wrap rounded-md border border-hair-2 bg-ink-2 p-3 text-xs text-plat-dim" data-segredo>
                {mensagem}
              </pre>

              <div className="flex flex-wrap items-center gap-2">
                <Botao
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(mensagem);
                    setCopiado(true);
                  }}
                >
                  {copiado ? 'Copiado — cole no WhatsApp' : 'Copiar instruções (pronto p/ enviar)'}
                </Botao>
                <Link to="/pessoas" className="o-btn o-btn-fantasma">
                  Ver em Pessoas
                </Link>
              </div>
              <span className="sr-only" role="status">
                {copiado ? 'Instruções copiadas.' : ''}
              </span>
            </section>
          )}

          {/* Aqui havia um parágrafo dizendo "ninguém se cadastra sozinho: toda
              conta nasce de um convite". Ele saiu na F17.37, sem substituto e sem
              `?`: era a tela descrevendo a própria existência para quem já está
              nela criando um convite. Quem lê aquilo já sabe. */}
        </div>
      </TelaComBarra>
    </PaginaLarga>
  );
}

/**
 * O acesso por unidade do convite, recolhido — F31.
 *
 * O RESUMO TEM CARA DE QUE ABRE — Fase 3a. Na Fase 1 ele era um rótulo em
 * versalete com um `▸` de fonte no fim ("ACESSO AOS CLIENTES POR UNIDADE · 0
 * MARCADA ▸"), e a verificação achou que parecia título, não botão. Agora é um
 * botão de verdade (pílula com borda, `o-btn-vidro`), com o verbo do que se faz
 * ao abrir ("Escolher unidades") e a seta em SVG na frente, que gira com o
 * `open` do `<details>` — o mesmo `IconeChevron` das seções da barra lateral.
 * A contagem continua à vista, fechado, para ninguém enviar sem saber.
 */
export function AcessoPorUnidade({
  todas,
  marcadas,
  aoAlternar,
}: {
  todas: ReadonlyArray<{ id: string; nome: string }>;
  marcadas: readonly string[];
  aoAlternar: (id: string) => void;
}) {
  return (
    <details className="group" data-acesso-por-unidade>
      <summary className="o-btn o-btn-vidro o-btn-sm max-w-full list-none [&::-webkit-details-marker]:hidden">
        <IconeChevron className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
        Escolher unidades
        <span className="tnum min-w-0 truncate text-mute">
          ·{' '}
          {marcadas.length === 0
            ? 'nenhuma marcada'
            : `${marcadas.length} marcada${marcadas.length === 1 ? '' : 's'}`}
        </span>
      </summary>
      <div className="mt-2">
        <RotuloDeBloco
          ajuda={
            <Ajuda sobre="o acesso por unidade">
              Quem recebe uma unidade vê todos os clientes dela e as contas da Meta ligadas a
              ela. Sem nenhuma marcada, a pessoa só vê o que estiver na carteira dela.
            </Ajuda>
          }
        >
          Unidades cujos clientes ela vê
        </RotuloDeBloco>
        <div className="flex flex-wrap gap-1.5">
          {todas.map((e) => (
            <Pilula key={e.id} ativo={marcadas.includes(e.id)} aoClicar={() => aoAlternar(e.id)}>
              {e.nome}
            </Pilula>
          ))}
        </div>
      </div>
    </details>
  );
}
