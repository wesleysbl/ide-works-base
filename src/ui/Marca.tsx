/**
 * A marca Ide Works — F01 do plano UX.
 *
 * O lettering é o da arte fornecida (`docs/PLANOS/2026-09-27-23-30-15-ux_ideworks/referencias/02-marca-fornecida.png`,
 * preservada intacta), recortado e convertido em máscara transparente
 * (`public/ideworks-marca.png`, 874 × 160, 16 KB contra 1,38 MB do original).
 * Não é redesenho nem fonte parecida: é o mesmo desenho, sem o fundo.
 *
 * A cor das letras vem do tema (`--iw-marca-tinta`, ver `layout-foco.css`):
 * escura no claro, clara no escuro. Nada de `mix-blend-mode` nem inversão —
 * era o que deixava retângulo e halo quando o fundo não era o previsto.
 */
export function Marca({ className = '' }: { className?: string }) {
  return <span className={`iw-marca ${className}`.trim()} role="img" aria-label="Ide Works" />;
}
