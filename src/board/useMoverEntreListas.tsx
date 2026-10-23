import { TextoComMencoes } from '@/board/CamposDeMencao';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import type { EscolhaDeEtapa } from '@/board/mudanca-de-lista';
import { ApiError, MovimentoPrecisaDeEtapa, api, semSessao } from '@/lib/api';
import { BotaoDeFechar, Janela } from '@/ui/janela';
import { Aviso } from '@/ui/primitivos';

type Resultado = Awaited<ReturnType<typeof api.moverTarefaNoQuadro>>;
type Espera = { resolve: (r: Resultado | null) => void; reject: (e: unknown) => void };

/** Um só fluxo para os três lugares que oferecem "Mover para". */
export function useMoverEntreListas() {
  const { pathname } = useLocation();
  const [escolha, setEscolha] = useState<EscolhaDeEtapa | null>(null);
  const [etapa, setEtapa] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const espera = useRef<Espera | null>(null);
  const geracao = useRef(0);
  const ocupado = useRef(false);
  const enviando = useRef(false);

  const invalidar = useCallback(() => {
    geracao.current++;
    espera.current?.resolve(null);
    espera.current = null;
    ocupado.current = false;
    enviando.current = false;
  }, []);

  useEffect(() => {
    setEscolha(null);
    setConfirmando(false);
    return invalidar;
  }, [pathname, invalidar]);

  const terminar = useCallback((resultado: Resultado | null) => {
    espera.current?.resolve(resultado);
    espera.current = null;
    setEscolha(null);
  }, []);

  const mover = useCallback(async (taskId: string, listId: string): Promise<Resultado | null> => {
    if (ocupado.current) return null;
    ocupado.current = true;
    const vez = ++geracao.current;
    try {
      try {
        const r = await api.moverTarefaNoQuadro(taskId, listId, null);
        return vez === geracao.current ? r : null;
      } catch (e) {
        if (vez !== geracao.current) return null;
        if (!(e instanceof MovimentoPrecisaDeEtapa)) throw e;
        setEtapa('');
        setErro(null);
        setEscolha(e.escolha);
        return await new Promise<Resultado | null>((resolve, reject) => {
          espera.current = { resolve, reject };
        });
      }
    } finally {
      if (vez === geracao.current) ocupado.current = false;
    }
  }, []);

  const cancelar = () => {
    if (!enviando.current) terminar(null);
  };

  const confirmar = async () => {
    if (!escolha || !escolha.etapas.some(s => s.id === etapa) || enviando.current) return;
    const vez = geracao.current;
    enviando.current = true;
    setConfirmando(true);
    setErro(null);
    try {
      const r = await api.moverTarefaNoQuadro(escolha.taskId, escolha.listId, etapa, escolha.origem);
      if (vez === geracao.current) terminar(r);
    } catch (e) {
      if (vez !== geracao.current) return;
      if (semSessao(e)) {
        espera.current?.reject(e);
        espera.current = null;
        setEscolha(null);
      } else {
        if (e instanceof MovimentoPrecisaDeEtapa) {
          setEscolha(e.escolha);
          setEtapa('');
        }
        setErro(e instanceof ApiError ? e.message : 'Não foi possível confirmar a mudança. Tente novamente.');
      }
    } finally {
      if (vez === geracao.current) {
        enviando.current = false;
        setConfirmando(false);
      }
    }
  };

  const janela = escolha && (
    <Janela rotulo="Status diferentes" aoFechar={cancelar}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="o-titulo text-lg">Status diferentes</h2>
          <p className="o-dica mt-2">
            Escolha em qual etapa de <strong>{escolha.listName}</strong> esta tarefa deve entrar.
          </p>
        </div>
        {!confirmando && <BotaoDeFechar aoFechar={cancelar} />}
      </header>
      <p className="mt-4 text-sm break-words"><TextoComMencoes texto={escolha.taskTitle} /></p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-2">Etapa atual</p>
          <p className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden="true"
              style={{ backgroundColor: escolha.etapaAtual.color ?? 'currentColor' }} />
            <span className="break-words">{escolha.etapaAtual.name}</span>
          </p>
        </div>
        <label className="block min-w-0">
          <span className="eyebrow mb-2 block">Nova etapa</span>
          <select className="o-campo o-select w-full" aria-label="Nova etapa" value={etapa}
            disabled={confirmando} onChange={e => setEtapa(e.target.value)}>
            <option value="" disabled>Selecione uma etapa</option>
            {escolha.etapas.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      {erro && <div className="mt-4" role="alert"><Aviso tipo="erro">{erro}</Aviso></div>}
      <footer className="mt-6 flex justify-end gap-2">
        <button type="button" className="o-btn o-btn-fantasma" disabled={confirmando} onClick={cancelar}>
          Cancelar
        </button>
        <button type="button" className="o-btn o-btn-solido" disabled={!etapa || confirmando}
          onClick={() => void confirmar()}>{confirmando ? 'Movendo…' : 'Confirmar'}</button>
      </footer>
    </Janela>
  );

  return { mover, janela };
}
