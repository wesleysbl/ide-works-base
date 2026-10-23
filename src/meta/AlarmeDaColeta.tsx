/**
 * O alarme da coleta — etapa F9L.
 *
 * POR QUE ELE EXISTE, E POR QUE NO TOPO
 *   Em 2026-08-20 a coleta parou às 17:30 e ficou catorze horas morta. Ninguém
 *   soube. Não havia erro para ver: a execução era uma transação só, e ao ser
 *   morta pelo teto de tempo da plataforma desfazia até o próprio registro. O
 *   que restava como sintoma era uma AUSÊNCIA.
 *
 *   Ausência não se nota sozinha. A tela mostrava um selinho por conta dizendo
 *   "em dia" — e continuou dizendo "em dia" o apagão inteiro, porque o limite
 *   era de 36 horas e o apagão durou catorze.
 *
 *   Este componente faz a pergunta que faltava: **quando foi a última
 *   execução?** Uma pergunta só, no alto, antes de qualquer número.
 *
 * ELE FICA CALADO QUANDO ESTÁ TUDO BEM
 *   Em dia, é uma linha discreta. Alarme que grita por qualquer coisa é alarme
 *   que ninguém lê — e aí volta a valer a mesma cegueira, só que com tinta
 *   vermelha.
 */

import { useEffect, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { batidasPerdidas, saudeDoMotor } from '@/meta/coleta';
import { Aviso, Selo } from '@/ui/primitivos';

type Execucao = {
  started_at: string;
  finished_at: string | null;
  outcome: 'running' | 'ok' | 'partial' | 'failed';
  assets_total: number;
  assets_ok: number;
  assets_failed: number;
  rows_written: number;
  first_error: string | null;
};

const minutosAtras = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 60_000);

/** "há 3 min", "há 2 h", "há 14 h" — sem biblioteca e sem precisão falsa. */
function quandoFoi(iso: string): string {
  const m = minutosAtras(iso);
  if (m < 1) return 'agora mesmo';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

const duracao = (e: Execucao) =>
  e.finished_at === null
    ? null
    : Math.round((Date.parse(e.finished_at) - Date.parse(e.started_at)) / 1000);

export function AlarmeDaColeta() {
  const [execucoes, setExecucoes] = useState<Execucao[] | null>(null);
  const [temToken, setTemToken] = useState(true);
  const [aberto, setAberto] = useState(false);
  /**
   * A LEITURA FALHOU — conferência de 09/10/2026. Antes a falha virava
   * `setExecucoes([])`, que o resto lê como "nenhuma execução registrada": uma
   * queda de rede ou um 500 desenhava "A COLETA NUNCA RODOU. Sem ela não há
   * série histórica…" — alarme falso, no componente que existe para que o
   * alarme valha alguma coisa. Erro não é ausência: diz que não deu para
   * conferir, e deixa tentar de novo.
   */
  const [falhou, setFalhou] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await api.saudeDaColeta();
        if (!vivo) return;
        setExecucoes(r.runs as Execucao[]);
        setTemToken(r.hasToken);
        setFalhou(false);
      } catch (e) {
        if (!vivo) return;
        // Sem permissão para o livro não é erro desta tela: a pessoa
        // simplesmente não administra a área Meta, e o componente se cala.
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return;
        setFalhou(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tentativa]);

  if (falhou) {
    return (
      <div className="mt-3">
        <Aviso tipo="atencao" acao={{ rotulo: 'Tentar de novo', aoClicar: () => setTentativa((n) => n + 1) }}>
          Não foi possível conferir a coleta agora.
        </Aviso>
      </div>
    );
  }

  if (execucoes === null) return null;

  // A última execução que TERMINOU. Uma pendurada em `running` não conta como
  // sinal de vida — foi assim que a coleta parecia viva estando morta.
  const ultima = execucoes.find((e) => e.outcome !== 'running') ?? null;
  const saude = saudeDoMotor(ultima?.started_at ?? null);
  const perdidas = batidasPerdidas(ultima?.started_at ?? null);

  if (!temToken) return null; // A tela já avisa da falta de token em outro lugar.

  if (saude === 'nunca_rodou') {
    return (
      <div className="mt-3">
        <Aviso tipo="atencao">
          <span>
            <b>A coleta nunca rodou.</b> Sem ela não há série histórica — e a Meta não
            devolve o passado: métrica de usuário some em 90 dias, story em 24 horas.
          </span>
        </Aviso>
      </div>
    );
  }

  if (saude === 'parada' || saude === 'atrasada') {
    return (
      <div className="mt-3">
        <Aviso tipo={saude === 'parada' ? 'erro' : 'atencao'}>
          <span>
            <b>
              {saude === 'parada' ? 'A coleta parou.' : 'A coleta está atrasada.'}
            </b>{' '}
            A última execução foi {quandoFoi(ultima!.started_at)}
            {perdidas > 0 && ` — ${perdidas} batida(s) perdida(s)`}. O gatilho roda de
            meia em meia hora.
            {saude === 'parada' && (
              <span className="mt-1 block">
                Cada meia hora parada é dado que a Meta não devolve depois. Story some em
                24 horas.
              </span>
            )}
            {ultima?.first_error && (
              <span className="o-mono mt-1 block text-[0.70rem]">{ultima.first_error}</span>
            )}
          </span>
        </Aviso>
      </div>
    );
  }

  // Em dia: uma linha, e o histórico só se pedirem.
  return (
    <div className="mt-3">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 text-left"
        onClick={() => setAberto((v) => !v)}
      >
        <Selo tom={ultima?.outcome === 'ok' ? 'ok' : 'warn'}>coleta em dia</Selo>
        <span className="text-[0.72rem] text-mute">
          última {quandoFoi(ultima!.started_at)} · {ultima!.assets_ok} de{' '}
          {ultima!.assets_total} conta(s) · {ultima!.rows_written} linha(s)
          {duracao(ultima!) !== null && ` · ${duracao(ultima!)}s`}
        </span>
        <span className="o-mono text-[0.70rem] text-mute">{aberto ? '▾' : '▸'}</span>
      </button>

      {aberto && (
        <div className="o-card mt-2 overflow-hidden">
          {execucoes.slice(0, 12).map((e) => (
            <div
              key={e.started_at}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[0.72rem]"
              style={{ borderBottom: '1px solid var(--hair)' }}
            >
              <Selo tom={e.outcome === 'ok' ? 'ok' : e.outcome === 'failed' ? 'err' : 'warn'}>
                {e.outcome}
              </Selo>
              <span className="o-mono text-mute">{quandoFoi(e.started_at)}</span>
              <span className="tnum text-mute">
                {e.assets_ok}/{e.assets_total} conta(s)
              </span>
              <span className="tnum text-mute">{e.rows_written} linha(s)</span>
              {duracao(e) !== null && <span className="tnum text-mute">{duracao(e)}s</span>}
              {e.first_error && (
                <span className="o-mono text-[0.66rem]" style={{ color: 'var(--err)' }}>
                  {e.first_error.slice(0, 80)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
