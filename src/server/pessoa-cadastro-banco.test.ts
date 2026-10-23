import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
const db = new PGlite();
const superId = '00000000-0000-4000-8000-000000000001';
const alvo = '00000000-0000-4000-8000-000000000002';
const admin = '00000000-0000-4000-8000-000000000003';
const cmd = (extra = {}) => ({ request_id: crypto.randomUUID(), actor_id: superId, nome: 'Novo nome', email: 'novo@example.invalid', anterior: { nome: 'Nome', email: 'velho@example.invalid' }, ...extra });
const salvar = (comando = cmd()) => db.query(`update auth.users set email=$1, raw_app_meta_data=jsonb_build_object('ideworks_profile_edit',$2::jsonb) where id=$3`, [comando.email, JSON.stringify(comando), alvo]);
const perfil = async () => (await db.query(`select * from ideworks.profiles where id=$1`, [alvo])).rows[0];
beforeAll(async () => {
  await db.exec(`create schema auth; create schema ideworks;
    create role anon; create role authenticated; create role ideworks_app;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
    create table ideworks.profiles(id uuid primary key,email text,full_name text,is_active boolean default true,role text,updated_at timestamptz);
    create table ideworks.invitations(email text,status text);
    create table ideworks.admin_audit(actor_id uuid,actor_email text,action text,target_id uuid,target_email text,context jsonb);`);
  await db.exec(readFileSync('supabase/migrations/20260930120000_ideworks_f35_editar_cadastro.sql','utf8'));
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec(`truncate auth.users,ideworks.profiles,ideworks.invitations,ideworks.admin_audit;
    insert into ideworks.profiles(id,email,full_name,role) values
    ('${superId}','super@example.invalid','Super','super_admin'),('${alvo}','velho@example.invalid','Nome','funcionario'),('${admin}','admin@example.invalid','Admin','admin');
    insert into auth.users(id,email) values ('${alvo}','velho@example.invalid');
    insert into ideworks.invitations values ('velho@example.invalid','pending');`);
});
describe('transação do cadastro e login', () => {
  it('aplica nome/e-mail, audita e revoga códigos antigos', async () => {
    await salvar(); expect(await perfil()).toMatchObject({ full_name: 'Novo nome', email: 'novo@example.invalid', role: 'funcionario', is_active: true });
    expect((await db.query('select status from ideworks.invitations')).rows).toEqual([{ status: 'revoked' }]);
    expect((await db.query('select action,actor_id from ideworks.admin_audit')).rows).toEqual([{ action: 'edit_profile', actor_id: superId }]);
  });
  it('administrador comum não altera nem o e-mail do Auth', async () => {
    await expect(salvar(cmd({ actor_id: admin }))).rejects.toThrow('superadministrador');
    expect((await db.query('select email from auth.users')).rows).toEqual([{ email: 'velho@example.invalid' }]);
    expect(await perfil()).toMatchObject({ full_name: 'Nome' });
  });
  it('super desativado é recusado no banco', async () => {
    await db.query('update ideworks.profiles set is_active=false where id=$1',[superId]);
    await expect(salvar()).rejects.toThrow('superadministrador');
  });
  it('snapshot antigo desfaz Auth e não sobrescreve outra edição', async () => {
    await salvar(); await expect(salvar(cmd({ nome: 'Sobrescrito', email: 'outro@example.invalid' }))).rejects.toThrow('cadastro mudou');
    expect(await perfil()).toMatchObject({ full_name: 'Novo nome', email: 'novo@example.invalid' });
    expect((await db.query('select email from auth.users')).rows).toEqual([{ email: 'novo@example.invalid' }]);
  });
  it('email duplicado e nome inválido desfazem a transação', async () => {
    await expect(salvar(cmd({ email: 'admin@example.invalid' }))).rejects.toThrow('utilizado');
    await expect(salvar(cmd({ nome: '' }))).rejects.toThrow('inválido');
    expect(await perfil()).toMatchObject({ email: 'velho@example.invalid' });
  });
  it('user_metadata e mudanças comuns no Auth não autorizam editar perfil', async () => {
    await db.query(`update auth.users set raw_user_meta_data=$1::jsonb,raw_app_meta_data='{"provider":"email"}' where id=$2`,[JSON.stringify({ ideworks_profile_edit: cmd() }),alvo]);
    expect(await perfil()).toMatchObject({ full_name: 'Nome' });
    expect((await db.query('select * from ideworks.admin_audit')).rows).toEqual([]);
  });
  it('repetição com novo request_id é idempotente', async () => {
    await salvar(); await salvar(); expect((await db.query('select * from ideworks.admin_audit')).rows).toHaveLength(1);
  });
  it('função de privilégio elevado não é executável diretamente pela aplicação', async () => {
    const r = await db.query(`select has_function_privilege('ideworks_app','ideworks.apply_profile_edit()','EXECUTE') as allowed`);
    expect(r.rows).toEqual([{ allowed: false }]);
  });
});
