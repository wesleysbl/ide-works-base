/**
 * Quem está olhando, para a tela não oferecer porta fechada — etapa F13.
 *
 * ISTO NÃO É PERMISSÃO
 *   A permissão mora no servidor e vale para qualquer caminho, inclusive quem
 *   chamar a API na mão. Este arquivo serve para a NAVEGAÇÃO: esconder o que a
 *   pessoa não alcança, para ela não clicar e levar um 403 na cara.
 *
 *   Confundir os dois seria perigoso nos dois sentidos — uma tela que "protege"
 *   escondendo botão não protege nada, e um servidor que confia no que a tela
 *   mandou não protege ninguém.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ ERA UMA CHAMADA POR USO. AGORA É UMA POR TELA — F17.CARGA02
 * ═══════════════════════════════════════════════════════════════════════════
 *   O cabeçalho antigo dizia "uma chamada por montagem, e ela é barata". A
 *   conta estava certa e a unidade estava errada: era uma chamada por USO do
 *   gancho, e há telas com DOIS usos ao mesmo tempo — a ficha da tarefa
 *   pergunta, e a barra lateral dentro dela pergunta de novo. Dois `/auth/me`
 *   idênticos, lado a lado, em toda abertura de tarefa.
 *
 *   Agora a leitura é UMA consulta compartilhada (`@/lib/consultas`). Dois usos
 *   simultâneos dividem o mesmo pedido; um terceiro que monte dentro da
 *   validade não pede nada. Uma renovação de crachá continua acontecendo por
 *   fora, em `@/lib/api`, e não conta como segunda leitura.
 *
 * ⚠️ A SESSÃO TAMBÉM DIZ DE QUEM É O RASCUNHO — F17.AUD02
 *   `userId` é o id estável do ator, e é ele que vincula um rascunho local ao
 *   seu autor (ver `ui/rascunho.ts`). Cada resposta de `/auth/me` confirma o
 *   dono da aba; e quando OUTRA aba avisa que a sessão mudou, este gancho
 *   pergunta de novo. Se a resposta for "ninguém", o que esta aba guardou
 *   pertence a quem já saiu — e vai embora antes de a tela ficar sabendo.
 *
 *   Uma falha de rede na primeira pergunta NÃO apaga nada: sem sessão a tela
 *   já manda para o login, e um rascunho que tem dono só volta para o dono.
 *
 * ⚠️ E AGORA ELA DIZ DE QUEM É O CACHE TAMBÉM — F17.CARGA02
 *   O mesmo `userId` carimba as consultas em memória. Confirmar uma identidade
 *   DIFERENTE da anterior descarta tudo o que estava guardado e relê com o
 *   crachá novo; perder a sessão apaga sem reler. É a mesma regra do rascunho,
 *   aplicada ao mesmo perigo: dado privado de quem já saiu continuar na tela.
 *   Ver `consultasSaoDe` e `esquecerConsultas`.
 */

import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { type Area } from '@/auth/areas';
import { type Papel, PAPEIS } from '@/auth/papeis';
import { api, semSessao } from '@/lib/api';
import {
  CHAVE_DA_SESSAO,
  clienteDeConsultas,
  consultasSaoDe,
  esquecerConsultas,
  useClienteDeConsultas,
} from '@/lib/consultas';
import {
  assumirDono,
  avisarOutrasAbas,
  esquecerDono,
  limparAoSair,
  vigiarOutrasAbas,
} from '@/ui/rascunho';

export type Sessao = {
  /** O id estável do ator autenticado — o dono de qualquer rascunho local. */
  userId: string;
  email: string;
  /**
   * O nome da pessoa, para o chip da conta — F29. `null` quando o perfil não
   * tem nome (a maioria, hoje): o chip mostra o e-mail. É o `full_name` que a
   * tela de Pessoas mostra, e `/auth/me` o devolve desde a F29.
   */
  nome: string | null;
  isSuperadmin: boolean;
  /** So o topo. Ver . */
  isSuper: boolean;
  /**
   * O papel, para o chip da conta no pé da barra dizer quem está ali — F29.
   * `/auth/me` já o devolvia; só a tela não guardava. `null` quando o valor não
   * é um dos três conhecidos: o chip cala o papel em vez de inventar um.
   */
  papel: Papel | null;
  areas: Area[];
};

const papelConhecido = (p: unknown): Papel | null =>
  (PAPEIS as readonly unknown[]).includes(p) ? (p as Papel) : null;

/**
 * O nome como o chip pode mostrar — F29. O servidor já limpa, e a tela confere
 * de novo: um servidor antigo não manda o campo, e um nome em branco no chip
 * seria pior que o e-mail.
 */
const nomeLegivel = (n: unknown): string | null =>
  typeof n === 'string' && n.trim() !== '' ? n.trim() : null;

/**
 * A leitura em si — a única do sistema que pergunta `/auth/me`.
 *
 * ⚠️ OS DOIS EFEITOS COLATERAIS ESTÃO AQUI DE PROPÓSITO, e nesta ordem.
 *   Um efeito de React rodaria DEPOIS do desenho, e entre o desenho e o efeito
 *   caberia um quadro com a árvore de quem saiu na tela. Aqui a resposta chega,
 *   a identidade é conferida, e só então o dado é entregue a quem desenha.
 *
 *   As consultas ANTES do rascunho porque é a ordem do risco: o que está no
 *   cache já está desenhado; o rascunho ainda depende de alguém clicar.
 *
 * `signal` é o da consulta: desmontar a última tela que olhava aborta o pedido,
 * e cancelar não é falhar (ver `LeituraCancelada`, em `@/lib/api`).
 */
async function lerSessao({
  client,
  signal,
}: {
  client: QueryClient;
  signal: AbortSignal;
}): Promise<Sessao | null> {
  const r = await api.eu(signal);
  consultasSaoDe(r.userId, client);
  assumirDono(r.userId);
  return {
    userId: r.userId,
    email: r.email,
    nome: nomeLegivel(r.nome),
    isSuperadmin: r.isSuperadmin,
    isSuper: r.isSuper,
    papel: papelConhecido(r.papel),
    areas: r.areas as Area[],
  };
}

/**
 * A consulta, do jeito que a tela a pede.
 *
 * Exportada para a suíte poder ligar um observador a ELA — o mesmo objeto que
 * `useSessao` entrega ao React —, e não a uma cópia parecida.
 */
export const consultaDaSessao = {
  queryKey: CHAVE_DA_SESSAO,
  queryFn: lerSessao,
} as const;

/**
 * OUTRA ABA AVISOU QUE A SESSÃO MUDOU: confira quem é, agora.
 *
 * `staleTime: 0` força a pergunta mesmo com resposta fresca — é justamente
 * quando ela está fresca que o aviso importa. Se várias telas ouvirem o mesmo
 * aviso (a página e a barra ouvem cada uma a sua), o pedido é UM: a consulta é
 * a mesma, e quem chega durante ela espera a mesma resposta.
 *
 * ⚠️ SÓ O 401 ENCERRA — F17.AUD04. Rede fora, borda muda, renovação
 * indisponível: nada disso é veredito sobre a credencial, e nenhum deles apaga
 * rascunho nem cache. Uma indisponibilidade de segundos virando logout foi o
 * achado 5 da auditoria de 09/09/2026, e ele não volta por esta porta.
 */
export async function conferirIdentidade(
  cliente: QueryClient = clienteDeConsultas,
): Promise<void> {
  try {
    await cliente.fetchQuery({ ...consultaDaSessao, staleTime: 0 });
  } catch (e) {
    if (!semSessao(e)) return;
    // O que esta aba guardou é de quem se foi. Rascunho e cache somem antes de
    // a tela reagir; a sessão vira `null`, e é isso que a tela lê para mandar
    // ao login.
    esquecerDono();
    esquecerConsultas(cliente);
    cliente.setQueryData<Sessao | null>(CHAVE_DA_SESSAO, null);
  }
}

export function useSessao(): { sessao: Sessao | null; carregando: boolean } {
  const cliente = useClienteDeConsultas();

  const { data, isPending } = useQuery(consultaDaSessao, cliente);

  useEffect(() => vigiarOutrasAbas(() => void conferirIdentidade(cliente)), [cliente]);

  /* `isPending` é "não há resposta ainda" — nem dado, nem erro. É o mesmo que o
     `carregando` de antes dizia: a falha DESLIGA a espera, porque a resposta
     chegou, e ela foi "não". */
  return { sessao: data ?? null, carregando: isPending };
}

/**
 * Se a navegação deve mostrar esta área.
 *
 * ENQUANTO CARREGA, MOSTRA. Esconder e depois revelar faz o menu piscar e
 * empurra o botão para debaixo do cursor no momento do clique — e o servidor
 * recusa de qualquer jeito se não for para ser.
 */
export const podeVer = (sessao: Sessao | null, area: Area): boolean =>
  sessao === null || sessao.isSuperadmin || sessao.areas.includes(area);

/**
 * Quem administra: `admin` e `super_admin`. É a MESMA conta do servidor
 * (`actor.isSuperadmin`, D7 do F40), e só serve para a tela não oferecer porta
 * fechada — quem recusa de verdade é a API.
 *
 * Ao contrário de `podeVer`, SEM sessão a resposta é NÃO: um item de
 * administração que aparece e some é pior que um que chega meio segundo depois.
 */
export const ehAdmin = (sessao: Sessao | null): boolean => sessao?.isSuperadmin === true;

/**
 * SAIR — F29: a sequência que morava inline no cabeçalho do Painel, agora UMA
 * função, chamada pelo menu da conta no pé da barra.
 *
 * ⚠️ POR QUE ELA SAIU DO PAINEL
 *   O Painel tinha o único `Sair` do sistema. A F29 levou o `Sair` para o menu
 *   da conta, que existe em toda tela com barra — e uma segunda cópia da
 *   sequência seria a primeira a esquecer um passo. A ordem abaixo é o que
 *   protege o dado de quem sai; ela mora num lugar só.
 *
 * A ORDEM, E POR QUÊ
 *   1. `limpar` — os rascunhos desta aba vão embora ANTES de o servidor
 *      responder, e as outras abas ficam sabendo (F17.AUD02, `ui/rascunho.ts`).
 *   2. `esquecer` — o cache em memória junto (F17.CARGA02). A troca de página
 *      o levaria de qualquer forma; apagar ANTES fecha a janela entre o clique
 *      e a troca, em que uma resposta em voo ainda poderia pintar a árvore de
 *      quem acabou de sair.
 *   3. `encerrar` — o servidor encerra a sessão. Falha de rede NÃO segura a
 *      pessoa aqui: a limpeza local já aconteceu, e a página vai embora.
 *   4. `avisar` — de novo, agora que o servidor já encerrou: o primeiro aviso
 *      pode ter feito a outra aba perguntar ANTES de a sessão acabar — e ouvir
 *      que ainda era a mesma pessoa.
 *   5. `irParaEntrada` — `replace`, e não `href`: o `Voltar` do navegador não
 *      deve devolver a pessoa a uma tela de quem já saiu.
 *
 * Os passos entram por parâmetro, com os de verdade como padrão — o mesmo
 * desenho de `conferirIdentidade(cliente = …)`: a suíte roda sem navegador e
 * confere a ORDEM com dublês.
 */
export type PassosDeSair = {
  limpar: () => void;
  esquecer: () => void;
  encerrar: () => Promise<unknown>;
  avisar: () => void;
  irParaEntrada: () => void;
};

const PASSOS_DE_SAIR: PassosDeSair = {
  limpar: limparAoSair,
  esquecer: () => esquecerConsultas(),
  encerrar: () => api.sair(),
  avisar: avisarOutrasAbas,
  irParaEntrada: () => window.location.replace('/'),
};

export async function sairDaConta(passos: PassosDeSair = PASSOS_DE_SAIR): Promise<void> {
  passos.limpar();
  passos.esquecer();
  await passos.encerrar().catch(() => undefined);
  passos.avisar();
  passos.irParaEntrada();
}
