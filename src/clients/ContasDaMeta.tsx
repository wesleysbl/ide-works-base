/**
 * As contas da Meta deste cliente — etapa F7d, refeita na F19d.
 *
 * POR QUE A ATRIBUIÇÃO MORA AQUI, E NÃO NA ÁREA META
 *   A conta existe na Meta por conta própria. O que **não** existe lá é a
 *   informação de que aquela conta corresponde a este cliente da agência —
 *   isso é conhecimento do Sistema IDE, e quem o tem é quem cuida da carteira.
 *
 *   Por isso a área Meta mostra as contas organizadas por gerenciador, e a
 *   ponte se faz aqui: na ficha de quem se conhece.
 *
 * O QUE MUDOU NA F19d, E POR QUÊ
 *   1. A escolha era uma PAREDE de botões — uma por conta livre, e são 102.
 *      Virou gaveta: busca, marca quantas quiser, e o que já é do cliente
 *      aparece marcado. Ligar e desligar passam a ser o mesmo gesto, no mesmo
 *      lugar.
 *
 *   2. O que estava ligado vinha numa lista achatada, misturando conta de
 *      anúncio e perfil do Instagram. São coisas diferentes: o gerenciador
 *      responde por dinheiro e pende de uma BM; o perfil responde por audiência
 *      e pende de uma página. Agora são dois blocos, cada um dizendo de onde a
 *      conta vem.
 *
 * A GAVETA NÃO OFERECE CONTA DE OUTRO CLIENTE
 *   Ela lista as livres e as DESTE cliente. Mostrar as de outros faria um
 *   clique distraído tirar a conta de quem já a tinha — e ninguém saberia,
 *   porque a ficha do outro cliente não está aberta.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Ajuda } from '@/board/menus';
import { ApiError, api } from '@/lib/api';
import { type ContaDaMeta, porQueVazio } from '@/clients/contas-vazias';
import { semelhanca } from '@/meta/pareamento';
import { Gaveta } from '@/ui/Gaveta';
import { Aviso, Selo } from '@/ui/primitivos';

const SIGLA = { ad_account: 'ADS', instagram_account: 'IG' } as const;
const COR = {
  ad_account: 'var(--luz-lives-texto)',
  instagram_account: 'var(--luz-agencia-texto)',
} as const;

/**
 * De onde a conta vem, na palavra que a Meta usa.
 *
 * Conta de anúncio pende de uma BM; perfil do Instagram pende de uma página.
 * Um rótulo só para os dois mentiria em metade dos casos — foi a mesma decisão
 * tomada na área Meta.
 */
function origem(c: ContaDaMeta): { rotulo: string; valor: string } {
  return c.kind === 'ad_account'
    ? { rotulo: 'BM', valor: c.businessName ?? '— não informada —' }
    : { rotulo: 'página', valor: c.pageName ?? '— não informada —' };
}

function LinhaDaConta({
  c,
  aoSoltar,
}: {
  c: ContaDaMeta;
  aoSoltar: () => void;
}) {
  const o = origem(c);
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
      style={{ borderTop: '1px solid var(--hair)' }}
    >
      <span className="o-mono text-[0.72rem] uppercase" style={{ color: COR[c.kind] }}>
        {SIGLA[c.kind]}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-sm text-plat">{c.displayName ?? c.externalId}</span>
        <span className="o-mono block text-[0.70rem] text-mute">
          {o.rotulo}: {o.valor}
        </span>
      </span>

      <span className="ml-auto flex items-center gap-2">
        {c.lastError && (
          <span className="text-[0.70rem]" style={{ color: 'var(--err)' }}>
            {c.lastError}
          </span>
        )}
        <Selo
          tom={c.diasColetados > 0 ? 'ok' : 'neutro'}
          titulo={
            c.diasColetados > 0
              ? 'Dias de série já coletados — é o que dá relatório'
              : 'Ainda sem série: o relatório desta conta vem vazio'
          }
        >
          {c.diasColetados > 0 ? `${c.diasColetados} dia(s)` : 'sem coleta'}
        </Selo>
        <button
          type="button"
          className="o-btn o-btn-fantasma o-btn-sm"
          title="Desatribuir — a conta continua existindo na área Meta"
          onClick={aoSoltar}
        >
          soltar
        </button>
      </span>
    </div>
  );
}

/**
 * UM BLOCO VAZIO PRECISA DIZER POR QUE ESTÁ VAZIO — F19e.
 *
 * "Nenhum gerenciador ligado" descreve três situações que pedem ações
 * diferentes, e a tela mostrava a mesma frase para as três:
 *
 *   há conta livre parecida  -> alguém só precisa ligar, e leva um clique
 *   há livres, nenhuma dele  -> a Meta não entrega a conta deste cliente
 *   não há livre nenhuma     -> não há o que ligar, de ninguém
 *
 * Aconteceu com o cliente Jatobá em 24/08/2026: a página dele estava
 * compartilhada e a conta de anúncio não, então o Instagram entrava e o
 * gerenciador nunca apareceria. A tela não tinha como dizer isso, e a dúvida
 * virou pergunta para quem construiu o sistema — que é o sinal de que a tela
 * estava escondendo a resposta.
 *
 * O NÚMERO DE LIVRES SOZINHO NÃO RESPONDE NADA
 *   Há ~100 contas livres na base. Dizer "há 19 gerenciadores livres" é
 *   verdade e é inútil: a pergunta é se ALGUM deles é deste cliente. Por isso
 *   a frase usa a mesma semelhança de nome que já ordena a gaveta.
 */
function Bloco({
  titulo,
  vazio,
  contas,
  aoSoltar,
}: {
  titulo: string;
  /** Por que está vazio: o começo em destaque, e o resto explicando. */
  vazio: { forte: string; resto: string };
  contas: ContaDaMeta[];
  aoSoltar: (id: string) => void;
}) {
  return (
    <div className="mt-3">
      {/* O ESTADO FICA, O PORQUÊ VAI PARA O `?` — F17.37.
          Esta era a maior mancha de cinza da ficha do cliente: nove linhas por
          bloco, dois blocos, sempre que não há conta ligada. A separação já
          existia no tipo (`forte` e `resto`) e ninguém a tinha usado como
          separação de PESO — `forte` diz o que está acontecendo agora e cabe
          numa linha; `resto` explica como funcionam as permissões da Meta, que
          se aprende uma vez e não muda de cliente para cliente. */}
      {/* VAZIO NUMA LINHA — F11B. O nome do bloco e o porquê lado a lado:
          o bloco vazio era um título, um número e um parágrafo embaixo. */}
      <div className="cl-meta-bloco px-3">
        <span className="o-rotulo-linha">
          <span className="eyebrow">{titulo}</span>
          <span className="tnum o-mono text-[0.70rem] text-mute">{contas.length}</span>
          {contas.length === 0 && <Ajuda sobre={`por que ${titulo.toLowerCase()} está vazio`}>{vazio.resto}</Ajuda>}
        </span>
        {contas.length === 0 && <span className="cl-meta-vazio">{vazio.forte}</span>}
      </div>
      {contas.map((c) => (
        <LinhaDaConta key={c.id} c={c} aoSoltar={() => aoSoltar(c.id)} />
      ))}
    </div>
  );
}

export function ContasDaMeta({
  clienteId,
  clienteNome,
  aoCarregar,
}: {
  clienteId: string;
  clienteNome: string;
  /**
   * As contas, a cada leitura — F11B. A ficha resume o vínculo numa linha
   * (`resumoDaMeta`) sem pedir as contas uma segunda vez.
   */
  aoCarregar?: (contas: ContaDaMeta[]) => void;
}) {
  const [contas, setContas] = useState<ContaDaMeta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /** A LEITURA falhou (e não uma atribuição): é ela que ganha "Tentar de novo". */
  const [falhouLer, setFalhouLer] = useState(false);

  // Por espelho: um `aoCarregar` novo a cada desenho do pai não pode refazer a leitura.
  const aoCarregarAtual = useRef(aoCarregar);
  useEffect(() => {
    aoCarregarAtual.current = aoCarregar;
  }, [aoCarregar]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await api.contasDaMeta();
      setContas(r.accounts as ContaDaMeta[]);
      setFalhouLer(false);
      aoCarregarAtual.current?.(r.accounts as ContaDaMeta[]);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar as contas.');
      setFalhouLer(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setCarregando(true);
    void carregar();
  }, [carregar]);

  async function atribuir(assetId: string, alvo: string | null) {
    setErro(null);
    try {
      await api.atribuirClienteAConta(assetId, alvo);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível atribuir.');
    }
  }

  const minhas = useMemo(
    () => contas.filter((c) => c.client?.id === clienteId),
    [contas, clienteId],
  );

  /**
   * O que a gaveta oferece: as LIVRES e as DESTE cliente.
   *
   * As de outros clientes ficam de fora — ver o cabeçalho. E a ordem coloca as
   * parecidas com o nome do cliente primeiro, porque numa lista de quarenta a
   * ordem alfabética não ajuda ninguém.
   */
  const oferecidas = useMemo(() => {
    const candidatas = contas.filter((c) => c.client === null || c.client.id === clienteId);
    return candidatas
      .map((c) => ({
        conta: c,
        nota: semelhanca(clienteNome, c.displayName ?? c.businessName ?? c.pageName ?? ''),
      }))
      .sort((a, b) => b.nota - a.nota || (a.conta.displayName ?? '').localeCompare(b.conta.displayName ?? ''))
      .map(({ conta, nota }) => {
        const o = origem(conta);
        return {
          valor: conta.id,
          // A sigla no rótulo faz o tipo aparecer na busca: digitar "ads" filtra
          // gerenciadores, "ig" filtra perfis.
          rotulo:
            `${SIGLA[conta.kind]} · ${conta.displayName ?? conta.externalId}` +
            ` — ${o.valor}` +
            (nota >= 80 ? '  ★' : ''),
        };
      });
  }, [contas, clienteId, clienteNome]);

  const escolhidas = minhas.map((c) => c.id);
  const deOutros = contas.filter((c) => c.client !== null && c.client.id !== clienteId).length;

  const gerenciadores = minhas.filter((c) => c.kind === 'ad_account');
  const perfis = minhas.filter((c) => c.kind === 'instagram_account');

  return (
    <div className="o-card">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <div>
          <h3 className="eyebrow">Contas da Meta</h3>
          {/* Saiu na F17.37: "Quais gerenciadores e perfis do Instagram
              pertencem a X" é o título dito de novo, com mais palavras. */}
        </div>

        <Gaveta
          rotulo="Ligar conta"
          itens={oferecidas}
          escolhidos={escolhidas}
          // Marcar liga, desmarcar solta — o mesmo gesto nos dois sentidos.
          aoAlternar={(id) =>
            void atribuir(id, escolhidas.includes(id) ? null : clienteId)
          }
          aoLimpar={() => {
            for (const c of minhas) void atribuir(c.id, null);
          }}
          larguraDoBalao="w-96"
        />
      </header>

      {erro && (
        <div className="px-3 pt-3">
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

      {carregando && <p className="px-3 py-3 text-sm text-mute">Carregando…</p>}

      {/* Sem NENHUMA leitura, os blocos não se desenham: "nenhum gerenciador
          ligado" seria afirmar o que a tela não sabe, e o aviso de cima tem a
          saída. Se já havia contas lidas (a releitura depois de ligar uma é que
          falhou), elas ficam — com os botões de soltar —, e o aviso diz que a
          lista pode estar desatualizada. */}
      {!carregando && !(falhouLer && contas.length === 0) && (
        <>
          <Bloco
            titulo="Gerenciadores de anúncios"
            vazio={porQueVazio(
              contas,
              clienteNome,
              'ad_account',
              'gerenciador',
              'gerenciadores',
              'Sem um ligado, este cliente não aparece no relatório de campanhas.',
            )}
            contas={gerenciadores}
            aoSoltar={(id) => void atribuir(id, null)}
          />
          <Bloco
            titulo="Perfis do Instagram"
            vazio={porQueVazio(
              contas,
              clienteNome,
              'instagram_account',
              'perfil',
              'perfis',
              'Sem um ligado, este cliente não aparece no painel do perfil.',
            )}
            contas={perfis}
            aoSoltar={(id) => void atribuir(id, null)}
          />

          {oferecidas.length === escolhidas.length && (
            <p className="px-3 pb-3 pt-2 text-[0.72rem] text-mute">
              Não há conta livre para ligar.{' '}
              {deOutros > 0 && `${deOutros} já pertencem a outros clientes. `}
              Importe da Meta na{' '}
              <Link to="/meta" className="underline">
                área Meta
              </Link>
              , ou solte a conta do cliente onde ela está.
            </p>
          )}
        </>
      )}
    </div>
  );
}
