import { useContext, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { ContextoDeMencoes, filtrarMencionaveis, noDeMencao, type PessoaMencionavel } from '@/board/mencoes';
import '@/ui/mencoes.css';

export function useMencoes(ref: RefObject<HTMLElement>, aoMudar: () => void, desativado = false) {
  const alvo = useContext(ContextoDeMencoes);
  const [consulta, setConsulta] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<PessoaMencionavel[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [indice, setIndice] = useState(0);
  const [posicao, setPosicao] = useState({ left: 0, top: 0 });
  const intervalo = useRef<Range | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const aberto =
    consulta !== null &&
    !desativado &&
    !!(alvo.taskId || alvo.listId || alvo.conversationId);
  const fechar = () => setConsulta(null);
  const opcoes = filtrarMencionaveis(pessoas, consulta ?? '');

  useEffect(() => {
    if (!aberto) return;
    let vivo = true; setCarregando(true); setErro(false); setPessoas([]);
    void api.pessoasParaMencionar(alvo).then((r) => { if (vivo) setPessoas(r.people); })
      .catch(() => { if (vivo) setErro(true); }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // Os nomes são filtrados localmente; trocar a lista refaz a consulta de acesso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, alvo.taskId, alvo.listId, alvo.conversationId]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setConsulta(null);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [aberto, ref]);

  const olhar = () => {
    if (desativado || !(alvo.taskId || alvo.listId || alvo.conversationId)) return;
    const sel = window.getSelection(); const el = ref.current;
    if (!sel?.rangeCount || !el) return fechar();
    const r = sel.getRangeAt(0); const no = r.startContainer;
    if (!r.collapsed || !el.contains(no) || no.nodeType !== 3 || no.parentElement?.closest('[data-mention-id]')) return fechar();
    const antes = (no.nodeValue ?? '').slice(0, r.startOffset);
    const m = /(?:^|[\s(])@([^@\n]{0,60})$/.exec(antes);
    if (!m) return fechar();
    const alcance = r.cloneRange(); alcance.setStart(no, r.startOffset - m[1].length - 1);
    intervalo.current = alcance;
    const rect = r.getBoundingClientRect(); const caixa = el.getBoundingClientRect();
    setPosicao({ left: Math.max(8, Math.min(rect.x || caixa.x, window.innerWidth - 290)),
      top: Math.max(8, Math.min(rect.bottom || caixa.bottom, window.innerHeight - 270)) });
    setConsulta(m[1]); setIndice(0);
  };
  const escolher = (p: PessoaMencionavel) => {
    const r = intervalo.current; const el = ref.current;
    if (!r || !el?.contains(r.startContainer) || desativado) return fechar();
    el.focus(); r.deleteContents();
    const fragmento = document.createDocumentFragment(); const espaco = document.createTextNode('\u00a0');
    fragmento.append(noDeMencao(p, document), espaco); r.insertNode(fragmento);
    r.setStart(espaco, 1); r.collapse(true);
    const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    fechar(); aoMudar();
  };
  const teclas = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!aberto || e.nativeEvent.isComposing) return false;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return false;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') fechar();
    else if (e.key === 'ArrowDown') setIndice((i) => Math.max(0, Math.min(i + 1, opcoes.length - 1)));
    else if (e.key === 'ArrowUp') setIndice((i) => Math.max(i - 1, 0));
    else if (opcoes[indice]) escolher(opcoes[indice]);
    return true;
  };
  const menu = aberto && createPortal(<div ref={menuRef} id={menuId} className="mencoes-menu" role="listbox"
    aria-label="Pessoas com acesso" style={posicao}>
    {carregando ? <p role="status">Carregando pessoas…</p> : erro ? <p role="status">Não foi possível carregar as pessoas. Digite @ novamente.</p> : opcoes.length === 0 ? <p role="status">Nenhuma pessoa com esse nome e acesso.</p> : opcoes.map((p, i) =>
      <button type="button" role="option" id={`${menuId}-${i}`} aria-selected={i === indice} key={p.id}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); escolher(p); }}><span className="mencao-avatar">{p.name.slice(0, 1)}</span>{p.name}</button>)}
  </div>, document.body);
  return { olhar, teclas, menu, aberto, menuId, ativoId: aberto && opcoes[indice] ? `${menuId}-${indice}` : undefined };
}
