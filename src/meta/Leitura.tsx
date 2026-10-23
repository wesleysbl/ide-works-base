/**
 * As peças de leitura da área Meta — F14 do plano UX.
 *
 * Três telas (Meta, relatório, ranking) diziam o mesmo tipo de coisa de três
 * jeitos: o período ora no botão, ora num cartão chamado "Gerenciador"; o
 * cliente ora etiqueta, ora texto; o travessão ora cinza, ora na cor do
 * número. Estas peças escrevem uma vez:
 *
 *   FaixaDeContexto  de QUEM é o número e de QUANDO — cliente, conta,
 *                    gerenciador, empresa, período, régua da comparação,
 *                    coleta. Fica logo abaixo do título e não rola para longe
 *                    do dado que ela qualifica.
 *   GrupoDeMetricas  números agrupados pelo que significam ("Investimento e
 *                    entrega", "Resposta"), com um título de verdade (h2).
 *   Numero           o cartão de um número. `role="group"` com o rótulo como
 *                    nome, e o travessão dito como "sem dado" — nunca pintado
 *                    como se fosse um valor.
 *   ChaveDeLeitura   a legenda dos três sinais que a área usa: —, 0 e "sem
 *                    coleta". Uma vez por tela, perto dos números.
 */

import { type ReactNode, useId } from 'react';

import { TRACO } from '@/meta/formato';
import type { Tom } from '@/ui/primitivos';

export type ItemDeContexto = {
  rotulo: string;
  valor: ReactNode;
  /** Chave estável quando o rótulo se repete. */
  chave?: string;
};

export function FaixaDeContexto({ itens, rotulo = 'Contexto destes números' }: { itens: readonly ItemDeContexto[]; rotulo?: string }) {
  return (
    <dl className="mm-contexto" aria-label={rotulo}>
      {itens.map((i) => (
        <div key={i.chave ?? i.rotulo} className="mm-contexto-item">
          <dt>{i.rotulo}</dt>
          <dd>{i.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GrupoDeMetricas({
  titulo,
  descricao,
  children,
  colunas = 4,
}: {
  titulo: string;
  descricao?: ReactNode;
  children: ReactNode;
  /** Quantas colunas o grupo pede na tela larga (o celular sempre empilha em 1–2). */
  colunas?: 2 | 3 | 4;
}) {
  const id = useId();
  return (
    <section className="mm-grupo" aria-labelledby={id}>
      <div className="mm-grupo-cabeca">
        <h2 id={id} className="mm-grupo-titulo">
          {titulo}
        </h2>
        {descricao && <p className="mm-grupo-descricao">{descricao}</p>}
      </div>
      <div className="mm-grupo-numeros" data-colunas={colunas}>
        {children}
      </div>
    </section>
  );
}

/** O travessão como dado: cinza, com o motivo no nome acessível e na dica. */
export function SemDado({ motivo = 'sem dado para calcular' }: { motivo?: string }) {
  return (
    <span className="mm-nulo" title={motivo}>
      <span aria-hidden>{TRACO}</span>
      <span className="sr-only">{motivo}</span>
    </span>
  );
}

const COR: Record<Tom, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  neutro: 'var(--plat)',
};

export function Numero({
  rotulo,
  valor,
  detalhe,
  tom,
  nulo,
  children,
}: {
  rotulo: string;
  /** O número já formatado. O texto `—` sozinho é lido como "sem dado". */
  valor: ReactNode;
  detalhe?: ReactNode;
  tom?: Tom;
  /** Para quando `valor` é composto (número + variação) e o número é `—`. */
  nulo?: boolean;
  children?: ReactNode;
}) {
  const semValor = nulo ?? valor === TRACO;
  return (
    <div className="o-card mm-numero" role="group" aria-label={rotulo} data-nulo={semValor || undefined}>
      <div className="eyebrow">{rotulo}</div>
      <div className="tnum mm-numero-valor" style={semValor ? undefined : { color: tom ? COR[tom] : 'var(--plat)' }}>
        {valor === TRACO ? <SemDado /> : valor}
      </div>
      {detalhe && <div className="mm-numero-detalhe">{detalhe}</div>}
      {children}
    </div>
  );
}

/**
 * A legenda dos sinais. Existe porque a regra "— não é zero" estava só nos
 * comentários do código: a pessoa via `0` numa coluna e `—` na outra e não
 * tinha como saber que eram afirmações diferentes.
 */
export function ChaveDeLeitura() {
  return (
    <p className="mm-chave">
      <span className="mm-chave-item">
        <span className="mm-chave-sinal mm-nulo" aria-hidden>
          {TRACO}
        </span>
        sem dado para calcular
      </span>
      <span className="mm-chave-item">
        <span className="mm-chave-sinal tnum" aria-hidden>
          0
        </span>
        medido, e deu zero
      </span>
      <span className="mm-chave-item">
        <span className="mm-chave-sinal mm-chave-palavra" aria-hidden>
          sem coleta
        </span>
        dia que a coleta não trouxe
      </span>
    </p>
  );
}
