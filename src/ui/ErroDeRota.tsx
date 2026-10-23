/**
 * A TELA QUE SUBSTITUI O "UNEXPECTED APPLICATION ERROR!" — conferência de 09/10/2026.
 *
 * O PROBLEMA
 *   Quando uma tela estoura ao desenhar — dado parcial da API, um nulo onde se
 *   esperava uma lista (`Cannot read properties of undefined (reading
 *   'length')`) —, o roteador de dados trocava o app INTEIRO pela página padrão
 *   dele: um título em inglês e a pilha crua, sem barra lateral, sem botão.
 *   Quem estava no meio de um trabalho só podia apertar F5.
 *
 * O QUE ELA FAZ
 *   · fica no lugar da TELA e não do app: a tabela (`src/rotas.tsx`) a põe em
 *     cada rota-filha da moldura, então a moldura (tema, memória de rolagem,
 *     guarda de saída, conexão do chat) segue de pé;
 *   · desenha a barra lateral em volta, de modo que a pessoa vá para outro
 *     lugar sem recarregar. Nas rotas PÚBLICAS (entrar, ativar, redefinir) e na
 *     página do cliente não: a barra buscaria dados de quem não tem sessão e
 *     mandaria para `/` — e se a própria entrada fosse a tela estourada, isso
 *     seria um laço;
 *   · diz em português que a tela não abriu, e oferece duas saídas:
 *     `Tentar de novo` (desenha a tela outra vez, com as leituras marcadas como
 *     vencidas) e `Recarregar a página`;
 *   · registra o erro no console, com o caminho — a pilha é de quem investiga;
 *   · em desenvolvimento, e só nele, mostra os detalhes técnicos recolhidos.
 *
 * ⚠️ A FALHA DE PEDAÇO TEM OUTRO TEXTO E UM BOTÃO SÓ
 *   Se o `import()` da tela não baixou (publicação nova, rede caída), a recarga
 *   automática de `recarga-por-pacote-novo` já agiu — uma vez por minuto — ou
 *   não pôde agir. Aqui chega o que sobrou: pede-se a recarga à pessoa. Não se
 *   oferece `Tentar de novo`, porque o `React.lazy` guarda a promessa
 *   rejeitada: reerguer a tela relançaria o mesmo erro, e o botão pareceria
 *   quebrado.
 *
 * ⚠️ COMO O `Tentar de novo` REERGUE A TELA
 *   A fronteira de erro do roteador só se limpa quando a LOCALIZAÇÃO muda (ou
 *   numa revalidação). Navegar para o mesmo endereço com `replace` cria uma
 *   localização nova sem acrescentar passo ao histórico — o `Voltar` segue
 *   levando ao lugar de antes — e a tela monta do zero, com efeitos novos. Antes
 *   disso as consultas em memória são marcadas como vencidas: se o estouro veio
 *   de um dado ruim guardado, a tela nova relê em vez de repetir o erro.
 */

import { Component, type ReactNode, useEffect } from 'react';
import { useLocation, useMatches, useNavigate, useRouteError } from 'react-router-dom';

import { TelaComBarra } from '@/board/TelaComBarra';
import { useClienteDeConsultas } from '@/lib/consultas';
import { detalhesDoErro, ehFalhaDePacote, emDesenvolvimento } from '@/ui/erro-de-rota';
import { Aviso, Pagina, PaginaLarga } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';

const TITULO = 'Esta tela não abriu';

/**
 * O miolo: a frase, os botões e (em desenvolvimento) os detalhes. Sem roteador
 * dentro — recebe o que fazer —, para ser desenhado e provado sozinho.
 */
export function TelaDeErro({
  pacoteNovo,
  detalhes,
  aoTentarDeNovo,
  aoRecarregar,
}: {
  /** O pedaço da tela não baixou: outra frase, e só a recarga como saída. */
  pacoteNovo: boolean;
  /** O texto técnico. Ausente em produção. */
  detalhes?: string;
  aoTentarDeNovo: () => void;
  aoRecarregar: () => void;
}) {
  return (
    <div className="iw-erro-de-rota" data-estado="erro-de-rota">
      <Aviso tipo="erro">
        {pacoteNovo ? (
          <>
            Uma versão nova do IDE Works pode ter sido publicada enquanto esta aba estava aberta, ou a conexão
            caiu ao baixar a tela. Recarregue a página para continuar.
          </>
        ) : (
          <>
            Algo deu errado ao montar esta tela. O resto do IDE Works continua funcionando: tente de novo, ou
            siga para outro lugar pela barra lateral. Se o problema voltar, avise a equipe.
          </>
        )}
      </Aviso>
      <div className="mt-3 flex flex-wrap gap-2">
        {!pacoteNovo && (
          <button type="button" className="o-btn o-btn-primario" onClick={aoTentarDeNovo}>
            Tentar de novo
          </button>
        )}
        <button
          type="button"
          className={`o-btn ${pacoteNovo ? 'o-btn-primario' : 'o-btn-vidro'}`}
          onClick={aoRecarregar}
        >
          Recarregar a página
        </button>
      </div>
      {detalhes !== undefined && (
        <details className="mt-4">
          <summary className="o-dica cursor-pointer">Detalhes técnicos (só em desenvolvimento)</summary>
          <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-[0.72rem]">
            {detalhes}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * A barra lateral é UMA PEÇA A MAIS na tela de erro — e pode ser ela a que
 * estourou (uma árvore de espaços com forma inesperada, por exemplo). Se
 * estourar de novo aqui, cai para a versão sem barra em vez de o roteador
 * trocar tudo pela página padrão: a tela de erro nunca pode ser quem falha.
 */
class ComBarraSeAguentar extends Component<
  { comBarra: ReactNode; semBarra: ReactNode },
  { falhou: boolean }
> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(erro: unknown) {
    console.error('[ide-works] A barra lateral também falhou na tela de erro:', erro);
  }

  render() {
    return this.state.falhou ? this.props.semBarra : this.props.comBarra;
  }
}

/** O `errorElement` da tabela de rotas — ver `src/rotas.tsx`. */
export function ErroDeRota() {
  const erro = useRouteError();
  const local = useLocation();
  const navegar = useNavigate();
  const consultas = useClienteDeConsultas();
  const publica = useMatches().some((m) => (m.handle as { publica?: boolean } | undefined)?.publica === true);

  useEffect(() => {
    console.error(`[ide-works] A tela ${local.pathname} falhou ao abrir:`, erro);
  }, [erro, local.pathname]);

  const corpo = (
    <TelaDeErro
      pacoteNovo={ehFalhaDePacote(erro)}
      detalhes={emDesenvolvimento() ? detalhesDoErro(erro) : undefined}
      aoTentarDeNovo={() => {
        void consultas.invalidateQueries();
        navegar(`${local.pathname}${local.search}${local.hash}`, { replace: true, state: local.state });
      }}
      aoRecarregar={() => window.location.reload()}
    />
  );
  const semBarra = <Pagina titulo={TITULO}>{corpo}</Pagina>;
  if (publica) return semBarra;

  return (
    <ComBarraSeAguentar
      semBarra={semBarra}
      comBarra={
        <PaginaLarga>
          <TelaComBarra>
            <Topo titulo={TITULO} />
            {corpo}
          </TelaComBarra>
        </PaginaLarga>
      }
    />
  );
}
