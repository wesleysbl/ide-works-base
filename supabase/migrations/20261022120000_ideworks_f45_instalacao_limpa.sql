-- =============================================================================
-- IDEWORKS: F45  Instalação limpa
-- =============================================================================
-- Num projeto NOVO do Supabase, sem sistema anterior no mesmo banco, falta um
-- balde que o histórico do cliente usa: `client-history-documents`. No banco
-- onde o IdeWorks nasceu ele já existia (era do sistema anterior). Aqui ele é
-- criado PRIVADO, se ainda não existir; quem lê os arquivos é o servidor, que
-- assina um endereço de vida curta depois de conferir quem pode ver o cliente
-- (ver `src/server/history.ts` e a política da F17.52).
--
-- Num banco onde o balde já existe, nada muda: `on conflict do nothing`.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('client-history-documents', 'client-history-documents', false)
on conflict (id) do nothing;
