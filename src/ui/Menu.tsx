/**
 * Menu de escolha única — etapa F10h.
 *
 * POR QUE ELE EXISTE
 *   A tela de ranking mostrava os gerenciadores como pílulas: dezoito delas,
 *   quebrando em cinco linhas, ocupando meia tela antes de qualquer número
 *   aparecer. E são dezoito hoje — a carteira tem 91 clientes.
 *
 *   Pílula serve para escolha de três ou quatro opções, onde ver todas de
 *   relance É a vantagem. Passando disso ela vira parede, e a parede empurra o
 *   conteúdo para fora da tela.
 *
 * A BUSCA APARECE SOZINHA, QUANDO PRECISA
 *   Abaixo de oito opções, o campo de busca é ruído: a pessoa lê a lista mais
 *   rápido do que digita. Acima disso ele passa a ser o caminho mais curto.
 *   Quem decide é a quantidade, não quem chama.
 *
 * O QUE ELE NÃO FAZ
 *   Não é `<select>` nativo, porque precisa de contagem por opção e de busca.
 *   Não é combobox com autocomplete livre: a escolha é sempre de uma lista
 *   fechada — digitar algo que não existe não pode virar filtro nenhum.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { IconeBusca } from '@/ui/Icones';
import { usePendura } from '@/ui/teto';

export type Opcao = {
  valor: string | null;
  rotulo: string;
  /** Aparece à direita, discreta. Útil para "quantos há de cada". */
  contagem?: number;
};

/** A partir de quantas opções o campo de busca deixa de ser ruído. */
export const OPCOES_ATE_BUSCA = 8;

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function Menu({
  rotulo,
  opcoes,
  valor,
  aoEscolher,
  larguraDoBalao = 'w-72',
}: {
  rotulo: string;
  opcoes: Opcao[];
  valor: string | null;
  aoEscolher: (v: string | null) => void;
  larguraDoBalao?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const caixa = useRef<HTMLDivElement>(null);

  /* O TETO DA LISTA VEM DA JANELA — F17.35.
     Ela tinha `max-h-64`: dezesseis rem, teto de FONTE. Numa tela baixa o menu
     passava da borda; numa alta sobrava meia tela sem uso. Agora o teto é o
     espaço que existe entre este botão e a borda. Ver `@/ui/teto`. */
  const gatilho = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const pendura = usePendura(gatilho, balao, lista, aberto);

  /* O FOCO VOLTA AO GATILHO — acessibilidade, WCAG 2.4.3. Escolher uma opção
     ou apertar `Esc` desmonta o botão que tinha o foco, e o foco caía no
     `<body>`: o `Tab` seguinte recomeçava do alto da página. Fechar por clique
     fora não devolve nada — quem clicou fora escolheu outro lugar. */
  const fechar = (devolverFoco: boolean) => {
    setAberto(false);
    if (devolverFoco) gatilho.current?.focus();
  };

  // Fecha ao clicar fora e no Esc. Sem isso, um menu aberto atrás de outro
  // deixa a tela com dois balões e nenhuma pista de qual manda.
  useEffect(() => {
    if (!aberto) return;
    const foraDaCaixa = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const noEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false);
        gatilho.current?.focus();
      }
    };
    document.addEventListener('mousedown', foraDaCaixa);
    document.addEventListener('keydown', noEsc);
    return () => {
      document.removeEventListener('mousedown', foraDaCaixa);
      document.removeEventListener('keydown', noEsc);
    };
  }, [aberto]);

  // A busca não sobrevive ao fechamento: reabrir com o filtro de antes esconde
  // opções sem que nada na tela explique por quê.
  useEffect(() => {
    if (!aberto) setBusca('');
  }, [aberto]);

  const temBusca = opcoes.length > OPCOES_ATE_BUSCA;

  const visiveis = useMemo(() => {
    const alvo = semAcento(busca.trim());
    return alvo === '' ? opcoes : opcoes.filter((o) => semAcento(o.rotulo).includes(alvo));
  }, [opcoes, busca]);

  const escolhida = opcoes.find((o) => o.valor === valor) ?? opcoes[0];

  return (
    <div className="relative" ref={caixa}>
      <button
        ref={gatilho}
        type="button"
        className="o-btn o-btn-vidro o-btn-sm max-w-full"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="eyebrow">{rotulo}</span>
        <span className="truncate" style={{ color: 'var(--plat)' }}>
          {escolhida?.rotulo ?? '—'}
        </span>
        {escolhida?.contagem !== undefined && (
          <span className="tnum o-mono text-[0.70rem]">{escolhida.contagem}</span>
        )}
        <span className="o-mono text-[0.70rem]" aria-hidden>
          {aberto ? '▴' : '▾'}
        </span>
      </button>

      {aberto && (
        /*
          O balão sobe na escada de superfícies, como o do seletor de período:
          em `--ink-0` ele fica indistinguível do fundo da página, com borda
          quase invisível e sombra preta sobre preto.
        */
        <div
          ref={balao}
          className={`absolute left-0 z-50 ${pendura?.paraCima === true ? 'bottom-full mb-2' : 'mt-2'} ${larguraDoBalao} rounded-xl border p-2`}
          style={{
            background: 'var(--ink-2)',
            borderColor: 'var(--hair-3)',
            boxShadow: 'var(--e-3)',
          }}
        >
          {temBusca && (
            <label className="relative mb-2 block">
              <IconeBusca className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute" />
              <input
                className="o-campo o-campo-sm pl-8"
                placeholder={`Buscar ${rotulo.toLowerCase()}`}
                value={busca}
                autoFocus
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
          )}

          {/* `o-rolagem-fina`: a barra do sistema tem 10px e moldura, e dentro
              de um balão estreito ela come a largura do texto. Ver `acabamento`. */}
          <div
            ref={lista}
            className="o-rolagem-fina overflow-y-auto"
            style={{ maxHeight: pendura === null ? 'calc(100vh - 10rem)' : pendura.teto }}
          >
            {/* O `listbox` é SÓ a lista de opções, com nome. Antes ele era o
                balão inteiro — e a busca, que não é opção, ficava dentro dele
                (ARIA: `listbox` só aceita `option`), sem nome nenhum. */}
            <div role="listbox" aria-label={rotulo}>
            {visiveis.map((o) => {
              const ativa = o.valor === valor;
              return (
                <button
                  key={o.valor ?? '(todos)'}
                  type="button"
                  role="option"
                  aria-selected={ativa}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[0.80rem]"
                  style={{
                    color: ativa ? 'var(--luz)' : 'var(--plat-dim)',
                    background: ativa ? 'var(--luz-soft)' : 'transparent',
                  }}
                  onClick={() => {
                    aoEscolher(o.valor);
                    fechar(true);
                  }}
                >
                  <span className="flex-1 truncate">{o.rotulo}</span>
                  {o.contagem !== undefined && (
                    <span className="tnum o-mono text-[0.70rem] text-mute">{o.contagem}</span>
                  )}
                </button>
              );
            })}
            </div>

            {visiveis.length === 0 && (
              <p className="px-2 py-3 text-center text-[0.75rem] text-mute" role="status">
                Nada com “{busca}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
