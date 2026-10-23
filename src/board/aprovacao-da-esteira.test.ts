/**
 * "APROVAÇÃO DO CLIENTE" NA ESTEIRA — F42, Fase 3.
 *
 * As regras puras (`aprovacao-da-esteira.ts`) e a caixa desenhada no servidor
 * (`PainelDosDestinos`): o caminho do card, os três seletores só com etapas
 * desta esteira, completa × incompleta. Salvar e recarregar é o e2e.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PainelDosDestinos } from '@/board/AprovacaoDaEsteira';
import {
  DESTINOS_VAZIOS,
  avisoDeHeranca,
  destinosRepetidos,
  fraseDaSituacao,
  mesmosDestinos,
  nomeDaEtapa,
  situacaoDosDestinos,
} from '@/board/aprovacao-da-esteira';
import type { Destinos, DestinosDaEsteira } from '@/server/aprovacao-config';

const ETAPAS = [
  { id: 'e1', name: 'a fazer', type: 'open', color: null },
  { id: 'e2', name: 'aguardando cliente', type: 'custom', color: null },
  { id: 'e3', name: 'aprovado', type: 'custom', color: null },
  { id: 'e4', name: 'refação', type: 'custom', color: null },
];
const COMPLETOS: Destinos = { awaitingStatusId: 'e2', approvedStatusId: 'e3', rejectedStatusId: 'e4' };

const dados = (targets: Destinos = DESTINOS_VAZIOS, o: Partial<DestinosDaEsteira> = {}): DestinosDaEsteira => ({
  listId: 'l1',
  statusSetId: 's1',
  statusSetName: 'Fluxo de criação',
  inheritedFrom: 'folder',
  statuses: ETAPAS,
  targets,
  complete: situacaoDosDestinos(targets).tipo === 'completa',
  ...o,
});

const tela = (d: DestinosDaEsteira, escolha: Destinos = d.targets, extra = {}) =>
  renderToStaticMarkup(
    createElement(PainelDosDestinos, { dados: d, escolha, aoEscolher: () => {}, aoSalvar: () => {}, ...extra }),
  );

describe('as regras', () => {
  it('situação: vazia, incompleta com o que falta, completa', () => {
    expect(situacaoDosDestinos(DESTINOS_VAZIOS)).toEqual({ tipo: 'vazia' });
    expect(situacaoDosDestinos({ ...DESTINOS_VAZIOS, awaitingStatusId: 'e2' })).toEqual({
      tipo: 'incompleta',
      faltando: ['Aprovado', 'Reprovado (refação)'],
    });
    expect(situacaoDosDestinos(COMPLETOS)).toEqual({ tipo: 'completa' });
    expect(fraseDaSituacao({ tipo: 'incompleta', faltando: ['Aprovado'] })).toBe('Incompleta: falta escolher Aprovado.');
  });

  it('nome da etapa: o da esteira, ou nulo se não escolhida ou se sumiu', () => {
    expect(nomeDaEtapa(ETAPAS, 'e3')).toBe('aprovado');
    expect(nomeDaEtapa(ETAPAS, null)).toBeNull();
    expect(nomeDaEtapa(ETAPAS, 'apagada')).toBeNull();
  });

  it('"aguardando" repetido é recusado; aprovado = reprovado não é assunto desta regra', () => {
    expect(destinosRepetidos({ ...COMPLETOS, approvedStatusId: 'e2' })).toBe(true);
    expect(destinosRepetidos({ ...COMPLETOS, rejectedStatusId: 'e2' })).toBe(true);
    expect(destinosRepetidos(COMPLETOS)).toBe(false);
    expect(destinosRepetidos(DESTINOS_VAZIOS)).toBe(false);
  });

  it('o aviso de herança diz quem mais a configuração alcança', () => {
    expect(avisoDeHeranca('folder')).toMatch(/todas as listas da pasta/);
    expect(avisoDeHeranca('list')).toMatch(/só para ela/);
    expect(mesmosDestinos(COMPLETOS, { ...COMPLETOS })).toBe(true);
    expect(mesmosDestinos(COMPLETOS, DESTINOS_VAZIOS)).toBe(false);
  });
});

describe('a caixa desenhada', () => {
  it('vazia: o caminho mostra "falta escolher" nos três passos e a situação é incompleta', () => {
    const html = tela(dados());
    expect(html).toContain('aria-label="Caminho do card na aprovação do cliente"');
    expect(html.match(/falta escolher/g)?.length).toBe(3);
    expect(html).toContain('data-situacao="vazia"');
    expect(html).toContain('Incompleta: escolha as três etapas');
  });

  it('três seletores, cada um com SÓ as etapas desta esteira, mais a opção vazia', () => {
    const html = tela(dados());
    expect(html.match(/<select/g)?.length).toBe(3);
    for (const rotulo of ['Etapa de Aguardando cliente', 'Etapa de Aprovado', 'Etapa de Reprovado (refação)']) {
      expect(html).toContain(`aria-label="${rotulo}"`);
    }
    // 4 etapas + "escolher" em cada um dos 3.
    expect(html.match(/<option/g)?.length).toBe(15);
  });

  it('completa: o caminho mostra o nome de cada etapa e a situação diz completa', () => {
    const html = tela(dados(COMPLETOS));
    expect(html).not.toContain('falta escolher');
    expect(html).toContain('aguardando cliente');
    expect(html).toContain('data-situacao="completa"');
    expect(html).toContain('Configuração completa');
    // As escolhas aparecem selecionadas.
    expect(html).toMatch(/<option value="e2" selected/);
    expect(html).toMatch(/<option value="e4" selected/);
  });

  it('salvar só se habilita quando a escolha mudou e não repete "aguardando"', () => {
    const salvar = (html: string) => /<button[^>]*disabled[^>]*>Salvar destinos/.test(html);
    expect(salvar(tela(dados(COMPLETOS)))).toBe(true); // nada mudou
    expect(salvar(tela(dados(), COMPLETOS))).toBe(false); // mudou: habilita
    const repetido = tela(dados(), { ...COMPLETOS, approvedStatusId: 'e2' });
    expect(salvar(repetido)).toBe(true);
    expect(repetido).toContain('role="alert"');
  });

  it('a esteira e de onde ela vem aparecem no topo', () => {
    const html = tela(dados());
    expect(html).toContain('Fluxo de criação');
    expect(html).toContain('A esteira vem da pasta');
  });

  it('a recusa do servidor aparece inteira', () => {
    const html = tela(dados(), COMPLETOS, { falha: 'Cada destino da aprovação tem de ser uma etapa desta mesma esteira.' });
    expect(html).toContain('etapa desta mesma esteira');
  });
});
