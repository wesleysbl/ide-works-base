import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { editarCadastro } from './pessoa-cadastro';
import type { Sql } from './db';
import type { AuthenticatedActor } from './session';
vi.mock('@/server/db', () => ({ withActor: (sql: unknown, _ator: unknown, run: (tx: unknown) => unknown) => run(sql), arrayOuNulo: (v: unknown) => v }));
const ator = { userId: '00000000-0000-4000-8000-000000000001', isSuper: true, isSuperadmin: true, papel: 'super_admin' } as AuthenticatedActor;
const provider = { url: 'https://auth.example.invalid', anonKey: 'public-test', serviceKey: 'server-test', testAccountsOnly: false };
const dados = { nome: 'Novo nome', email: 'novo@example.invalid', anterior: { nome: 'Nome', email: 'velho@example.invalid' } };
const db = vi.fn();
const http = vi.fn();
beforeEach(() => { db.mockResolvedValue([{ id: 'alvo', full_name: 'Nome', email: 'velho@example.invalid', pronto: true }]); http.mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', http); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const salvar = (body: unknown = dados, actor = ator, prov = provider) => editarCadastro(db as unknown as Sql, actor, prov, 'alvo', body);
describe('edição de cadastro', () => {
  it('recusa administrador comum antes de ler dados ou chamar o Auth', async () => {
    await expect(salvar(dados, { ...ator, isSuper: false })).rejects.toMatchObject({ status: 403 });
    expect(db).not.toHaveBeenCalled(); expect(http).not.toHaveBeenCalled();
  });
  it.each([{ ...dados, nome: ' ' }, { ...dados, email: 'errado' }, { ...dados, papel: 'super_admin' }, null])('recusa entrada inválida %j', async (body) => {
    await expect(salvar(body)).rejects.toMatchObject({ status: 400 }); expect(http).not.toHaveBeenCalled();
  });
  it('normaliza valores e envia comando protegido, sem senha nem user_metadata', async () => {
    await salvar({ ...dados, nome: ' Novo nome ', email: ' NOVO@example.invalid ' });
    const [url, options] = http.mock.calls[0]; const body = JSON.parse(options.body);
    expect(url).toBe(`${provider.url}/auth/v1/admin/users/alvo`);
    expect(body).toMatchObject({ email: dados.email, email_confirm: true, app_metadata: { ideworks_profile_edit: { nome: dados.nome, email: dados.email, actor_id: ator.userId, anterior: dados.anterior } } });
    expect(body).not.toHaveProperty('password'); expect(body).not.toHaveProperty('user_metadata');
  });
  it('não altera e-mail/confirmacao quando apenas o nome muda', async () => {
    await salvar({ ...dados, email: dados.anterior.email });
    const body = JSON.parse(http.mock.calls[0][1].body); expect(body).not.toHaveProperty('email'); expect(body).not.toHaveProperty('email_confirm');
  });
  it('recusa versão antiga e migration ausente antes de tocar no provedor', async () => {
    await expect(salvar({ ...dados, anterior: { ...dados.anterior, nome: 'Antigo' } })).rejects.toThrow('cadastro mudou');
    db.mockResolvedValue([{ full_name: 'Nome', email: dados.anterior.email, pronto: false }]);
    await expect(salvar()).rejects.toThrow('indisponível'); expect(http).not.toHaveBeenCalled();
  });
  it('trata repetição de salvamento já concluído sem nova escrita', async () => {
    db.mockResolvedValue([{ full_name: dados.nome, email: dados.email, pronto: true }]);
    await salvar(); expect(http).not.toHaveBeenCalled();
  });
  it('traduz email duplicado sem expor erro interno', async () => {
    http.mockResolvedValue(new Response(JSON.stringify({ code: 'email_exists' }), { status: 422 }));
    await expect(salvar()).rejects.toThrow('já está em uso');
  });
  it('resposta perdida não é sucesso nem afirma que nada mudou', async () => {
    http.mockRejectedValue(new Error('connection lost'));
    await expect(salvar()).rejects.toThrow('confirmar o salvamento');
  });
});
