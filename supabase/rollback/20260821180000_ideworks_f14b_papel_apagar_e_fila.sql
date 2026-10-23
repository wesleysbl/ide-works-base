-- Desfaz a F14b: some a hierarquia nas funcoes, o apagar e a fila.
drop function if exists ideworks.revoke_invitation(uuid);
drop function if exists ideworks.admin_pending_invitations();
drop function if exists ideworks.admin_user_categories(uuid);
drop function if exists ideworks.delete_user(uuid);
drop function if exists ideworks.set_user_role(uuid, ideworks.papel, boolean);
