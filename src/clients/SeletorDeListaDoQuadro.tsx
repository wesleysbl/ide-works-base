/**
 * Seletor de uma lista do quadro, com busca — F17.85.
 *
 * Oferece só o que a pessoa alcança. Mostra espaço e pasta junto do nome,
 * porque "Demandas" em dois times é o caso comum, não a exceção. A busca
 * aparece sempre: a carteira tem dezenas de listas, e um `<select>` nativo
 * não dá conta de achar a certa pelo caminho.
 *
 * Não grava. Quem escolhe avisa o pai; o salvamento é o da ficha.
 */

import { useMemo, useState } from 'react';

import {
  type ListaAlcancavelDoQuadro,
  rotuloDaListaDoQuadro,
} from '@/clients/listas-do-quadro';
import { IconeBusca } from '@/ui/Icones';

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function SeletorDeListaDoQuadro({
  valor,
  opcoes,
  rotuloAtual,
  aoEscolher,
}: {
  valor: string;
  opcoes: ListaAlcancavelDoQuadro[];
  /** Já resolvido pelo pai: alcançável, ligada sem nome, ou "escolher". */
  rotuloAtual: string;
  aoEscolher: (id: string) => void;
}) {
  const [busca, setBusca] = useState('');

  const visiveis = useMemo(() => {
    const alvo = semAcento(busca.trim());
    if (alvo === '') return opcoes;
    return opcoes.filter((o) => semAcento(rotuloDaListaDoQuadro(o)).includes(alvo));
  }, [opcoes, busca]);

  if (valor !== '') {
    return (
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[0.82rem]">{rotuloAtual}</p>
        <button
          type="button"
          className="o-btn o-btn-fantasma o-btn-sm shrink-0"
          onClick={() => {
            setBusca('');
            aoEscolher('');
          }}
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="relative block">
        <IconeBusca className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute" />
        <input
          className="o-campo o-campo-sm pl-8"
          placeholder="Buscar lista, espaço ou pasta…"
          aria-label="Buscar lista do quadro"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const primeira = visiveis[0];
              if (primeira) aoEscolher(primeira.id);
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setBusca('');
            }
          }}
        />
      </label>

      <div className="o-rolagem-fina mt-2 max-h-48 overflow-y-auto rounded-lg border border-[var(--hair-3)]">
        {visiveis.map((o) => (
          <button
            key={o.id}
            type="button"
            className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-[0.80rem] hover:bg-[var(--luz-soft)]"
            onClick={() => aoEscolher(o.id)}
          >
            <span className="truncate">{o.name}</span>
            <span className="truncate text-[0.70rem] text-mute">
              {o.folderName ? `${o.spaceName} · ${o.folderName}` : o.spaceName}
              {o.archived ? ' (arquivada)' : ''}
            </span>
          </button>
        ))}

        {visiveis.length === 0 && (
          <p className="px-2 py-3 text-center text-[0.75rem] text-mute">
            {opcoes.length === 0
              ? 'Nenhuma lista ao seu alcance.'
              : `Nada com “${busca}”.`}
          </p>
        )}
      </div>
    </div>
  );
}
