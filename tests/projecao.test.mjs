import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rodadaAtual, montarSnapshot, mesclarPalpites, filtrarPalpites, definirPalpite } from '../js/projecao.js';

const TIMES = [1, 2, 3, 4].map((id) => ({ id, nome: `Time ${id}` }));

const rodada = (n, statuses) => statuses.map((status, i) => ({
  id: n * 100 + i, rodada: n, inicio: '2030-01-01T00:00:00Z', mandante: 1, visitante: 2,
  golsMandante: status === 'encerrado' ? 1 : null, golsVisitante: status === 'encerrado' ? 0 : null, status,
}));

test('rodadaAtual é a primeira com jogo pendente', () => {
  const jogos = [...rodada(1, ['encerrado', 'encerrado']), ...rodada(2, ['encerrado', 'agendado']), ...rodada(3, ['agendado', 'agendado'])];
  assert.equal(rodadaAtual(jogos), 2);
});

test('rodadaAtual ignora jogo adiado de rodada antiga', () => {
  const jogos = [...rodada(1, ['adiado', 'encerrado']), ...rodada(2, ['encerrado', 'encerrado']), ...rodada(3, ['agendado', 'agendado'])];
  assert.equal(rodadaAtual(jogos), 3);
});

test('rodadaAtual é null com o campeonato encerrado', () => {
  assert.equal(rodadaAtual(rodada(1, ['encerrado', 'encerrado'])), null);
});

test('montarSnapshot guarda a classificação projetada', () => {
  const jogos = [
    { id: 1, rodada: 1, mandante: 1, visitante: 2, golsMandante: 0, golsVisitante: 1, status: 'encerrado', inicio: '2026-01-01T00:00:00Z' },
    { id: 2, rodada: 2, mandante: 3, visitante: 4, golsMandante: null, golsVisitante: null, status: 'agendado', inicio: '2030-01-01T00:00:00Z' },
    { id: 3, rodada: 2, mandante: 1, visitante: 3, golsMandante: null, golsVisitante: null, status: 'agendado', inicio: '2030-01-01T00:00:00Z' },
  ];
  const snap = montarSnapshot(TIMES, jogos, { 2: { m: 3, v: 0 } }, 2, 1234);
  assert.equal(snap.rodada, 2);
  assert.equal(snap.salvoEm, 1234);
  assert.equal(snap.jogosPendentes, 2);
  assert.equal(snap.jogosPalpitados, 1);
  assert.deepEqual(snap.classificacao[0], { timeId: 3, pos: 1, pts: 3, sg: 3, gp: 3 });
  assert.equal(snap.classificacao.length, 4);
});

test('mesclarPalpites: vence o salvo por último, inclusive apagados', () => {
  const nuvem = { 1: { m: 1, v: 0, salvoEm: 10 }, 2: { m: 2, v: 2, salvoEm: 30 } };
  const local = { 1: { m: null, v: null, salvoEm: 20 }, 2: { m: 0, v: 0, salvoEm: 5 }, 3: { m: 4, v: 1, salvoEm: 1 } };
  assert.deepEqual(mesclarPalpites(nuvem, local), {
    1: { m: null, v: null, salvoEm: 20 },
    2: { m: 2, v: 2, salvoEm: 30 },
    3: { m: 4, v: 1, salvoEm: 1 },
  });
});

test('filtrarPalpites remove jogos que não existem mais', () => {
  assert.deepEqual(filtrarPalpites({ 1: { m: 1, v: 0 }, 99: { m: 0, v: 0 } }, [{ id: 1 }]), { 1: { m: 1, v: 0 } });
});

test('definirPalpite respeita a trava', () => {
  const jogo = { id: 7, status: 'agendado', inicio: '2026-05-01T19:00:00Z' };
  const antes = Date.parse(jogo.inicio) - 1;
  assert.deepEqual(definirPalpite({}, jogo, 2, 1, antes), { 7: { m: 2, v: 1, salvoEm: antes } });
  assert.equal(definirPalpite({}, jogo, 2, 1, antes + 1), null);
});
