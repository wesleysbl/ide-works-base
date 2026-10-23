/**
 * A ABA ABERTA DURANTE UMA PUBLICAÇÃO — conferência de 08/10/2026.
 *
 * Cada publicação troca o nome dos pedaços do pacote (`Quadro-<hash>.js`). Quem
 * deixou a aba aberta desde antes e vai para uma tela ainda não visitada pede um
 * pedaço que não existe mais: o import falha e o roteador mostra a tela de erro.
 * A equipe deixa abas abertas o dia inteiro, então isso acontecia a cada
 * publicação. O Vite avisa com o evento `vite:preloadError` (também quando o
 * próprio módulo falha, não só as dependências); aqui a aba se recarrega e
 * pega o pacote novo.
 *
 * ⚠️ UMA VEZ POR INTERVALO, E NUNCA EM LAÇO. Se o pedaço falhar de novo logo
 * depois da recarga (rede caída, publicação quebrada), a falha segue para a
 * tela de erro de rota (`@/ui/ErroDeRota`, que reconhece esta falha e pede a
 * recarga à pessoa, sem "Tentar de novo": o `React.lazy` guarda a falha), em
 * vez de recarregar sem parar. A marca mora no `sessionStorage` da aba;
 * armazenamento indisponível = não recarrega (o comportamento de antes).
 *
 * Texto por salvar: a recarga acontece DEPOIS de a navegação ter sido aceita —
 * a guarda "Sair sem salvar?" já perguntou antes de a tela nova pedir o pedaço.
 */

export const INTERVALO_ENTRE_RECARGAS_MS = 60_000;

const CHAVE = 'ideworks:recarga-por-pacote-novo';

/** Recarregar agora? Só se não houve recarga por este motivo há menos de um minuto. */
export function deveRecarregarPorPacoteNovo(agora: number, ultima: number | null): boolean {
  if (ultima === null || !Number.isFinite(ultima)) return true;
  return agora - ultima > INTERVALO_ENTRE_RECARGAS_MS;
}

/** Liga a recarga na janela. Chamada uma vez, na entrada do site. */
export function instalarRecargaPorPacoteNovo(janela: Window = window): void {
  janela.addEventListener('vite:preloadError', (evento) => {
    let ultima: number | null = null;
    try {
      const guardada = janela.sessionStorage.getItem(CHAVE);
      ultima = guardada === null ? null : Number(guardada);
      const agora = Date.now();
      if (!deveRecarregarPorPacoteNovo(agora, ultima)) return;
      janela.sessionStorage.setItem(CHAVE, String(agora));
    } catch {
      return; // sem armazenamento não há trava contra laço: fica a tela de erro
    }
    evento.preventDefault();
    janela.location.reload();
  });
}
