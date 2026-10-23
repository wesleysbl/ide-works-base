/**
 * Peças da tela de Conexões que a suíte desenha no servidor — F26.4.
 *
 * `pages/Conexoes.tsx` só mostra o cartão e a lista depois de carregar (um
 * `useEffect`), e o teste renderiza com `renderToStaticMarkup`, onde nenhum
 * efeito roda. Separadas aqui, as duas peças que dependem dos rótulos novos
 * podem ser desenhadas e conferidas sem navegador.
 */

import { notaDoDesfazer, rotuloDaCapacidade, rotuloDaOperacao } from '@/board/rotulos-da-conexao';
import { dataCurtaDoInstante } from '@/ui/grade-do-mes';
import { Aviso, Selo } from '@/ui/primitivos';

/** As permissões da conexão, uma por selo, na ordem em que a concessão guardou. */
export function SelosDasPermissoes({ capabilities }: { capabilities: readonly string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {capabilities.map((cap) => (
        <Selo key={cap} tom="neutro" titulo={cap}>
          {rotuloDaCapacidade(cap)}
        </Selo>
      ))}
    </div>
  );
}

export type LinhaDeExecucao = {
  grantName: string;
  operation: string;
  origin: string;
  active: boolean;
  occurredAt: string;
  actedAs: { integrationName?: string } | null;
};

/** Uma escrita do agente no histórico de execuções. */
export function LinhaDaExecucao({ execucao: e }: { execucao: LinhaDeExecucao }) {
  const desfazer = notaDoDesfazer(e.operation);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
      style={{ borderBottom: '1px solid var(--hair)' }}
    >
      <span className="min-w-[9rem] flex-1 text-[0.78rem] text-plat">{e.grantName}</span>
      <Selo tom="neutro">{rotuloDaOperacao(e.operation)}</Selo>
      {desfazer && (
        <span className="text-[0.70rem] text-mute" title={desfazer.explica}>
          {desfazer.texto}
        </span>
      )}
      <Selo tom={e.active ? 'ok' : 'neutro'}>{e.origin}</Selo>
      {e.actedAs?.integrationName && (
        <span className="text-[0.70rem] text-mute">{e.actedAs.integrationName}</span>
      )}
      <span className="o-mono text-[0.70rem] text-mute">{dataCurtaDoInstante(e.occurredAt)}</span>
    </div>
  );
}

/**
 * O AVISO ÚNICO DAS CONEXÕES ANTIGAS — F44, Fase 9.
 *
 * Em 09/10/2026 "ler clientes" passou a mostrar também plano, renovação, cota e
 * etiquetas. Quem autorizou uma conexão antes disso concedeu "ler clientes"
 * pelo que ele mostrava então. As permissões não mudaram — o que a mesma
 * permissão revela, sim. UM aviso na tela (não um por conexão), listando quais
 * são; dispensável, e a decisão fica só neste navegador.
 */
/** O aviso, já com a lista de quais conexões são antigas. Sem nenhuma, não desenha. */
export function AvisoDasConexoesAntigas({
  antigas,
  aoDispensar,
}: {
  antigas: ReadonlyArray<{ id: string; name: string; authorizedAt?: string | null }>;
  aoDispensar?: () => void;
}) {
  if (antigas.length === 0) return null;
  return (
    <div className="ad-aviso" data-aviso="conexoes-antigas">
      <Aviso tipo="atencao">
        <p>
          {antigas.length === 1 ? 'Uma conexão foi autorizada' : `${antigas.length} conexões foram autorizadas`}{' '}
          antes de 09/10. Desde então, &quot;ler clientes&quot; mostra também plano, renovação, cota e
          etiquetas — revise ou reconecte.
        </p>
        <ul className="mt-1 list-disc pl-5">
          {antigas.map((c) => (
            <li key={c.id}>
              {c.name}
              {c.authorizedAt ? ` — autorizada em ${dataCurtaDoInstante(c.authorizedAt)}` : ''}
            </li>
          ))}
        </ul>
        {aoDispensar && (
          <button type="button" className="o-btn o-btn-vidro o-btn-sm mt-2" onClick={aoDispensar}>
            Entendi, dispensar
          </button>
        )}
      </Aviso>
    </div>
  );
}
