import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_PADRAO, timeDaEscolha, indiceNaOrdem, rodadaDaEscolha, totalEscolhas, proximasEscolhas,
  sortearOrdem, resumoElenco, validarEscolha, escolhaAutomatica, gerarCSV,
} from '../js/draft.js';

const ORDEM20 = Array.from({ length: 20 }, (_, i) => `t${i + 1}`);
let seq = 0;
const atleta = (posicao, clubeId = 1, extra = {}) => ({ id: ++seq, apelido: `J${seq}`, posicao, clubeId, media: 0, preco: 0, ...extra });
const escolha = (a) => ({ atletaId: a.id, posicao: a.posicao, clubeId: a.clubeId });

test('serpentina com 20 times e 23 rodadas', () => {
  assert.equal(totalEscolhas(ORDEM20, CONFIG_PADRAO), 460);
  assert.equal(timeDaEscolha(0, ORDEM20), 't1');
  assert.equal(timeDaEscolha(19, ORDEM20), 't20');
  assert.equal(timeDaEscolha(20, ORDEM20), 't20'); // emenda duas escolhas
  assert.equal(timeDaEscolha(39, ORDEM20), 't1');
  assert.equal(timeDaEscolha(40, ORDEM20), 't1');
  assert.equal(timeDaEscolha(459, ORDEM20), 't20'); // rodada 23 (ímpar → direta)
  assert.equal(rodadaDaEscolha(459, 20), 23);
  // cada time escolhe exatamente 23 vezes
  const contagem = {};
  for (let n = 0; n < 460; n += 1) contagem[timeDaEscolha(n, ORDEM20)] = (contagem[timeDaEscolha(n, ORDEM20)] ?? 0) + 1;
  assert.ok(Object.values(contagem).every((c) => c === 23));
});

test('serpentina com 3 times e próximas escolhas', () => {
  const ordem = ['a', 'b', 'c'];
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((n) => timeDaEscolha(n, ordem)), ['a', 'b', 'c', 'c', 'b', 'a', 'a']);
  assert.equal(indiceNaOrdem(4, 3), 1);
  const cfg = { ...CONFIG_PADRAO, jogadores: 2 };
  assert.deepEqual(proximasEscolhas(4, ordem, cfg, 5), [{ n: 4, timeId: 'b' }, { n: 5, timeId: 'a' }]);
});

test('sortearOrdem embaralha sem perder ninguém', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const ordem = sortearOrdem(ids);
  assert.deepEqual([...ordem].sort(), ids);
  assert.deepEqual(sortearOrdem(ids, () => 0), ['b', 'c', 'd', 'e', 'a']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e']); // não altera a lista original
});

test('resumoElenco conta posições, clubes e vagas', () => {
  const elenco = [atleta('GOL', 1), atleta('GOL', 2), atleta('ATA', 1)].map(escolha);
  const r = resumoElenco(elenco, CONFIG_PADRAO);
  assert.equal(r.porPosicao.GOL, 2);
  assert.equal(r.porClube.get(1), 2);
  assert.equal(r.faltam.GOL, 0);
  assert.equal(r.faltam.ATA, 3);
  assert.equal(r.faltamTotal, 15); // 18 mínimos - 3 já cobertos
  assert.equal(r.restantes, 20);
  assert.equal(r.livres, 5);
});

test('limite de 4 jogadores por clube', () => {
  const elenco = [atleta('GOL', 9), atleta('LAT', 9), atleta('ZAG', 9), atleta('MEI', 9)].map(escolha);
  const r = validarEscolha(elenco, atleta('ATA', 9), CONFIG_PADRAO, { nomeClube: () => 'Flamengo' });
  assert.deepEqual(r, { ok: false, codigo: 'clube', motivo: 'Você já tem 4 jogadores do Flamengo' });
  assert.equal(validarEscolha(elenco, atleta('ATA', 10), CONFIG_PADRAO).ok, true);
});

test('jogador já escolhido e elenco completo', () => {
  const a = atleta('MEI');
  assert.equal(validarEscolha([], a, CONFIG_PADRAO, { ocupados: new Set([a.id]) }).codigo, 'ocupado');
  const cheio = Array.from({ length: 23 }, (_, i) => escolha(atleta(['GOL', 'LAT', 'ZAG', 'MEI', 'ATA'][i % 5], 100 + i)));
  assert.equal(validarEscolha(cheio, atleta('ATA', 500), CONFIG_PADRAO).codigo, 'completo');
});

test('mínimos por posição: guarda vagas até o fim', () => {
  // 5 escolhas livres gastas com meias: a 6ª precisa ser de posição que falta.
  const elenco = [];
  for (let i = 0; i < 9; i += 1) elenco.push(escolha(atleta('MEI', 200 + i)));
  // 9 MEI: 4 cobrem o mínimo, 5 usaram todas as vagas livres
  const r = validarEscolha(elenco, atleta('MEI', 300), CONFIG_PADRAO);
  assert.equal(r.codigo, 'minimos');
  assert.equal(r.motivo, 'Guarde as vagas: ainda faltam 2 GOL, 4 LAT, 4 ZAG e 4 ATA');
  assert.equal(validarEscolha(elenco, atleta('GOL', 300), CONFIG_PADRAO).ok, true);

  // última escolha: só a posição que falta é aceita
  const quase = [];
  const plano = { GOL: 2, LAT: 4, ZAG: 4, MEI: 8, ATA: 4 }; // 22 jogadores
  for (const [p, q] of Object.entries(plano)) for (let i = 0; i < q; i += 1) quase.push(escolha(atleta(p, 400 + quase.length)));
  assert.equal(quase.length, 22);
  assert.equal(validarEscolha(quase, atleta('GOL', 999), CONFIG_PADRAO).ok, true); // ainda há 1 livre
  const quase2 = quase.filter((e) => e.posicao !== 'ATA').concat([escolha(atleta('ATA', 900)), escolha(atleta('ATA', 901)), escolha(atleta('ATA', 902))]);
  // 2 GOL + 4 LAT + 4 ZAG + 8 MEI + 3 ATA = 21 → faltam 1 ATA, restam 2 vagas
  assert.equal(validarEscolha(quase2, atleta('MEI', 903), CONFIG_PADRAO).ok, true);
  const quase3 = [...quase2, escolha(atleta('MEI', 904))]; // 22, falta 1 ATA, resta 1
  assert.equal(validarEscolha(quase3, atleta('MEI', 905), CONFIG_PADRAO).codigo, 'minimos');
  assert.equal(validarEscolha(quase3, atleta('ATA', 906), CONFIG_PADRAO).ok, true);
});

test('escolha automática: fila primeiro, depois maior média e preço', () => {
  const craque = atleta('ATA', 1, { media: 9, preco: 20 });
  const bom = atleta('MEI', 2, { media: 7, preco: 15 });
  const empatado = atleta('ZAG', 3, { media: 7, preco: 18 });
  const daFila = atleta('LAT', 4, { media: 1, preco: 3 });
  const todos = [craque, bom, empatado, daFila];

  assert.deepEqual(escolhaAutomatica([], [daFila.id], todos, CONFIG_PADRAO), { atleta: daFila, daFila: true });
  // item da fila já escolhido por outro time → cai para o ranking
  assert.equal(escolhaAutomatica([], [daFila.id], todos, CONFIG_PADRAO, { ocupados: new Set([daFila.id]) }).atleta, craque);
  assert.equal(escolhaAutomatica([], [], todos, CONFIG_PADRAO, { ocupados: new Set([craque.id]) }).atleta, empatado);
});

test('escolha automática respeita mínimos e limite de clube', () => {
  const elenco = [];
  for (let i = 0; i < 9; i += 1) elenco.push(escolha(atleta('MEI', 600 + i)));
  const meiaTop = atleta('MEI', 700, { media: 10 });
  const goleiro = atleta('GOL', 701, { media: 2 });
  assert.equal(escolhaAutomatica(elenco, [meiaTop.id], [meiaTop, goleiro], CONFIG_PADRAO).atleta, goleiro);
  assert.equal(escolhaAutomatica(elenco, [], [meiaTop], CONFIG_PADRAO), null);
});

test('CSV com ponto e vírgula, BOM e aspas', () => {
  const csv = gerarCSV([
    { n: 1, timeId: 'b', apelido: 'Zé "Gol"', posicao: 'ATA', clubeId: 1, automatica: true },
    { n: 0, timeId: 'a', apelido: 'Ana', posicao: 'GOL', clubeId: 2, automatica: false },
  ], { nomeTime: (id) => (id === 'a' ? 'Time A' : 'Time; B'), nomeClube: (id) => `C${id}`, totalTimes: 2 });
  const linhas = csv.replace('﻿', '').trim().split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(linhas[0], 'Escolha;Rodada;Time;Jogador;Posição;Clube;Automática');
  assert.equal(linhas[1], '1;1;Time A;Ana;GOL;C2;não');
  assert.equal(linhas[2], '2;1;"Time; B";"Zé ""Gol""";ATA;C1;sim');
});
