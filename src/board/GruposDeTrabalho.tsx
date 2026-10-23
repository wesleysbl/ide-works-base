/**
 * Os quatro grupos, desenhados — etapa F17.18.
 *
 * POR QUE ELES SAÍRAM DAS PÁGINAS
 *   `Minhas tarefas` e `Todas as tarefas` agrupam do MESMO jeito, pelos MESMOS
 *   quatro grupos. Duas cópias divergiriam na primeira etapa que mexesse numa
 *   só — e o efeito seria a pessoa aprender duas leituras da mesma informação.
 *
 *   Também é o que torna o desenho testável sem rede: a página só monta os
 *   grupos depois de a resposta chegar, e `renderToStaticMarkup` não roda
 *   efeito. Com o componente separado, `tela-do-trabalho.test.ts` prova a ordem
 *   dos quatro e as frases de vazio com linhas de mentira.
 *
 * RECOLHER É DA REFERÊNCIA, E O PADRÃO É ABERTO
 *   Um grupo fechado por padrão esconderia o atraso de quem abriu a tela
 *   justamente para ver o atraso.
 *
 * ⚠️ E O RECOLHIDO SOBREVIVE AO F5 — F17.24
 *   Era `useState(true)`, e um F5 reabria os quatro. Medido no Chrome: recolher
 *   `Hoje`, apertar F5, `Hoje` volta aberto.
 *
 *   Ele foi para o ARMAZENAMENTO DO NAVEGADOR, e não para o endereço, pela
 *   regra da etapa: recolher `Em atraso` é arrumação minha, e não faz sentido
 *   nenhum colar para outra pessoa. É o mesmo destino, e pelo mesmo motivo, das
 *   pastas que eu deixo abertas na árvore.
 *
 *   O que se guarda é o RECOLHIDO, e não o aberto: assim o padrão continua
 *   sendo "tudo aberto" para quem nunca mexeu, e um grupo NOVO de uma etapa
 *   futura nasce aberto em vez de nascer invisível.
 *
 * O CABEÇALHO É UMA RÉGUA — F05 do plano UX
 *   Nome, contagem e um fio que corre até a borda: é o que separa os grupos
 *   quando o olho desce a lista, sem caixa em volta de cada um. A seta é o
 *   `IconeChevron` da barra (F29), e não mais o `▸` de texto, que a 0,6rem
 *   lia como um ponto. `data-grupo` dá o tom: `Em atraso` com tarefa leva a
 *   cor de erro no número — e a palavra continua dizendo o que é, então o
 *   estado não depende da cor.
 *
 * GRUPO VAZIO NÃO SOME
 *   Some-lo faria "não vi" e "não tem" virarem a mesma imagem. É a mesma
 *   decisão que a coluna vazia do quadro (F17.9a) já tomou. Mas ele não
 *   passa na frente de quem tem tarefa: os vazios vão para o fim (F05).
 *
 *   ⚠️ SALVO COM FILTRO — F05. Com uma busca aplicada, "Nada para hoje." é
 *   falso (pode haver para hoje, só não com esse texto) e a tela vira quatro
 *   frases de vazio em volta de uma tarefa. Aí `semVazios` tira os grupos sem
 *   linha; quem diz quantas achou e onde procurou é a linha de resultado.
 */

import { type Day } from '@/board/board';
import { LinhaDeTrabalho } from '@/board/LinhaDeTrabalho';
import { type WorkRow, agrupar } from '@/board/meu-trabalho';
import { useLugar } from '@/ui/aparencia';
import { IconeChevron } from '@/ui/Icones';
import { alternar } from '@/ui/lugar';

export function GrupoDeTrabalho({
  chave,
  rotulo,
  vazio,
  linhas,
  hoje,
  recolhivel,
}: {
  /** A chave do grupo (`hoje`, `atraso`, …) — é por ela que o recolhido é
   *  guardado. Ver o cabeçalho. */
  chave: string;
  rotulo: string;
  vazio: string;
  linhas: readonly WorkRow[];
  hoje: Day;
  recolhivel: boolean;
}) {
  const [lugar, definirLugar] = useLugar();
  const aberto = !lugar.grupos.includes(chave);
  const mostra = !recolhivel || aberto;

  return (
    <section className="mt-grupo" data-grupo={chave} data-vazio={linhas.length === 0 ? 'true' : undefined}>
      <header className="mt-grupo-topo">
        {recolhivel ? (
          <button
            type="button"
            className="mt-recolher"
            aria-expanded={aberto}
            onClick={() =>
              definirLugar((l) => ({ ...l, grupos: alternar(l.grupos, chave) }))
            }
          >
            <IconeChevron className="mt-caret" />
            {rotulo}
            <span className="mt-conta tnum">{linhas.length}</span>
          </button>
        ) : (
          <span className="mt-recolher" data-fixo="true">
            {rotulo}
            <span className="mt-conta tnum">{linhas.length}</span>
          </span>
        )}
        {/* F05: o grupo vazio diz "Nada para hoje." NA LINHA DO NOME, e não
            numa linha própria embaixo. Continua dizendo (não vi ≠ não tem),
            e custa uma linha em vez de duas — três grupos vazios antes do
            primeiro com tarefa empurravam a primeira tarefa para o meio da
            tela no celular. */}
        {mostra && linhas.length === 0 && <p className="mt-vazio">{vazio}</p>}
      </header>

      {mostra && linhas.length > 0 && (
        <ul className="mt-lista">
          {linhas.map((t) => (
            <LinhaDeTrabalho key={t.id} tarefa={t} hoje={hoje} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function GruposDeTrabalho({
  linhas,
  hoje,
  recolhivel = true,
  semVazios = false,
}: {
  linhas: readonly WorkRow[];
  hoje: Day;
  recolhivel?: boolean;
  /** Há filtro aplicado: grupo sem linha não é desenhado. Ver o cabeçalho. */
  semVazios?: boolean;
}) {
  /* VAZIO VAI PARA O FIM — verificação da F05. Três grupos vazios antes do
     primeiro com tarefa (lote todo sem prazo, ou só prazos futuros) punham a
     primeira tarefa em 42–48% da altura no celular. Eles continuam
     desenhados, com a frase ("não vi" ≠ "não tem"), só que depois dos que têm
     linha; entre si, e quando todos estão vazios, a ordem da referência fica
     (o `sort` é estável). */
  const grupos = agrupar(linhas, hoje)
    .filter((g) => !semVazios || g.linhas.length > 0)
    .sort((a, b) => Number(a.linhas.length === 0) - Number(b.linhas.length === 0));
  return (
    <>
      {grupos.map((g) => (
        <GrupoDeTrabalho
          key={g.chave}
          chave={g.chave}
          rotulo={g.rotulo}
          vazio={g.vazio}
          linhas={g.linhas}
          hoje={hoje}
          recolhivel={recolhivel}
        />
      ))}
    </>
  );
}
