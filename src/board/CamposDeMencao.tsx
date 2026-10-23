import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { ContextoDeMencoes, lerCampoComMencoes, noDeMencao, partesDeMencoes, type AlvoDeMencoes } from '@/board/mencoes';
import { useMencoes } from '@/board/use-mencoes';
import '@/ui/mencoes.css';

export function ProvedorDeMencoes({ children, ...alvo }: AlvoDeMencoes & { children: ReactNode }) {
  return <ContextoDeMencoes.Provider value={alvo}>{children}</ContextoDeMencoes.Provider>;
}
export function TextoComMencoes({ texto }: { texto: string }) {
  return <>{partesDeMencoes(texto).map((p, i) => typeof p === 'string' ? p : <span key={i} className="mencao">@{p.name}</span>)}</>;
}
type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  value: string; aoMudar: (valor: string) => void; disabled?: boolean;
  placeholder?: string; autoFocus?: boolean; maxLength?: number; rows?: number; umaLinha?: boolean;
};
export function CampoComMencoes({ value, aoMudar, disabled, placeholder, autoFocus, maxLength, rows, umaLinha,
  onKeyDown, onPaste, onInput, onKeyUp, onClick, className = '', ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mudar = () => {
    if (!ref.current) return;
    let valor = lerCampoComMencoes(ref.current);
    if (umaLinha) valor = valor.replace(/\n/g, ' ');
    aoMudar(valor);
  };
  const mencoes = useMencoes(ref, mudar, disabled);
  useLayoutEffect(() => {
    const el = ref.current; if (!el || lerCampoComMencoes(el) === value) return;
    el.replaceChildren(...partesDeMencoes(value).map((p) => typeof p === 'string' ? document.createTextNode(p) : noDeMencao(p, document)));
  }, [value]);
  useLayoutEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return <>
    <div {...props} ref={ref} role="textbox" aria-multiline={!umaLinha} aria-disabled={disabled || undefined}
      aria-autocomplete="list" aria-controls={mencoes.aberto ? mencoes.menuId : undefined}
      /* Sem `aria-expanded`: o papel `textbox` não o aceita (ARIA 1.2) e o leitor
         de tela o ignorava. Que o menu de menções está aberto já é dito por
         `aria-controls` + `aria-activedescendant`, que o `textbox` aceita. */
      aria-activedescendant={mencoes.ativoId} contentEditable={!disabled} suppressContentEditableWarning
      className={`campo-com-mencoes ${className}`} data-placeholder={placeholder} data-vazio={value === ''}
      style={{ minHeight: rows ? `${rows * 1.5 + 0.8}em` : undefined, ...props.style }}
      onInput={(e) => { mudar(); mencoes.olhar(); onInput?.(e); }}
      onKeyUp={(e) => { if (!['ArrowUp', 'ArrowDown', 'Escape', 'Enter', 'Tab'].includes(e.key)) mencoes.olhar(); onKeyUp?.(e); }}
      onClick={(e) => { mencoes.olhar(); onClick?.(e); }}
      onKeyDown={(e) => {
        if (mencoes.teclas(e)) return;
        onKeyDown?.(e);
        if (umaLinha && e.key === 'Enter') e.preventDefault();
        if (maxLength && value.length >= maxLength && e.key.length === 1 && !e.ctrlKey && !e.metaKey) e.preventDefault();
      }}
      onPaste={(e) => {
        onPaste?.(e); if (e.defaultPrevented) return;
        e.preventDefault();
        const texto = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, umaLinha ? texto.replace(/\n/g, ' ') : texto);
        mudar(); mencoes.olhar();
      }} />
    {mencoes.menu}
  </>;
}
