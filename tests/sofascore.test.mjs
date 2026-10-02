import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEvento, normalizarTime, montarDados, coletar, buscarJSON, mudou } from '../scripts/atualizar-dados.mjs';

// Times e eventos no formato da API do Sofascore.
const TIMES = Array.from({ length: 20 }, (_, i) => ({
  id: 1000 + i,
  name: `Clube ${i}`,
  shortName: `Clube ${i}`,
  nameCode: `C${String(i).padStart(2, '0')}`,
  teamColors: { primary: '#111111', secondary: '#eeeeee' },
}));

function evento(id, rodada, casa, fora, status = 'notstarted', placar = null) {
  return {
    id,
    roundInfo: { round: rodada },
    startTimestamp: 1775000000 + id * 60,
    status: { type: status },
    homeTeam: TIMES[casa],
    awayTeam: TIMES[fora],
    homeScore: placar ? { current: placar[0] } : {},
    awayScore: placar ? { current: placar[1] } : {},
  };
}

function temporadaCompleta() {
  const eventos = [];
  let id = 1;
  for (let r = 1; r <= 38; r += 1) {
    for (let k = 0; k < 10; k += 1) {
      const casa = (k + r) % 20;
      const fora = (19 - k + r) % 20;
      eventos.push(r <= 2 ? evento(id, r, casa, fora, 'finished', [2, 1]) : evento(id, r, casa, fora));
      id += 1;
    }
  }
  return eventos;
}

test('normalizarEvento converte status e placar', () => {
  assert.deepEqual(normalizarEvento(evento(5, 3, 0, 1, 'finished', [3, 0])), {
    id: 5, rodada: 3, inicio: new Date((1775000000 + 300) * 1000).toISOString(),
    mandante: 1000, visitante: 1001, golsMandante: 3, golsVisitante: 0, status: 'encerrado',
  });
  const aoVivo = normalizarEvento(evento(6, 3, 0, 1, 'inprogress', [1, 0]));
  assert.equal(aoVivo.status, 'ao_vivo');
  assert.equal(aoVivo.golsMandante, null);
  assert.equal(normalizarEvento(evento(7, 3, 0, 1, 'postponed')).status, 'adiado');
});

test('normalizarTime usa nome curto, sigla e cores', () => {
  assert.deepEqual(normalizarTime(TIMES[3]), {
    id: 1003, nome: 'Clube 3', sigla: 'C03', cores: { primaria: '#111111', secundaria: '#eeeeee' },
  });
});

test('montarDados exige 380 jogos e 20 times', () => {
  const dados = montarDados(temporadaCompleta(), '2026', new Date('2026-10-01T00:00:00Z'));
  assert.equal(dados.fonte, 'sofascore');
  assert.equal(dados.jogos.length, 380);
  assert.equal(dados.times.length, 20);
  assert.equal(dados.jogos.filter((j) => j.status === 'encerrado').length, 20);
  assert.throws(() => montarDados(temporadaCompleta().slice(0, 370), '2026'), /380 jogos/);
});

test('coletar percorre as 38 rodadas da temporada pedida', async () => {
  const eventos = temporadaCompleta();
  const urls = [];
  const fetchFalso = async (url) => {
    urls.push(url);
    if (url.endsWith('/seasons')) {
      return { ok: true, json: async () => ({ seasons: [{ year: '2026', id: 777 }, { year: '2025', id: 666 }] }) };
    }
    const rodada = Number(url.split('/').at(-1));
    return { ok: true, json: async () => ({ events: eventos.filter((e) => e.roundInfo.round === rodada) }) };
  };
  const dados = await coletar({ temporada: 2026, fetch: fetchFalso, pausa: 0, log: () => {} });
  assert.equal(dados.jogos.length, 380);
  assert.equal(urls.length, 39);
  assert.match(urls[1], /season\/777\/events\/round\/1$/);
});

test('buscarJSON repete em 403 e desiste em 404', async () => {
  let chamadas = 0;
  const instavel = async () => (++chamadas < 3 ? { ok: false, status: 403 } : { ok: true, json: async () => ({ ok: 1 }) });
  assert.deepEqual(await buscarJSON('u', { fetch: instavel, pausaBase: 1 }), { ok: 1 });
  assert.equal(chamadas, 3);

  await assert.rejects(buscarJSON('u', { fetch: async () => ({ ok: false, status: 404 }), pausaBase: 1 }), /HTTP 404/);
});

test('mudou ignora a data de atualização', () => {
  const a = { fonte: 'sofascore', atualizadoEm: '1', jogos: [1] };
  assert.equal(mudou(a, { ...a, atualizadoEm: '2' }), false);
  assert.equal(mudou(a, { ...a, jogos: [2] }), true);
  assert.equal(mudou(null, a), true);
});
