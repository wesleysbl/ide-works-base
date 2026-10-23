/**
 * Envio otimista e reconciliação pela chave — F20.5.
 *
 * A mesma `clientKey` no reenvio impede duplicata no banco. Aqui a tela
 * troca o balão pendente/falho pela confirmação sem criar um segundo.
 */

export type EstadoDoEnvio = 'confirmada' | 'pendente' | 'falha';

export type MensagemNaTela = {
  id: string;
  conversationId: string;
  authorId: string | null;
  body: string;
  kind: 'person' | 'system';
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientKey: string | null;
  estado: EstadoDoEnvio;
  erro?: string | null;
};

export function mensagemOtimista(entrada: {
  conversationId: string;
  authorId: string;
  body: string;
  clientKey: string;
  agoraIso: string;
}): MensagemNaTela {
  return {
    id: `local:${entrada.clientKey}`,
    conversationId: entrada.conversationId,
    authorId: entrada.authorId,
    body: entrada.body,
    kind: 'person',
    createdAt: entrada.agoraIso,
    editedAt: null,
    deletedAt: null,
    clientKey: entrada.clientKey,
    estado: 'pendente',
    erro: null,
  };
}

/** Confirmação da API (ou evento ao vivo) casa pela chave de envio. */
export function reconciliarEnvio(
  lista: readonly MensagemNaTela[],
  confirmada: Omit<MensagemNaTela, 'estado' | 'erro'> & {
    estado?: EstadoDoEnvio;
  },
): MensagemNaTela[] {
  const chave = confirmada.clientKey;
  const pronta: MensagemNaTela = {
    ...confirmada,
    estado: 'confirmada',
    erro: null,
  };

  if (chave) {
    const idx = lista.findIndex((m) => m.clientKey === chave);
    if (idx >= 0) {
      const proxima = lista.slice();
      proxima[idx] = pronta;
      // Se já existia a confirmada e um otimista, remove o otimista duplicado.
      return proxima.filter(
        (m, i) => i === idx || m.clientKey !== chave || m.id === pronta.id,
      );
    }
  }

  if (lista.some((m) => m.id === pronta.id)) {
    return lista.map((m) => (m.id === pronta.id ? pronta : m));
  }

  return [...lista, pronta];
}

export function marcarFalha(
  lista: readonly MensagemNaTela[],
  clientKey: string,
  erro: string,
): MensagemNaTela[] {
  return lista.map((m) =>
    m.clientKey === clientKey && m.estado !== 'confirmada'
      ? { ...m, estado: 'falha', erro }
      : m,
  );
}

/** Aplica edição/apagamento/chegada pelo id (e pela chave se vier). */
export function aplicarMensagem(
  lista: readonly MensagemNaTela[],
  mensagem: Omit<MensagemNaTela, 'estado' | 'erro'>,
): MensagemNaTela[] {
  return reconciliarEnvio(lista, mensagem);
}
