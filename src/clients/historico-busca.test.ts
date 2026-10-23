import { describe, expect, it } from 'vitest';

import { filtrarEventos } from '@/clients/historico-busca';
import type { Evento } from '@/clients/Historico';

const ev = (p: Partial<Evento> & { id: string }): Evento => ({
  happenedOn: '2026-09-30',
  title: '',
  subtitle: null,
  body: '',
  ledBy: null,
  ledByNote: null,
  createdAt: '2026-09-30T12:00:00Z',
  documents: [],
  ...p,
});

const reuniao = ev({
  id: 'a',
  title: 'Alinhamento Banners Outubro',
  body: 'Cliente apresentou os pontos. Site, Shopee e Mercado Livre',
  ledBy: { id: 'h', name: 'Helena' },
});
const outra = ev({ id: 'b', title: 'Reunião de renovação', happenedOn: '2026-03-10', body: 'Contrato Full' });
const todos = [reuniao, outra];

describe('filtrarEventos', () => {
  it('sem busca devolve tudo', () => {
    expect(filtrarEventos(todos, '')).toHaveLength(2);
    expect(filtrarEventos(todos, '   ')).toHaveLength(2);
  });
  it('acha no título, no corpo e em quem conduziu', () => {
    expect(filtrarEventos(todos, 'banners').map((e) => e.id)).toEqual(['a']);
    expect(filtrarEventos(todos, 'shopee').map((e) => e.id)).toEqual(['a']);
    expect(filtrarEventos(todos, 'helena').map((e) => e.id)).toEqual(['a']);
  });
  it('ignora acento e maiúscula', () => {
    expect(filtrarEventos(todos, 'REUNIAO').map((e) => e.id)).toEqual(['b']);
    expect(filtrarEventos(todos, 'renovacao').map((e) => e.id)).toEqual(['b']);
  });
  it('várias palavras valem todas, em qualquer ordem', () => {
    expect(filtrarEventos(todos, 'outubro banners').map((e) => e.id)).toEqual(['a']);
    expect(filtrarEventos(todos, 'outubro contrato')).toHaveLength(0);
  });
  it('acha pela data escrita como o usuário lê', () => {
    expect(filtrarEventos(todos, '10/03/2026').map((e) => e.id)).toEqual(['b']);
  });
  it('acha pelo nome do documento', () => {
    const comDoc = ev({
      id: 'c',
      title: 'Ata',
      documents: [{ id: 'd', fileName: 'Ata-Setembro.pdf', mimeType: null, sizeBytes: null, uploadedAt: '' }],
    });
    expect(filtrarEventos([comDoc], 'setembro').map((e) => e.id)).toEqual(['c']);
  });
});
