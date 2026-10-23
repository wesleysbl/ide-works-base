/**
 * Controle da semana — F40, Fase 7.
 *
 * O QUE ESTA TELA RESPONDE, PARA QUEM ADMINISTRA
 *   "O que eu preciso atribuir, como a produção anda e o que está faltando
 *   nesta semana?" — num lugar só, sem sair dali. O admin escolhe pessoa e prazo
 *   dos cards que o captador deixou em "atribuir demanda", aperta OK, e o card
 *   cai na fila do tipo certo; o Andamento soma e a Falta diminui.
 *
 * SÓ ADMIN, DOS DOIS LADOS
 *   O item da barra só aparece para `admin` e `super_admin` (`ITENS_SO_ADMIN`),
 *   e a rota direta de quem não administra mostra "sem acesso" em vez de uma
 *   tela vazia — o `403` do servidor diz o mesmo. A tela não confia em si: quem
 *   protege é a API.
 *
 * A SEMANA MORA NO ENDEREÇO (`?semana=AAAA-MM-DD`)
 *   Para o aviso do sino (Fase 8) apontar para a semana certa e para o link
 *   colado numa conversa abrir onde a pessoa estava. Sem o parâmetro, é a de hoje.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { TelaComBarra } from '@/board/TelaComBarra';
import { useEquipe } from '@/board/equipe-compartilhada';
import { BlocoParaAtribuir, FaixaDeNumeros, GrupoDoClienteBloco, type AoLiberar } from '@/painel/BlocosDoControle';
import {
  type ControleDaSemana,
  type PreferenciaDeAbertos,
  agruparPorCliente,
  clientesParaAtribuir,
  chaveDaPreferencia,
  cofreDoNavegador,
  destinoDoCliente,
  estaAberto,
  fraseDaFalha,
  gravarPreferencia,
  lerPreferencia,
  marcarTodos,
  rotuloDaSemana,
  semanaDoEndereco,
  totaisDaFaixa,
} from '@/painel/controle-da-semana';
import { ApiError, api, semSessao } from '@/lib/api';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { IconeDireita, IconeEsquerda } from '@/ui/Icones';
import { PaginaLarga } from '@/ui/primitivos';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { ehAdmin, useSessao } from '@/ui/sessao';
import { Topo } from '@/ui/Topo';

type Falha = { mensagem: string; semAcesso: boolean };

export default function ControleDaSemanaPagina() {
  const { sessao, carregando: lendoASessao } = useSessao();
  const souAdmin = ehAdmin(sessao);
  const [params, setParams] = useSearchParams();
  const semana = semanaDoEndereco(params.get('semana'));
  const navegar = useNavigate();
  const { pessoas } = useEquipe();

  /* O que a pessoa abriu e recolheu fica no navegador (por pessoa, quando a
     sessão tem id). Só a ESCOLHA é guardada; o resto segue o padrão do estado. */
  const chavePref = chaveDaPreferencia(sessao?.userId);
  const [pref, setPref] = useState<PreferenciaDeAbertos>(() => lerPreferencia(cofreDoNavegador(), chavePref));
  useEffect(() => {
    setPref(lerPreferencia(cofreDoNavegador(), chavePref));
  }, [chavePref]);
  const mudarPref = (proxima: PreferenciaDeAbertos) => {
    setPref(proxima);
    gravarPreferencia(cofreDoNavegador(), chavePref, proxima);
  };

  const [atribuirAberto, setAtribuirAberto] = useState(false);
  const [atribuirClientes, setAtribuirClientes] = useState<ReadonlySet<string>>(() => new Set());
  const [dados, setDados] = useState<ControleDaSemana | null>(null);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [carregando, setCarregando] = useState(true);
  /* O pedido mais novo ganha: trocar de semana depressa não pode deixar a
     resposta da anterior pintar por cima — os números seriam de outra semana. */
  const pedido = useRef(0);

  const carregar = useCallback(
    async (silencioso = false) => {
      const meu = ++pedido.current;
      if (!silencioso) {
        setCarregando(true);
        setFalha(null);
      }
      try {
        const r = await api.controleDaSemana(semana);
        if (meu !== pedido.current) return;
        setDados(r);
        setFalha(null);
      } catch (e) {
        if (meu !== pedido.current) return;
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        const semAcesso = e instanceof ApiError && e.status === 403;
        setFalha({
          mensagem: fraseDaFalha(e instanceof ApiError ? e.message : null, 'Não foi possível carregar o controle da semana.'),
          semAcesso,
        });
      } finally {
        if (meu === pedido.current) setCarregando(false);
      }
    },
    [semana],
  );

  useEffect(() => {
    if (lendoASessao || !souAdmin) return;
    setDados(null);
    void carregar();
  }, [carregar, lendoASessao, souAdmin]);

  const irParaSemana = (dia: string | null) => {
    const proximo = new URLSearchParams(params);
    if (dia === null) proximo.delete('semana');
    else proximo.set('semana', dia);
    setParams(proximo, { replace: true });
  };

  async function abrirCliente(clientId: string) {
    try {
      const r = await api.listasDoQuadroDoCliente(clientId);
      navegar(destinoDoCliente(clientId, r.lists));
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      navegar(destinoDoCliente(clientId, []));
    }
  }

  const liberar: AoLiberar = async (card, tipoDoGrupo, escolha) => {
    try {
      // O card sem tipo recebe o tipo escolhido AQUI antes de ser liberado.
      if (tipoDoGrupo === null) await api.salvarTarefaDoQuadro(card.id, { type: escolha.tipo });
      await api.liberarDemanda({ taskId: card.id, assigneeIds: [escolha.pessoaId], dueOn: escolha.prazo });
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return null;
      }
      return fraseDaFalha(e instanceof ApiError ? e.message : null, 'Não foi possível liberar a demanda. Tente de novo.');
    }
    // A linha sai e o andamento soma: relê a semana, sem piscar a tela.
    await carregar(true);
    return null;
  };

  const grupos = useMemo(() => (dados ? agruparPorCliente(dados) : []), [dados]);
  const paraAtribuir = useMemo(() => clientesParaAtribuir(grupos), [grupos]);
  const totais = useMemo(() => (dados ? totaisDaFaixa(dados) : null), [dados]);
  const alternar = (clientId: string) => {
    const g = grupos.find((x) => x.clientId === clientId);
    if (g) mudarPref({ ...pref, [clientId]: !estaAberto(g, pref) });
  };

  const semana_ = dados?.week;
  const semAcesso = !lendoASessao && (!souAdmin || falha?.semAcesso === true);

  return (
    <PaginaLarga>
      <TelaComBarra atual="controle">
        <Topo
          titulo={ROTULO_DO_ITEM.controle}
          acoes={
            souAdmin ? (
              <div className="o-card cs-semana px-1 py-1">
                <button
                  type="button"
                  className="o-btn o-btn-fantasma o-btn-icone"
                  onClick={() => semana_ && irParaSemana(semana_.previous)}
                  disabled={!semana_}
                  title="Semana anterior"
                  aria-label="Semana anterior"
                >
                  <IconeEsquerda />
                </button>
                <span className="cs-semana-nome tnum" aria-live="polite" data-semana={semana_?.start}>
                  {semana_ ? rotuloDaSemana(semana_.start, semana_.end) : '—'}
                </span>
                <button
                  type="button"
                  className="o-btn o-btn-fantasma o-btn-icone"
                  onClick={() => semana_ && irParaSemana(semana_.next)}
                  disabled={!semana_}
                  title="Próxima semana"
                  aria-label="Próxima semana"
                >
                  <IconeDireita />
                </button>
                <button
                  type="button"
                  className="o-btn o-btn-vidro o-btn-sm"
                  onClick={() => irParaSemana(null)}
                  disabled={semana_?.isCurrent === true}
                >
                  Esta semana
                </button>
              </div>
            ) : undefined
          }
        />

        {lendoASessao && <EstadoDaPagina tipo="carregando" titulo="Carregando…" />}

        {!lendoASessao && semAcesso && (
          <EstadoDaPagina tipo="sem-acesso" titulo="O controle da semana é só para administradores">
            Peça a quem administra o sistema se precisar ver ou liberar demandas.
          </EstadoDaPagina>
        )}

        {!lendoASessao && !semAcesso && falha && (
          <EstadoDaPagina tipo="erro" titulo={falha.mensagem} acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }} />
        )}

        {!lendoASessao && !semAcesso && !falha && carregando && !dados && (
          <EstadoDaPagina tipo="carregando" titulo="Lendo a semana…" linhas={4} />
        )}

        {!lendoASessao && !semAcesso && dados && totais && (
          <>
            <FaixaDeNumeros totais={totais} />

            <BlocoParaAtribuir
              clientes={paraAtribuir}
              pessoas={pessoas}
              aoLiberar={liberar}
              aberto={atribuirAberto}
              aoAlternar={() => setAtribuirAberto((v) => !v)}
              clientesAbertos={atribuirClientes}
              aoAlternarCliente={(id) =>
                setAtribuirClientes((antes) => {
                  const depois = new Set(antes);
                  if (!depois.delete(id)) depois.add(id);
                  return depois;
                })
              }
            />

            <section className="cs-bloco" aria-labelledby="cs-t-clientes" data-bloco="clientes">
              <div className="cs-bloco-cabeca">
                <h2 id="cs-t-clientes" className="cs-bloco-titulo">
                  Clientes
                  <span className="cs-bloco-contagem tnum">{grupos.length}</span>
                </h2>
                {grupos.length > 0 && (
                  <div className="cs-bloco-acoes">
                    <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={() => mudarPref(marcarTodos(grupos, true, pref))}>
                      Expandir tudo
                    </button>
                    <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={() => mudarPref(marcarTodos(grupos, false, pref))}>
                      Recolher tudo
                    </button>
                  </div>
                )}
              </div>

              {grupos.length === 0 ? (
                <p className="cs-vazio" data-vazio="clientes">
                  Nenhum cliente com produção nesta semana
                </p>
              ) : (
                <div className="cs-clientes">
                  {grupos.map((g) => (
                    <GrupoDoClienteBloco
                      key={g.clientId}
                      grupo={g}
                      aberto={estaAberto(g, pref)}
                      aoAlternar={alternar}
                      aoAbrirCliente={(id) => void abrirCliente(id)}
                    />
                  ))}
                </div>
              )}
              {dados.missing.overdueTotal > dados.missing.overdue.length && (
                <p className="cs-vazio">
                  Mostrando {dados.missing.overdue.length} dos {dados.missing.overdueTotal} atrasados.
                </p>
              )}
            </section>
          </>
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}
