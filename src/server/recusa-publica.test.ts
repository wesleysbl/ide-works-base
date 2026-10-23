/**
 * O texto interno do Postgres não chega a quem pediu — revisão de segurança de 09/10/2026.
 *
 * Uma política de linha ou um `grant` que falta responde em inglês, com o nome da
 * tabela, da função ou da restrição (e o valor duplicado). Isso é mapa do esquema
 * para quem ataca e ruído para quem trabalha. As frases que o banco escreve
 * DE PROPÓSITO para gente continuam passando inteiras.
 */
import { describe, expect, it } from 'vitest';

import { frasePublicaDaRecusa } from '@/server/recusas';

describe('frasePublicaDaRecusa', () => {
  it.each([
    'new row violates row-level security policy for table "mural_notes"',
    'new row violates row-level security policy (USING expression) for table "tasks"',
    'permission denied for function set_user_areas',
    'permission denied for table profiles',
    'permission denied for schema ideworks',
    'must be owner of function ideworks.set_user_areas',
  ])('permissão: %s', (frase) => {
    const publica = frasePublicaDaRecusa(frase);
    expect(publica).toBe('Você não tem permissão para esta ação.');
    expect(publica).not.toMatch(/mural_notes|tasks|profiles|ideworks|set_user_areas/);
  });

  it.each([
    'duplicate key value violates unique constraint "client_links_sem_duplicata"',
    'new row for relation "tasks" violates check constraint "tasks_title_not_blank"',
    'insert or update on table "tasks" violates foreign key constraint "tasks_client_id_fkey"',
    'null value in column "title" of relation "tasks" violates not-null constraint',
    'invalid input syntax for type uuid: "abc"',
    'value too long for type character varying(160)',
    'integer out of range',
    'deadlock detected',
  ])('dado recusado: %s', (frase) => {
    const publica = frasePublicaDaRecusa(frase);
    expect(publica).toMatch(/confira os campos/i);
    expect(publica).not.toMatch(/tasks|constraint|uuid|abc|varying|client_links|title/i);
  });

  it.each([
    'so super admin cria outro super admin',
    'Você não pode tirar o próprio papel de administrador.',
    'A tarefa “Post 01” está na etapa “A fazer” da esteira “Conteúdo”.',
    'cliente nao encontrado ou fora do seu alcance',
    'Só o super admin escolhe a empresa da descoberta.',
  ])('a frase escrita para gente passa inteira: %s', (frase) => {
    expect(frasePublicaDaRecusa(frase)).toBe(frase);
  });
});
