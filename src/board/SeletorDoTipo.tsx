/**
 * O SELETOR DO TIPO E O SELO — F40, Fase 4.
 *
 * Quatro botões em linha (Vídeo, Arte, Foto, Outros), no modal, no
 * `+ Adicionar tarefa` e na ficha. O mesmo botão de dois estados em todos:
 * clicar no escolhido de novo o desmarca SÓ quando `podeLimpar` (lista interna).
 * O selo é o `Selo` do Controle da semana (Fase 7), com o mesmo rótulo.
 */

import { type TipoDaTarefa, OPCOES_DO_TIPO, rotuloDoTipoDoCartao } from '@/board/tipo-no-cartao';
import { Selo } from '@/ui/primitivos';

export function SeletorDoTipo({
  valor,
  aoMudar,
  obrigatorio,
  podeLimpar,
  faltando,
  desativado,
  rotulo = 'Tipo',
}: {
  valor: TipoDaTarefa | null;
  aoMudar: (tipo: TipoDaTarefa | null) => void;
  /** Lista de produção: o rótulo avisa que é obrigatório. */
  obrigatorio?: boolean;
  /** Clicar no escolhido desmarca (lista interna). */
  podeLimpar?: boolean;
  /** A pessoa já tentou criar sem tipo. */
  faltando?: boolean;
  desativado?: boolean;
  rotulo?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={obrigatorio ? `${rotulo} (obrigatório)` : rotulo}
      data-tipo-seletor="1"
      data-obrigatorio={obrigatorio ? 'true' : undefined}
      data-faltando={faltando ? 'true' : undefined}
    >
      <span className="text-xs" style={{ color: faltando ? 'var(--err)' : 'var(--mute)' }}>
        {rotulo}
        {obrigatorio ? ' *' : ''}
      </span>
      {OPCOES_DO_TIPO.map((o) => {
        const ativo = valor === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={`o-btn o-btn-sm ${ativo ? 'o-btn-primario' : 'o-btn-vidro'}`}
            aria-pressed={ativo}
            data-tipo={o.value}
            disabled={desativado}
            onClick={() => aoMudar(ativo && podeLimpar ? null : o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** O selo pequeno do tipo no card. Sem tipo, não desenha nada. */
export function SeloDoTipo({ tipo }: { tipo: TipoDaTarefa | null | undefined }) {
  const nome = rotuloDoTipoDoCartao(tipo);
  if (nome === null) return null;
  return (
    <span data-selo-tipo={tipo} title={`Tipo: ${nome}`}>
      <Selo>{nome}</Selo>
    </span>
  );
}
