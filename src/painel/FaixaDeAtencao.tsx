/**
 * A FAIXA "PRECISA DE ATENÇÃO" — F43, Fase 2.
 *
 * O PEDIDO
 *   "Tem gente do planejamento que esquece de atender o cliente porque não
 *   viu" (Wesley, 08/10/2026). A faixa é o primeiro bloco da tela: quem está
 *   atrás nesta semana (ou no mês, fora do mês atual), com o motivo escrito
 *   numa frase e UMA ação. O cliente esquecido aparece aqui sem ninguém ter de
 *   procurá-lo.
 *
 * APRESENTAÇÃO PURA
 *   Recebe as linhas prontas (`planejarMes`) e o hoje, e não busca nada: o
 *   teste desenha com `renderToStaticMarkup`, onde nenhum efeito roda. Quem
 *   entra, em que ordem e com que frase é `listaDeAtencao` (Fase 1).
 *
 * NINGUÉM ATRASADO NÃO É UM CARTÃO
 *   É uma linha calma dentro da própria faixa. Um bloco vazio grande no alto
 *   da tela gritaria justamente quando está tudo bem.
 */

import { Link } from 'react-router-dom';

import { acaoDaAtencao, cabecalhoDaFaixa, tomDoMotivo } from '@/painel/contrato-na-tela';
import { type LinhaDoMes, listaDeAtencao } from '@/painel/planejamento-do-mes';
import '@/ui/planejamento.css';

const ID_DO_TITULO_DA_FAIXA = 'plc-faixa-titulo';

/** Quantos clientes a faixa mostra abertos; o resto fica a um clique. */
export const LIMITE_DA_FAIXA = 5;

/** Uma linha da faixa: o ponto, o cliente, o motivo e UMA ação. */
function linhaDaFaixa(l: LinhaDoMes, enderecoDoPainel: (id: string) => string) {
  const [principal, ...outros] = l.motivos;
  const acao = acaoDaAtencao(l);
  return (
    <li
      key={l.id}
      className="plc-alerta"
      data-cliente={l.id}
      data-motivo={principal.chave}
      data-tom={tomDoMotivo(principal.chave)}
    >
      {/* O ponto repete o tom; quem diz o motivo é a frase — a cor nunca é a
          única pista. */}
      <span className="plc-ponto" aria-hidden="true" />
      <span className="plc-alerta-nome">{l.name}</span>
      <span className="plc-alerta-motivo">
        {principal.texto}
        {outros.length > 0 && <span className="plc-alerta-mais"> {outros.map((m) => m.texto).join(' ')}</span>}
      </span>
      {/* A AÇÃO ABRE O PAINEL DO CLIENTE AO LADO — Fase 3. Abrir o mês,
          planejar e ver as peças moram todos lá, no mês que está na tela, e a
          faixa continua visível atrás. O verbo continua sendo o do motivo: é
          ele que diz por onde começar no painel. Link de verdade (`?cliente=`),
          com `replace` — ver `VisaoDoContrato`. */}
      <Link
        to={enderecoDoPainel(l.id)}
        replace
        className="o-btn o-btn-vidro o-btn-sm plc-alerta-acao"
        aria-label={acao.nome}
        aria-haspopup="dialog"
      >
        {acao.rotulo}
      </Link>
    </li>
  );
}

export function FaixaDeAtencao({
  linhas,
  mes,
  hoje,
  enderecoDoPainel,
}: {
  /** A carteira inteira do mês — a faixa escolhe quem entra. */
  linhas: readonly LinhaDoMes[];
  /** `YYYY-MM`. */
  mes: string;
  /** `YYYY-MM-DD`, no fuso da agência. */
  hoje: string;
  /** O `href` que abre o painel do cliente (`enderecoDoPainel` de `visoes-do-planejamento`). */
  enderecoDoPainel: (id: string) => string;
}) {
  const lista = listaDeAtencao(linhas);
  const cabecalho = cabecalhoDaFaixa(mes, hoje, lista.length);
  // Com um a mais que o limite, mostrar todos: "Ver mais 1 cliente" custa a
  // mesma linha que o próprio cliente.
  const corte = lista.length > LIMITE_DA_FAIXA + 1 ? LIMITE_DA_FAIXA : lista.length;
  const primeiros = lista.slice(0, corte);
  const resto = lista.slice(corte);

  return (
    <section className="plc-faixa" aria-labelledby={ID_DO_TITULO_DA_FAIXA} data-bloco="atencao">
      <header className="plc-faixa-cabeca">
        <h2 id={ID_DO_TITULO_DA_FAIXA} className="plc-faixa-titulo">
          {cabecalho.titulo}
        </h2>
        {lista.length > 0 && <span className="plc-faixa-detalhe">{cabecalho.detalhe}</span>}
      </header>

      {lista.length === 0 ? (
        <p className="plc-faixa-calma">{cabecalho.vazio}</p>
      ) : (
        <>
          <ul className="plc-faixa-lista">{primeiros.map((l) => linhaDaFaixa(l, enderecoDoPainel))}</ul>
          {/* O RESTO RECOLHIDO, E NÃO ESCONDIDO. Num mês ruim a faixa teria a
              carteira inteira e empurraria a tabela para fora da tela — e uma
              faixa de trinta linhas deixa de dizer "olhe aqui". A ordem é a do
              peso, então os primeiros são os mais graves; o número total está
              no cabeçalho e o resto abre num clique (`<details>`: funciona
              sem script e com teclado). */}
          {resto.length > 0 && (
            <details className="plc-faixa-resto">
              <summary>
                <span className="plc-faixa-mais">Ver mais {resto.length} clientes</span>
                <span className="plc-faixa-menos">Mostrar só os {primeiros.length} primeiros</span>
              </summary>
              <ul className="plc-faixa-lista">{resto.map((l) => linhaDaFaixa(l, enderecoDoPainel))}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
