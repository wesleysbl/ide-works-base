/**
 * A CONTA DE "ONDE O MENU CABE" — F17.35.
 *
 * Ela se prova aqui, sem navegador, porque é aritmética pura. O que só existe
 * com janela — a barra que aparece, a rolagem do item focado, o balão por cima
 * do cartão — está em `scripts/provar-menu-que-cabe.mjs`, no Chrome de verdade.
 *
 * ⚠️ OS NÚMEROS DE `caso real` NÃO SÃO INVENTADOS. Saíram da medida de antes,
 * em Chrome a 1280×720: `Mover a lista para…` abria em y=529 com 333px e
 * terminava em 861 — 141px fora da tela.
 */

import { describe, expect, it } from 'vitest';

import {
  MARGEM,
  TETO_MINIMO,
  alturaDesejada,
  deslocamentoParaCaber,
  ondeCabe,
  tetoDaLista,
} from '@/ui/teto';

const janela = { largura: 1280, altura: 720 };
const caixa = (top: number, altura = 24, left = 40, largura = 24) => ({
  top,
  bottom: top + altura,
  left,
  right: left + largura,
});

describe('ondeCabe — o teto', () => {
  it('o caso real da etapa: âncora a 505, janela de 720, teto que não passa da borda', () => {
    // A âncora do `···` da última lista da árvore ficava por volta de y=505..524
    // e x=230..254, dentro da barra; o balão nascia em 529 e ia até 861 numa
    // janela de 720.
    const r = ondeCabe(caixa(505, 19, 230, 24), janela, 'baixo-direita', 208);
    expect(r.lado).toBe('baixo-direita');
    // 720 − 524 − 5 − 8 = 183
    expect(r.teto).toBe(183);
    // A promessa: o balão termina DENTRO da janela.
    expect(524 + 5 + r.teto).toBeLessThanOrEqual(janela.altura - MARGEM);
  });

  it('o teto é o espaço que existe, e ele muda com a janela', () => {
    const baixa = ondeCabe(caixa(300), { largura: 1280, altura: 720 }, 'baixo', 208);
    const alta = ondeCabe(caixa(300), { largura: 1280, altura: 1200 }, 'baixo', 208);
    expect(baixa.teto).toBe(383);
    expect(alta.teto).toBe(863);
    // O ponto da etapa: o mesmo menu, na mesma posição, tem tetos diferentes.
    expect(alta.teto).toBeGreaterThan(baixa.teto);
  });

  it('nunca passa da janela inteira, nem com a âncora no topo', () => {
    const r = ondeCabe(caixa(0, 0), janela, 'baixo', 208);
    expect(r.teto).toBeLessThanOrEqual(janela.altura - 2 * MARGEM);
  });
});

describe('ondeCabe — o lado', () => {
  it('mantém o lado pedido quando ali há menu que se use', () => {
    expect(ondeCabe(caixa(100), janela, 'baixo', 208).lado).toBe('baixo');
    expect(ondeCabe(caixa(600), janela, 'cima', 208).lado).toBe('cima');
  });

  it('vira para cima quando embaixo não sobra menu nenhum', () => {
    // Âncora colada no pé: 720 − 700 − 5 − 8 = 7px embaixo, 663 em cima.
    const r = ondeCabe(caixa(680, 20), janela, 'baixo', 208);
    expect(r.lado).toBe('cima');
    expect(r.teto).toBe(667);
  });

  it('vira para baixo quando em cima não sobra menu nenhum', () => {
    const r = ondeCabe(caixa(10, 20), janela, 'cima', 208);
    expect(r.lado).toBe('baixo');
  });

  it('quando não cabe dos dois lados, escolhe o lado maior', () => {
    const apertada = { largura: 1280, altura: 240 };
    // 100..124: em cima 87, embaixo 103. O pedido é `cima`, e o maior é embaixo.
    const r = ondeCabe(caixa(100), apertada, 'cima', 208);
    expect(r.lado).toBe('baixo');
    // E mesmo assim ninguém devolve uma fresta.
    expect(r.teto).toBeGreaterThanOrEqual(TETO_MINIMO);
  });

  it('preserva o alinhamento horizontal pedido quando ele cabe', () => {
    expect(ondeCabe(caixa(100, 24, 40, 24), janela, 'baixo', 208).lado).toBe('baixo');
    expect(ondeCabe(caixa(100, 24, 600, 24), janela, 'baixo-direita', 208).lado).toBe(
      'baixo-direita',
    );
  });

  it('alinha pela outra ponta quando o menu encostaria na borda da direita', () => {
    // Âncora a 1200..1224 num 1280: alinhado à esquerda, o menu de 208 iria a 1408.
    const r = ondeCabe(caixa(100, 24, 1200, 24), janela, 'baixo', 208);
    expect(r.lado).toBe('baixo-direita');
  });

  it('alinha pela esquerda quando alinhar pela direita sairia pela borda de lá', () => {
    const r = ondeCabe(caixa(100, 24, 10, 24), janela, 'baixo-direita', 208);
    expect(r.lado).toBe('baixo');
  });

  it('sem largura medida — o primeiro quadro — não mexe no eixo horizontal', () => {
    expect(ondeCabe(caixa(100, 24, 1200, 24), janela, 'baixo', 0).lado).toBe('baixo');
  });
});

describe('ondeCabe — o espaço devolvido', () => {
  it('conta folga e margem dos dois lados', () => {
    const r = ondeCabe(caixa(300, 20), janela, 'baixo', 208);
    expect(r.abaixo).toBe(720 - 320 - 5 - 8);
    expect(r.acima).toBe(300 - 5 - 8);
  });
});

describe('tetoDaLista — a lista de `Menu` e `Gaveta`', () => {
  it('desconta a moldura do balão: busca, cabeçalho e o `Limpar` do pé', () => {
    // Balão começando em 300 numa janela de 720, com 76px de moldura.
    expect(tetoDaLista(300, 720, 76)).toBe(720 - 300 - MARGEM - 76);
  });

  it('nunca devolve uma fresta', () => {
    expect(tetoDaLista(700, 720, 76)).toBe(TETO_MINIMO);
  });

  it('cresce com a janela — é o defeito do `max-h-64` que ela conserta', () => {
    // `max-h-64` são 16rem = 256px, iguais nas duas telas. Um balão que começa
    // em y=430 tem 242px numa tela de 720 — e 722px numa de 1200.
    expect(tetoDaLista(430, 720, 40)).toBeLessThan(256);
    expect(tetoDaLista(430, 1200, 40)).toBeGreaterThan(256);
  });
});

describe('ondeCabe — a altura desejada decide o lado', () => {
  it('o menu grande vira para o lado onde ele cabe INTEIRO', () => {
    // O caso medido: âncora a 505..524 numa janela de 720. Embaixo há 183px,
    // em cima 492. Um menu de 450px cabe só em cima.
    const r = ondeCabe(caixa(505, 19, 230, 24), janela, 'baixo-direita', 208, 450);
    expect(r.lado).toBe('cima-direita');
    expect(r.teto).toBe(492);
  });

  it('o menu pequeno fica onde foi pedido, mesmo com mais espaço do outro lado', () => {
    // Menu não vira só porque sobra mais do outro lado: virar sem motivo é
    // pior do que ficar — a pessoa aprende onde o menu abre.
    const r = ondeCabe(caixa(505, 19, 230, 24), janela, 'baixo-direita', 208, 150);
    expect(r.lado).toBe('baixo-direita');
  });

  it('sem altura conhecida — o primeiro quadro — decide só pelo espaço', () => {
    expect(ondeCabe(caixa(505, 19, 230, 24), janela, 'baixo-direita', 208, 0).lado).toBe(
      'baixo-direita',
    );
  });

  it('quando não cabe inteiro em lado nenhum, vai para o lado maior', () => {
    const r = ondeCabe(caixa(505, 19, 230, 24), janela, 'baixo-direita', 208, 900);
    expect(r.lado).toBe('cima-direita');
    expect(r.teto).toBe(492);
  });
});

describe('alturaDesejada — a conta que não se alimenta do próprio efeito', () => {
  it('soma à altura corrente tudo o que sobrou de fora', () => {
    expect(alturaDesejada({ altura: 389, sobraDoBalao: 0, sobraDaLista: 158 })).toBe(547);
  });

  it('não se move quando o teto encolhe — é a propriedade que a torna estável', () => {
    // O mesmo menu com três tetos diferentes: o que sobra de fora cresce
    // exatamente o que a altura encolhe.
    const a = alturaDesejada({ altura: 547, sobraDoBalao: 0, sobraDaLista: 0 });
    const b = alturaDesejada({ altura: 389, sobraDoBalao: 0, sobraDaLista: 158 });
    const c = alturaDesejada({ altura: 200, sobraDoBalao: 47, sobraDaLista: 300 });
    expect(a).toBe(547);
    expect(b).toBe(547);
    expect(c).toBe(547);
  });

  it('conta a sobra do balão inteiro, e não só a da lista de dentro', () => {
    // O menu sem `.cu-rolagem` nenhuma: quem rola é o balão.
    expect(alturaDesejada({ altura: 180, sobraDoBalao: 28, sobraDaLista: 0 })).toBe(208);
  });
});

describe('ondeCabe — o defeito medido do menu que troca de conteúdo', () => {
  it('o menu de dez destinos vira para cima onde o de cinco itens ficava embaixo', () => {
    // Medido a 1280×1200 com a âncora em 798: embaixo 389, em cima 790.
    const ancora = { top: 780, bottom: 798, left: 230, right: 254 };
    const alta = { largura: 1280, altura: 1200 };
    // Com a altura herdada do menu pequeno (208) ele ficava embaixo…
    expect(ondeCabe(ancora, alta, 'baixo-direita', 208, 208).lado).toBe('baixo-direita');
    // …e com a altura que ele de fato quer (547) ele vai para onde cabe.
    const r = ondeCabe(ancora, alta, 'baixo-direita', 208, 547);
    expect(r.lado).toBe('cima-direita');
    expect(r.teto).toBe(767);
  });
});

describe('deslocamentoParaCaber — o calendário que abre fora da tela (F27)', () => {
  it('o caso medido: 390px, botão terminando em x=195, balão de 288 — anda até a margem', () => {
    // Alinhado à direita do botão, o balão começava em 195 - 288 = -93.
    const d = deslocamentoParaCaber(195, 288, 390);
    expect(195 - 288 + d).toBe(MARGEM);
    expect(195 + d).toBeLessThanOrEqual(390 - MARGEM);
  });

  it('no desktop, onde já cabe, não se mexe', () => {
    expect(deslocamentoParaCaber(1100, 288, 1280)).toBe(0);
  });

  it('encostado na direita da janela, volta para dentro', () => {
    const d = deslocamentoParaCaber(1279, 288, 1280);
    expect(1279 + d).toBe(1280 - MARGEM);
  });

  it('janela mais estreita que o balão: encosta na margem esquerda', () => {
    const d = deslocamentoParaCaber(200, 288, 280);
    expect(200 - 288 + d).toBe(MARGEM);
  });
});
