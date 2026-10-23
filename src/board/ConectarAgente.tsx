/**
 * "CONECTAR UM AGENTE" — a parte da tela de conexões que ensina, etapa F21.4.
 *
 * O objetivo é alguém que nunca ouviu falar de MCP conectar o próprio agente
 * sozinho. Por isso: começa pela escolha do cliente ("qual programa você usa?"),
 * e só depois mostra a receita daquele cliente.
 *
 * Duas regras de honestidade, que valem mais que o desenho:
 *
 *   1. Nenhum caminho promete um clique. Cada receita diz a fricção real antes
 *      de a pessoa bater nela — inclusive o que só se resolve dentro do cliente.
 *   2. Nada é marcado como testado sem ter sido. Hoje os cinco caminhos estão
 *      em "não testado", e o selo diz isso na cara. A fonte é
 *      `src/integrations/client-recipes.ts`; mudar o selo é mudar lá, depois de
 *      conectar de verdade.
 *
 * O texto que o botão copia é exatamente o texto que a receita mostra — os dois
 * saem do mesmo campo `text`, não de duas cópias que podem divergir.
 */

import { useState } from 'react';

import { Ajuda } from '@/board/menus';
import { clientRecipes, serverAddresses, type ClientRecipe } from '@/integrations/client-recipes';
import { Aviso, Pilula, Selo } from '@/ui/primitivos';

/** A origem só é lida no navegador; no desenho do servidor cai no publicado. */
function origemAtual(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin;
}

function BotaoDeCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="o-btn o-btn-vidro o-btn-sm shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
        } catch {
          // Navegador sem permissão de área de transferência: o texto continua
          // visível na tela e pode ser selecionado à mão. Não vale derrubar nada.
          setCopiado(false);
        }
      }}
    >
      {copiado ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function Receita({ receita }: { receita: ClientRecipe }) {
  return (
    <div className="mt-3">
      <p className="text-[0.82rem] text-plat">{receita.summary}</p>

      <div className="mt-3 grid gap-2">
        {receita.copies.map((item) => (
          <div key={item.label} className="rounded-md border border-hair-2 bg-ink-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-wide text-mute">{item.label}</div>
              <BotaoDeCopiar texto={item.text} />
            </div>
            <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[0.78rem] text-luz">
              {item.text}
            </pre>
          </div>
        ))}
      </div>

      <ol className="mt-3 grid gap-2 pl-5 text-[0.82rem] text-plat" style={{ listStyle: 'decimal' }}>
        {receita.steps.map((passo) => (
          <li key={passo}>{passo}</li>
        ))}
      </ol>

      <div className="mt-3 grid gap-2">
        <Aviso tipo="atencao">
          <span>
            <b>O que vai dar trabalho:</b> {receita.friction}
          </span>
        </Aviso>
        {receita.status === 'nao-testado' && (
          <Aviso tipo="atencao">
            <span>
              <b>Ainda não testamos este caminho.</b> {receita.pending}
            </span>
          </Aviso>
        )}
      </div>
    </div>
  );
}

export function ConectarAgente() {
  const enderecos = serverAddresses(origemAtual());
  const receitas = clientRecipes(enderecos);
  const [escolhido, setEscolhido] = useState(receitas[0].id);
  const receita = receitas.find((r) => r.id === escolhido) ?? receitas[0];

  return (
    <section className="ad-secao" aria-labelledby="ad-conectar">
      {/* O cabeçalho das seções da administração — F13 (`.ad-secao-*`). */}
      <div className="ad-secao-cabeca">
        <h2 id="ad-conectar" className="ad-secao-titulo">Conectar um agente</h2>
        <Ajuda sobre="como um agente de IA passa a enxergar o IDE Works">
          O agente não entra sozinho: alguém precisa autorizar, de dentro do
          programa que ele usa. Aqui está o que copiar e o que fazer, por programa.
        </Ajuda>
      </div>

      <div className="o-card p-3">
        <p className="text-[0.82rem] text-mute">
          Primeiro: qual programa você usa para falar com a IA?
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {receitas.map((r) => (
            <Pilula key={r.id} ativo={r.id === receita.id} aoClicar={() => setEscolhido(r.id)}>
              {r.label}
            </Pilula>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Selo tom="warn" titulo="Nenhum destes caminhos foi conectado de ponta a ponta ainda">
            não testado
          </Selo>
          <span className="text-[0.78rem] text-mute">
            Nenhum programa aceita conexão em um clique: o começo é sempre dentro
            dele, e a autorização passa pelo navegador.
          </span>
        </div>

        <Receita receita={receita} />
      </div>
    </section>
  );
}
