/**
 * Gaveta de seleção múltipla — etapa F19b.
 *
 * POR QUE ELA EXISTE, E POR QUE O `Menu` NÃO SERVIA
 *   O cockpit mostrava os filtros como pílulas: três urgências, cinco planos e
 *   VINTE E CINCO etiquetas, tudo aberto. Trinta e três botões em três linhas,
 *   ocupando a tela inteira antes de qualquer cliente aparecer.
 *
 *   O `Menu` resolveu o mesmo problema no ranking, mas ele é de escolha ÚNICA —
 *   escolher um gerenciador exclui os outros. Aqui não: filtrar por "Clínica" e
 *   "Saúde" ao mesmo tempo é o uso normal. Uma gaveta que fechasse a cada
 *   clique obrigaria a reabrir uma vez por etiqueta.
 *
 * O QUE MUDA EM RELAÇÃO AO MENU
 *   - Fica ABERTA ao escolher. Selecionar três etiquetas é um gesto só.
 *   - O gatilho mostra a CONTAGEM, não o valor: "Etiqueta · 3" diz o que
 *     importa quando há três selecionadas e nenhum rótulo caberia.
 *   - Tem "limpar", porque desmarcar de um em um é o caminho longo.
 *
 * O QUE ELA HERDA DE PROPÓSITO
 *   A busca que aparece sozinha acima de oito opções, o fechamento por clique
 *   fora e Esc, e o balão que sobe na escada de superfícies. São as mesmas
 *   decisões do `Menu`, e divergir criaria dois comportamentos para o mesmo
 *   gesto.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { IconeBusca } from '@/ui/Icones';
import { OPCOES_ATE_BUSCA } from '@/ui/Menu';
import { usePendura } from '@/ui/teto';

export type ItemDaGaveta = {
  valor: string;
  rotulo: string;
  /** Aparece à direita, discreta. Útil para "quantos clientes há de cada". */
  contagem?: number;
};

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function Gaveta({
  rotulo,
  itens,
  escolhidos,
  aoAlternar,
  aoLimpar,
  larguraDoBalao = 'w-72',
}: {
  rotulo: string;
  itens: ItemDaGaveta[];
  /** `readonly` porque o estado de filtro e imutavel — ver `painel/carteira.ts`. */
  escolhidos: readonly string[];
  aoAlternar: (valor: string) => void;
  aoLimpar: () => void;
  larguraDoBalao?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const [busca, setBusca] = useState('');
  const caixa = useRef<HTMLDivElement>(null);

  /* O TETO DA LISTA VEM DA JANELA — F17.35, igual ao de `Menu`. O `max-h-64`
     que estava aqui era teto de FONTE, e não de tela. Ver `@/ui/teto`. */
  const gatilho = useRef<HTMLButtonElement>(null);
  const balao = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const pendura = usePendura(gatilho, balao, lista, aberta);

  useEffect(() => {
    if (!aberta) return;
    const foraDaCaixa = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberta(false);
    };
    const noEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberta(false);
        // O foco volta ao gatilho: o botão que tinha o foco some com o balão,
        // e o `Tab` seguinte recomeçaria do alto da página (WCAG 2.4.3).
        gatilho.current?.focus();
      }
    };
    document.addEventListener('mousedown', foraDaCaixa);
    document.addEventListener('keydown', noEsc);
    return () => {
      document.removeEventListener('mousedown', foraDaCaixa);
      document.removeEventListener('keydown', noEsc);
    };
  }, [aberta]);

  // A busca não sobrevive ao fechamento: reabrir com o filtro de antes esconde
  // opções sem que nada na tela explique por quê.
  useEffect(() => {
    if (!aberta) setBusca('');
  }, [aberta]);

  const temBusca = itens.length > OPCOES_ATE_BUSCA;

  const visiveis = useMemo(() => {
    const alvo = semAcento(busca.trim());
    return alvo === '' ? itens : itens.filter((i) => semAcento(i.rotulo).includes(alvo));
  }, [itens, busca]);

  const quantos = escolhidos.length;

  return (
    <div className="relative" ref={caixa}>
      <button
        ref={gatilho}
        type="button"
        className="o-btn o-btn-vidro o-btn-sm max-w-full"
        aria-haspopup="listbox"
        aria-expanded={aberta}
        // A borda acesa é o único aviso de que este filtro está agindo quando a
        // gaveta está fechada. Sem ela, uma lista filtrada parece uma lista
        // curta — e a pessoa procura o cliente que "sumiu".
        style={quantos > 0 ? { borderColor: 'var(--luz)', background: 'var(--luz-soft)' } : undefined}
        onClick={() => setAberta((v) => !v)}
      >
        <span className="eyebrow">{rotulo}</span>
        {quantos > 0 ? (
          <span className="tnum o-mono" style={{ color: 'var(--luz-texto)' }}>
            {quantos}
          </span>
        ) : (
          <span style={{ color: 'var(--mute)' }}>Todos</span>
        )}
        <span className="o-mono text-[0.70rem]" aria-hidden>
          {aberta ? '▴' : '▾'}
        </span>
      </button>

      {aberta && (
        <div
          ref={balao}
          className={`absolute left-0 z-50 ${pendura?.paraCima === true ? 'bottom-full mb-2' : 'mt-2'} ${larguraDoBalao} rounded-xl border p-2`}
          style={{
            background: 'var(--ink-2)',
            borderColor: 'var(--hair-3)',
            boxShadow: 'var(--e-3)',
          }}
        >
          {/*
            O `X` — F17.33.

            ⚠️ ELE EXISTE AQUI E NÃO NO `Menu`, e a diferença não é de gosto: o
            `Menu` FECHA ao escolher, então o gesto de escolher já é o gesto de
            sair. Esta gaveta fica aberta de propósito (ver o cabeçalho), e um
            painel que não fecha sozinho precisa de um jeito explícito de
            fechar. `Esc` e clique fora ela já tinha; o pedido do usuário foi
            *"as telas menores devem ter um X para sair delas"*.

            Sem rótulo ao lado: o nome do filtro já está escrito no gatilho, a
            dois centímetros daqui, e repeti-lo seria a tela falando de si mesma.
          */}
          <div className="mb-1 flex justify-end">
            <button
              type="button"
              aria-label="Fechar"
              className="rounded p-1 leading-none"
              style={{ color: 'var(--mute)' }}
              onClick={() => {
                setAberta(false);
                gatilho.current?.focus();
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

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

          {/* O teto vem da janela — F17.35. Ver `Menu` e `@/ui/teto`. */}
          <div
            ref={lista}
            className="o-rolagem-fina overflow-y-auto"
            style={{ maxHeight: pendura === null ? 'calc(100vh - 12rem)' : pendura.teto }}
          >
            {/* O `listbox` é SÓ a lista de opções, com nome — ver `Menu`. A busca,
                o `X` e o `Limpar` não são opção e ficam fora dele. */}
            <div role="listbox" aria-label={rotulo} aria-multiselectable>
            {visiveis.map((i) => {
              const marcado = escolhidos.includes(i.valor);
              return (
                <button
                  key={i.valor}
                  type="button"
                  role="option"
                  aria-selected={marcado}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[0.80rem]"
                  style={{
                    color: marcado ? 'var(--luz)' : 'var(--plat-dim)',
                    background: marcado ? 'var(--luz-soft)' : 'transparent',
                  }}
                  // NÃO fecha. Ver o cabeçalho: escolher três é um gesto só.
                  onClick={() => aoAlternar(i.valor)}
                >
                  {/* A marca é um quadrado, e não um círculo: círculo diz
                      "escolha uma", quadrado diz "escolha quantas quiser". A
                      forma ensina a regra sem legenda. */}
                  <span
                    aria-hidden
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[0.62rem] leading-none"
                    style={{
                      borderColor: marcado ? 'var(--luz)' : 'var(--hair-3)',
                      background: marcado ? 'var(--luz)' : 'transparent',
                      color: 'var(--ink-0)',
                    }}
                  >
                    {marcado ? '✓' : ''}
                  </span>
                  <span className="flex-1 truncate">{i.rotulo}</span>
                  {i.contagem !== undefined && (
                    <span className="tnum o-mono text-[0.70rem] text-mute">{i.contagem}</span>
                  )}
                </button>
              );
            })}
            </div>

            {visiveis.length === 0 && (
              <p className="px-2 py-3 text-center text-[0.75rem] text-mute" role="status">Nada com “{busca}”.</p>
            )}
          </div>

          {quantos > 0 && (
            <button
              type="button"
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-[0.75rem]"
              style={{ color: 'var(--mute)' }}
              onClick={() => aoLimpar()}
            >
              Limpar {rotulo.toLowerCase()} ({quantos})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
