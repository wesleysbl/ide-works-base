/**
 * A VISÃO CONTRATO DO PLANEJAMENTO — F43, Fase 2.
 *
 * O QUE ELA RESPONDE
 *   "O que cada cliente tem de contrato, e está acontecendo?" — o pedido mais
 *   importante do Wesley. A carteira inteira, por responsável (todo mundo vê
 *   tudo, decisão de 08/10), uma linha por cliente: o mês do cliente (aberto,
 *   planejado, aprovado), uma barra por tipo de conteúdo (entregue · marcada ·
 *   sem dia) e, no mês de hoje, como anda esta semana.
 *
 * POR RESPONSÁVEL, E O CLIENTE DE DOIS APARECE NOS DOIS
 *   A regra da F35 (`agruparMesPorResponsavel`, sem cópia): cada líder lê o
 *   próprio grupo inteiro. "Sem responsável" vai no fim.
 *
 * SÓ AS COLUNAS QUE EXISTEM NO MÊS
 *   Uma coluna por tipo que alguém com contrato tem no mês (`tiposDoMes`):
 *   sem cliente com ads, sem coluna de ads. A coluna "Esta semana" só existe
 *   no mês de hoje — em setembro, "esta semana" não é de setembro.
 *
 * O RESUMO POR ETAPA E O "SÓ O QUE FALTA" — Fase 4
 *   As duas funções da antiga aba Mês que a Fase 2 levou junto sem querer:
 *   quantos clientes em cada etapa do mês e o botão que deixa só quem ainda
 *   não está aprovado. Moram na linha do filtro, acima da tabela, discretas:
 *   texto e número, sem caixa e sem cor (ver `resumoPorEtapa`).
 *
 * APRESENTAÇÃO PURA
 *   Nenhum efeito, nenhuma busca: as linhas chegam prontas (`planejarMes`) e
 *   os dois filtros chegam de fora. O teste desenha com `renderToStaticMarkup`.
 *
 * SEM MOLDURA POR LINHA
 *   O idioma calmo da F43: um fio entre as linhas e espaço entre os grupos.
 *   Nenhum `o-card` aqui dentro — vinte caixas empilhadas eram o "parece
 *   bagunçado" das críticas.
 */

import { Link } from 'react-router-dom';

import type { ContentType } from '@/delivery/level';
import {
  contagemDoGrupo,
  descricaoDaBarra,
  estaSemanaDoCliente,
  filtrarPorNome,
  legendaDoTipo,
  mesDoClienteNaTela,
  partesDaBarra,
  resumoPorEtapa,
  soOQueFalta,
  tiposDoMes,
} from '@/painel/contrato-na-tela';
import { type ContratoDoTipo, type LinhaDoMes, agruparMesPorResponsavel } from '@/painel/planejamento-do-mes';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { TIPO_ROTULO, nomeDoMes } from '@/ui/grade-do-mes';
import { CampoDeBusca } from '@/ui/primitivos';
import '@/ui/planejamento.css';

const rotuloDoTipo = (tipo: ContentType) => TIPO_ROTULO[tipo] ?? tipo;

/**
 * A barra de três partes e a frase embaixo dela — a MESMA na tabela e no
 * painel do cliente (Fase 3): o olho aprende uma barra só.
 */
export function BarraDoTipo({ tipo, contrato }: { tipo: ContentType; contrato: ContratoDoTipo }) {
  const legenda = legendaDoTipo(contrato);
  if (legenda.feito === null) {
    // Tipo sem contrato que aparece porque tem peça: só extra, sem barra.
    return <span className="plc-leg">{legenda.resto}</span>;
  }
  const partes = partesDaBarra(contrato);
  return (
    <>
      <span className="plc-barra" role="img" aria-label={descricaoDaBarra(rotuloDoTipo(tipo), contrato)}>
        {partes.entregue > 0 && <span data-parte="entregue" style={{ flexGrow: partes.entregue }} />}
        {partes.marcada > 0 && <span data-parte="marcada" style={{ flexGrow: partes.marcada }} />}
        {partes.semDia > 0 && <span data-parte="sem-dia" style={{ flexGrow: partes.semDia }} />}
      </span>
      <span className="plc-leg">
        <b className="tnum">{legenda.feito.entregues}</b> de {legenda.feito.contrato} ·{' '}
        <span data-tom={legenda.tom === 'neutro' ? undefined : legenda.tom}>{legenda.resto}</span>
        {legenda.extra && <> · {legenda.extra}</>}
      </span>
    </>
  );
}

function CelulaDoTipo({ tipo, contrato }: { tipo: ContentType; contrato: ContratoDoTipo | undefined }) {
  return (
    <td className="plc-tipo" data-tipo={tipo}>
      {contrato ? (
        <BarraDoTipo tipo={tipo} contrato={contrato} />
      ) : (
        <span className="plc-nada" title={`Sem ${rotuloDoTipo(tipo).toLowerCase()} no contrato deste mês`}>
          —
        </span>
      )}
    </td>
  );
}

function LinhaDoCliente({
  linha,
  tipos,
  comSemana,
  enderecoDoPainel,
}: {
  linha: LinhaDoMes;
  tipos: readonly ContentType[];
  comSemana: boolean;
  enderecoDoPainel: (id: string) => string;
}) {
  const etapas = mesDoClienteNaTela(linha);
  const semana = comSemana ? estaSemanaDoCliente(linha) : null;
  const doTipo = new Map(linha.tipos.map((t) => [t.tipo, t]));
  const colunasDeTipo = Math.max(1, tipos.length);

  return (
    <tr className="plc-linha" data-cliente={linha.id} data-leitura={linha.leitura}>
      <th scope="row" className="plc-quem">
        {/* O NOME ABRE O PAINEL DO CLIENTE AO LADO — Fase 3. Um link de
            verdade (`?cliente=`): o clique do meio abre o mesmo painel numa
            aba nova; o clique comum troca só a consulta, com `replace`, e a
            tabela fica onde estava, atrás do painel. */}
        <Link to={enderecoDoPainel(linha.id)} replace className="plc-nome" aria-haspopup="dialog">
          {linha.name}
        </Link>
      </th>
      <td className="plc-estagio">
        <span
          className="plc-etapas"
          title={etapas.titulo}
          data-estagio={linha.estagio}
          data-atencao={etapas.pontos.includes('atencao') || undefined}
        >
          <span className="plc-etapas-pontos" aria-hidden="true">
            {etapas.pontos.map((p, i) => (
              <i key={i} data-ponto={p} />
            ))}
          </span>
          <span className="plc-etapas-nome">{etapas.rotulo}</span>
        </span>
      </td>
      {linha.leitura === 'so-ritual' ? (
        // Chegou só na leitura do ritual: sem as peças não há o que medir —
        // e dizer "sem contrato" seria afirmar o que não se leu.
        <td className="plc-sem-contrato" colSpan={colunasDeTipo}>
          peças não carregadas
        </td>
      ) : !linha.temContrato ? (
        <td className="plc-sem-contrato" colSpan={colunasDeTipo}>
          sem contrato
        </td>
      ) : tipos.length === 0 ? (
        <td className="plc-nada">—</td>
      ) : (
        tipos.map((t) => <CelulaDoTipo key={t} tipo={t} contrato={doTipo.get(t)} />)
      )}
      {comSemana && (
        <td className="plc-semana">
          {semana ? (
            <span data-tom={semana.tom === 'neutro' ? undefined : semana.tom} title={semana.titulo}>
              {semana.texto}
            </span>
          ) : (
            <span className="plc-nada">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

export function VisaoDoContrato({
  linhas,
  mes,
  hoje,
  filtro,
  aoFiltrar,
  soFalta = false,
  aoMudarSoFalta = () => {},
  enderecoDoPainel,
}: {
  /** A carteira inteira do mês, de `planejarMes`. */
  linhas: readonly LinhaDoMes[];
  /** `YYYY-MM`. */
  mes: string;
  /** `YYYY-MM-DD`, no fuso da agência. */
  hoje: string;
  /** O texto do "Filtrar cliente" — quem guarda é a página. */
  filtro: string;
  aoFiltrar: (texto: string) => void;
  /** O "Só o que falta" ligado — quem guarda é a página, como o filtro. */
  soFalta?: boolean;
  aoMudarSoFalta?: (ligado: boolean) => void;
  /** O `href` que abre o painel do cliente (`enderecoDoPainel` de `visoes-do-planejamento`). */
  enderecoDoPainel: (id: string) => string;
}) {
  // As colunas saem do mês inteiro, e não do filtrado: digitar no filtro não
  // faz coluna aparecer e sumir debaixo do dedo.
  const tipos = tiposDoMes(linhas);
  const comSemana = mes.slice(0, 7) === hoje.slice(0, 7);
  const porNome = filtrarPorNome(linhas, filtro);
  const visiveis = soOQueFalta(porNome, soFalta);
  const grupos = agruparMesPorResponsavel(visiveis);
  const colunas = 2 + Math.max(1, tipos.length) + (comSemana ? 1 : 0);
  // O resumo conta o que a tabela mostra (ver `resumoPorEtapa`).
  const etapas = resumoPorEtapa(visiveis);
  const texto = filtro.trim();

  return (
    <div className="plc" data-visao="contrato">
      <div className="plc-ferramentas">
        <CampoDeBusca rotulo="Filtrar cliente" valor={filtro} aoMudar={aoFiltrar} />
        {/* O botão da antiga aba Mês, com o nome e o `aria-pressed` de antes. */}
        <button
          type="button"
          aria-pressed={soFalta}
          onClick={() => aoMudarSoFalta(!soFalta)}
          className="o-btn o-btn-vidro o-btn-sm plc-so-falta"
        >
          Só o que falta
        </button>
        <ul className="plc-resumo" aria-label={`Clientes por etapa do mês de ${nomeDoMes(mes.slice(0, 7))}`}>
          {etapas.map((e) => (
            <li key={e.chave} data-estagio={e.chave}>
              {e.rotulo} <b className="tnum">{e.quantos}</b>
            </li>
          ))}
        </ul>
        <ul className="plc-legenda" aria-label="Legenda das barras">
          <li>
            <i data-parte="entregue" aria-hidden="true" />
            entregue
          </li>
          <li>
            <i data-parte="marcada" aria-hidden="true" />
            marcada
          </li>
          <li>
            <i data-parte="sem-dia" aria-hidden="true" />
            sem dia
          </li>
        </ul>
      </div>

      {porNome.length === 0 ? (
        <EstadoDaPagina
          tipo="sem-resultado"
          titulo={`Nenhum cliente com “${texto}”.`}
          acao={{ rotulo: 'Limpar filtro', aoClicar: () => aoFiltrar('') }}
        />
      ) : visiveis.length === 0 ? (
        // Achou pelo nome, mas todos já estão aprovados: não é "nenhum
        // cliente" — é nada pendente, e a saída é ver todos de novo.
        <EstadoDaPagina
          tipo="sem-resultado"
          titulo={texto === '' ? 'Nada falta fechar neste mês.' : `Nada falta fechar com “${texto}”.`}
          acao={{ rotulo: 'Mostrar todos', aoClicar: () => aoMudarSoFalta(false) }}
        >
          Todos os clientes desta lista estão com o mês aprovado.
        </EstadoDaPagina>
      ) : (
        <div className="plc-rolagem" data-plc-rolagem="">
          <table className="plc-tabela" aria-label={`Contrato de ${nomeDoMes(mes.slice(0, 7))}`}>
            <thead>
              <tr>
                <th scope="col" className="plc-quem">
                  Cliente
                </th>
                <th scope="col">Mês do cliente</th>
                {tipos.length === 0 ? (
                  <th scope="col">Contrato</th>
                ) : (
                  tipos.map((t) => (
                    <th key={t} scope="col" className="plc-tipo" data-tipo={t}>
                      {rotuloDoTipo(t)}
                    </th>
                  ))
                )}
                {comSemana && (
                  <th scope="col" className="plc-semana">
                    Esta semana
                  </th>
                )}
              </tr>
            </thead>
            {grupos.map((g) => (
              <tbody key={g.id ?? 'sem-responsavel'} className="plc-grupo" data-grupo={g.id ?? 'sem-responsavel'}>
                <tr className="plc-grupo-cabeca">
                  <th scope="rowgroup" colSpan={colunas}>
                    {/* O nome preso à esquerda, como a coluna dos clientes:
                        no celular o grupo não some ao rolar de lado. */}
                    <span className="plc-grupo-titulo">
                      <span className="plc-grupo-nome">{g.nome}</span> · {contagemDoGrupo(g.linhas.length)}
                    </span>
                  </th>
                </tr>
                {g.linhas.map((l) => (
                  <LinhaDoCliente
                    key={l.id}
                    linha={l}
                    tipos={tipos}
                    comSemana={comSemana}
                    enderecoDoPainel={enderecoDoPainel}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
