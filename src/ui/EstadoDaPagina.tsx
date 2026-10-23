/**
 * OS ESTADOS DE UMA ÁREA DE CONTEÚDO — F03 do plano UX (§6 da especificação).
 *
 * POR QUE NÃO BASTAVA O `Aviso`
 *   O `Aviso` é `role="alert"`: interrompe o leitor de tela na hora. É o certo
 *   para ERRO, e ele continua sendo quem desenha o erro aqui (com o
 *   `Tentar de novo`). Mas "sua lista está vazia" anunciada como alarme é
 *   barulho, e "Carregando…" num `<p class="eyebrow">` solto não diz a
 *   ninguém que algo está a caminho. Faltavam três estados que o `Aviso` não
 *   distingue — e a tela precisa distinguir:
 *
 *     carregando     ainda não se sabe. Nada de zero, nada de "vazio".
 *     vazio          se sabe, e não há nada — com a ação permitida, se houver.
 *     sem-resultado  há coisas, mas o FILTRO não achou nenhuma — e a saída é
 *                    limpar o filtro, não cadastrar. Confundir os dois é dizer
 *                    "você não tem tarefas" a quem só digitou errado.
 *     sem-acesso     existe, mas não para esta pessoa — sem mostrar o que é.
 *     erro           o `Aviso` de sempre.
 *
 * O QUE CADA UM DIZ AO LEITOR DE TELA
 *   carregando → `role="status"` (educado: anuncia uma vez, sem interromper).
 *   sem-resultado → `role="status"`: é a resposta a algo que a pessoa acabou
 *     de fazer (digitar, filtrar).
 *   vazio e sem-acesso → sem papel vivo: são o conteúdo da página, lidos na
 *     ordem, e não uma novidade.
 *   erro → `role="alert"` (do `Aviso`).
 */

import { Inbox, Lock, SearchX } from 'lucide-react';
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Aviso } from '@/ui/primitivos';

export type TipoDeEstado = 'carregando' | 'vazio' | 'sem-resultado' | 'sem-acesso' | 'erro';

export type AcaoDoEstado =
  | { rotulo: string; aoClicar: () => void }
  | { rotulo: string; para: string };

const ICONE = { vazio: Inbox, 'sem-resultado': SearchX, 'sem-acesso': Lock } as const;

export function EstadoDaPagina({
  tipo,
  titulo,
  children,
  acao,
  linhas = 3,
}: {
  tipo: TipoDeEstado;
  /**
   * A frase principal. No carregamento é o que se ouve e se lê ("Carregando…"
   * por padrão); no erro é a mensagem do servidor, dita sem reinterpretação.
   */
  titulo?: string;
  /** A explicação curta — o que aconteceu e o que dá para fazer. */
  children?: ReactNode;
  /**
   * A saída. Uma lista desenha as ações lado a lado (F06C: `Minhas tarefas`
   * vazia leva a `Delegado` e a `Todas as tarefas`); no erro vale só a
   * primeira que for botão.
   */
  acao?: AcaoDoEstado | readonly AcaoDoEstado[];
  /** Quantas linhas o esqueleto do carregamento desenha. */
  linhas?: number;
}) {
  const acoes: readonly AcaoDoEstado[] = acao === undefined ? [] : Array.isArray(acao) ? acao : [acao as AcaoDoEstado];
  if (tipo === 'erro') {
    const botao = acoes.find((a): a is { rotulo: string; aoClicar: () => void } => 'aoClicar' in a);
    return (
      <div className="iw-estado-erro" data-estado="erro">
        <Aviso tipo="erro" acao={botao}>
          {titulo}
          {children && <> {children}</>}
        </Aviso>
      </div>
    );
  }

  if (tipo === 'carregando') {
    return (
      <div className="iw-estado" data-estado="carregando" role="status">
        <span className="iw-estado-espera">{titulo ?? 'Carregando…'}</span>
        {/* O esqueleto é a FORMA do que vem — ocupa o lugar para a lista não
            empurrar a tela quando chegar. É desenho: o leitor ouve a frase. */}
        <div className="iw-esqueleto" aria-hidden="true">
          {Array.from({ length: linhas }, (_, i) => (
            <span key={i} className="iw-esqueleto-linha" />
          ))}
        </div>
      </div>
    );
  }

  const Icone = ICONE[tipo];
  return (
    <div
      className="iw-estado iw-estado-cartao"
      data-estado={tipo}
      role={tipo === 'sem-resultado' ? 'status' : undefined}
    >
      <span className="iw-estado-icone" aria-hidden="true">
        <Icone size={18} strokeWidth={1.75} />
      </span>
      <div className="iw-estado-texto">
        {titulo && <p className="iw-estado-titulo">{titulo}</p>}
        {children && <p className="iw-estado-frase">{children}</p>}
      </div>
      {acoes.length === 1 && <BotaoDoEstado acao={acoes[0]} className="iw-estado-acao" />}
      {acoes.length > 1 && (
        <div className="iw-estado-acao iw-estado-acoes">
          {acoes.map((a) => (
            <BotaoDoEstado key={a.rotulo} acao={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function BotaoDoEstado({ acao, className }: { acao: AcaoDoEstado; className?: string }) {
  const classe = `o-btn o-btn-vidro o-btn-sm${className ? ` ${className}` : ''}`;
  return 'para' in acao ? (
    <Link to={acao.para} className={classe}>
      {acao.rotulo}
    </Link>
  ) : (
    <button type="button" className={classe} onClick={acao.aoClicar}>
      {acao.rotulo}
    </button>
  );
}
