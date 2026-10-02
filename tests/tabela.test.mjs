import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularClassificacao, jogoTravado, palpiteCompleto, placarDoJogo, zonaDaPosicao } from '../js/tabela.js';

const time = (id, nome) => ({ id, nome, sigla: nome.slice(0, 3).toUpperCase(), cores: {} });
const TIMES = [time(1, 'Alfa'), time(2, 'Beta'), time(3, 'Gama'), time(4, 'Delta')];

let seq = 0;
const jogo = (mandante, visitante, gm, gv, extra = {}) => ({
  id: ++seq, rodada: 1, inicio: '2026-05-01T19:00:00Z', mandante, visitante,
  golsMandante: gm, golsVisitante: gv, status: gm == null ? 'agendado' : 'encerrado', ...extra,
});
const ordem = (tabela) => tabela.map((l) => l.nome);

test('soma pontos, gols e aproveitamento', () => {
  const t = calcularClassificacao(TIMES, [jogo(1, 2, 2, 0), jogo(3, 4, 1, 1), jogo(2, 3, 0, 3)]);
  const gama = t.find((l) => l.nome === 'Gama');
  assert.deepEqual(
    { pts: gama.pts, j: gama.j, v: gama.v, e: gama.e, d: gama.d, gp: gama.gp, gc: gama.gc, sg: gama.sg },
    { pts: 4, j: 2, v: 1, e: 1, d: 0, gp: 4, gc: 1, sg: 3 },
  );
  assert.equal(gama.aproveitamento, 66.7);
  assert.deepEqual(ordem(t), ['Gama', 'Alfa', 'Delta', 'Beta']);
  assert.deepEqual(t.map((l) => l.pos), [1, 2, 3, 4]);
});

test('desempate por vitórias antes do saldo', () => {
  // Alfa: 1V 0E 1D = 3 pts. Beta: 0V 3E = 3 pts, saldo 0. Alfa vence por vitórias.
  const jogos = [jogo(1, 3, 1, 0), jogo(1, 4, 0, 5), jogo(2, 3, 0, 0), jogo(2, 4, 1, 1), jogo(3, 2, 2, 2)];
  const t = calcularClassificacao(TIMES, jogos);
  const alfa = t.find((l) => l.nome === 'Alfa');
  const beta = t.find((l) => l.nome === 'Beta');
  assert.equal(alfa.pts, beta.pts);
  assert.ok(alfa.sg < beta.sg);
  assert.ok(alfa.pos < beta.pos);
});

test('desempate por saldo e depois gols pró', () => {
  const porSaldo = calcularClassificacao(TIMES, [jogo(1, 3, 3, 0), jogo(2, 4, 1, 0)]);
  assert.deepEqual(ordem(porSaldo).slice(0, 2), ['Alfa', 'Beta']);

  const porGols = calcularClassificacao(TIMES, [jogo(2, 3, 3, 2), jogo(1, 4, 2, 1)]);
  assert.deepEqual(ordem(porGols).slice(0, 2), ['Beta', 'Alfa']);
});

test('confronto direto quando dois times empatam em tudo', () => {
  // Beta venceu Alfa; os dois terminam com 3 pts, 1 vitória, saldo 0 e 2 gols pró.
  const jogos = [jogo(2, 1, 1, 0), jogo(1, 3, 2, 1), jogo(2, 4, 1, 2)];
  const t = calcularClassificacao(TIMES, jogos);
  const alfa = t.find((l) => l.nome === 'Alfa');
  const beta = t.find((l) => l.nome === 'Beta');
  const criterios = (l) => [l.pts, l.v, l.sg, l.gp];
  assert.deepEqual(criterios(alfa), criterios(beta));
  assert.equal(beta.pos + 1, alfa.pos);
});

test('empate total sem confronto direto cai na ordem alfabética', () => {
  const t = calcularClassificacao(TIMES, []);
  assert.deepEqual(ordem(t), ['Alfa', 'Beta', 'Delta', 'Gama']);
});

test('palpites contam só em jogos não encerrados e completos', () => {
  const real = jogo(1, 2, 0, 1);
  const pendente = jogo(3, 4, null, null);
  const outro = jogo(1, 3, null, null);
  const palpites = {
    [real.id]: { m: 5, v: 0 },
    [pendente.id]: { m: 2, v: 0 },
    [outro.id]: { m: 1, v: null },
  };
  const t = calcularClassificacao(TIMES, [real, pendente, outro], palpites);
  const porNome = Object.fromEntries(t.map((l) => [l.nome, l]));
  assert.equal(porNome.Beta.pts, 3);
  assert.equal(porNome.Alfa.pts, 0);
  assert.equal(porNome.Gama.pts, 3);
  assert.equal(porNome.Alfa.j, 1);
  assert.equal(placarDoJogo(real, palpites).origem, 'real');
  assert.equal(placarDoJogo(pendente, palpites).origem, 'palpite');
  assert.equal(placarDoJogo(outro, palpites), null);
});

test('palpiteCompleto valida inteiros de 0 a 20', () => {
  assert.equal(palpiteCompleto({ m: 0, v: 20 }), true);
  assert.equal(palpiteCompleto({ m: -1, v: 0 }), false);
  assert.equal(palpiteCompleto({ m: 1.5, v: 0 }), false);
  assert.equal(palpiteCompleto({ m: null, v: null }), false);
  assert.equal(palpiteCompleto(undefined), false);
});

test('jogoTravado: trava no início do jogo', () => {
  const inicio = Date.parse('2026-05-01T19:00:00Z');
  const agendado = jogo(1, 2, null, null);
  assert.equal(jogoTravado(agendado, inicio - 1), false);
  assert.equal(jogoTravado(agendado, inicio), true);
  assert.equal(jogoTravado({ ...agendado, status: 'ao_vivo' }, inicio - 1000), true);
  assert.equal(jogoTravado({ ...agendado, status: 'encerrado' }, inicio - 1000), true);
  assert.equal(jogoTravado({ ...agendado, status: 'adiado' }, inicio + 1000), false);
});

test('zonas da tabela', () => {
  assert.equal(zonaDaPosicao(1).id, 'libertadores');
  assert.equal(zonaDaPosicao(5).id, 'pre-libertadores');
  assert.equal(zonaDaPosicao(12).id, 'sul-americana');
  assert.equal(zonaDaPosicao(13), null);
  assert.equal(zonaDaPosicao(17).id, 'rebaixamento');
});
