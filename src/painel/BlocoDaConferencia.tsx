/**
 * O bloco da conferência no painel — F17.86.
 *
 * Os números e os nomes vêm do servidor, da mesma leitura do painel. Esta
 * peça só escreve. Somar de novo a partir da carteira, ou da árvore, daria
 * uma segunda opinião sobre a mesma junção.
 *
 * O tom é o dos outros avisos de informação desta tela: aponta o trabalho
 * que falta, não acusa quem deixou de ligar.
 *
 * RECOLHIDO, E ABAIXO DA CARTEIRA — F27
 *   Aberto e acima da busca, o bloco empurrava a carteira para baixo com uma
 *   pendência de CADASTRO — trabalho de quem arruma o quadro, não de quem abre
 *   o painel para achar o cliente que precisa dele. Agora ele é uma linha só,
 *   "Vínculos pendentes · N", que abre no clique.
 *
 *   `<details>` nativo, e não botão com estado como o "Arquivo" do painel: o
 *   navegador já dá teclado, `Enter`/espaço e o "expandido/recolhido" para o
 *   leitor de tela, e nada disso depende de `useEffect` — o que o teste no
 *   servidor desenha é o que a pessoa recebe, fechado.
 */

import { Link } from 'react-router-dom';

import {
  type Conferencia,
  FRASE_DA_CONFERENCIA,
} from '@/painel/conferencia';
import { Aviso } from '@/ui/primitivos';

export function BlocoDaConferencia({
  conferencia,
  alcancaQuadro = true,
}: {
  conferencia: Conferencia;
  /** Sem a área do quadro o atalho responderia 403. O nome continua. */
  alcancaQuadro?: boolean;
}) {
  const clientes = conferencia.clientesSemLista;
  const listas = conferencia.listasSemCliente;
  if (clientes.length === 0 && listas.length === 0) return null;

  return (
    <section className="mt-8" data-conferencia>
      <details className="group">
        {/* O mesmo desenho do "Arquivo" logo abaixo: linha fantasma com a
            contagem, seta que gira ao abrir. O marcador nativo sai (`list-none`
            e o `::-webkit-details-marker` do Safari) para não haver duas setas. */}
        <summary className="o-btn o-btn-fantasma o-btn-sm mb-2 list-none px-0 [&::-webkit-details-marker]:hidden">
          <span className="eyebrow">
            Vínculos pendentes · {clientes.length + listas.length}{' '}
            <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
          </span>
        </summary>

        <Aviso tipo="info">{FRASE_DA_CONFERENCIA}</Aviso>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="eyebrow mb-2">
              Clientes ativos sem lista · {clientes.length}
            </h3>
            {clientes.length === 0 ? (
              <p className="text-xs leading-snug text-mute">Nenhum neste alcance.</p>
            ) : (
              <ul className="space-y-2">
                {clientes.map((c) => (
                  <li key={c.id}>
                    <Link to={`/cliente/${c.id}`} className="block">
                      <div className="o-card o-card-hover p-3">
                        <div className="truncate text-sm text-plat">{c.name}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="eyebrow mb-2">
              Listas de trabalho sem cliente · {listas.length}
            </h3>
            {listas.length === 0 ? (
              <p className="text-xs leading-snug text-mute">Nenhuma neste alcance.</p>
            ) : (
              <ul className="space-y-2">
                {listas.map((l) => {
                  const cartao = (
                    <div className="o-card o-card-hover p-3">
                      <div className="truncate text-sm text-plat">{l.name}</div>
                      <div className="mt-1 truncate font-mono text-xs text-mute">
                        {l.spaceName}
                      </div>
                    </div>
                  );
                  return (
                    <li key={l.id}>
                      {alcancaQuadro ? (
                        <Link to={`/quadro/${l.id}`} className="block">
                          {cartao}
                        </Link>
                      ) : (
                        cartao
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
