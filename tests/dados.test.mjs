import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as sofascore from '../scripts/fontes/sofascore.mjs';
import * as footballData from '../scripts/fontes/football-data.mjs';
import { buscarJSON } from '../scripts/fontes/comum.mjs';
import { padronizarTime } from '../scripts/fontes/nomes.mjs';
import { montarDados, escolherFontes, coletarDados, baixarEscudos, mudou } from '../scripts/atualizar-dados.mjs';

const silencio = () => {};

// ---------- Sofascore ----------

const TIMES_SOFA = Array.from({ length: 20 }, (_, i) => ({
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
    homeTeam: TIMES_SOFA[casa],
    awayTeam: TIMES_SOFA[fora],
    homeScore: placar ? { current: placar[0] } : {},
    awayScore: placar ? { current: placar[1] } : {},
  };
}

function temporadaSofascore() {
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

function fetchSofascore(eventos) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    if (url.endsWith('/seasons')) {
      return { ok: true, json: async () => ({ seasons: [{ year: '2026', id: 777 }, { year: '2025', id: 666 }] }) };
    }
    const rodada = Number(url.split('/').at(-1));
    return { ok: true, json: async () => ({ events: eventos.filter((e) => e.roundInfo.round === rodada) }) };
  };
  return { fetch, urls };
}

test('sofascore: normaliza status e placar', () => {
  assert.deepEqual(sofascore.normalizarEvento(evento(5, 3, 0, 1, 'finished', [3, 0])), {
    id: 5, rodada: 3, inicio: new Date((1775000000 + 300) * 1000).toISOString(),
    mandante: 1000, visitante: 1001, golsMandante: 3, golsVisitante: 0, status: 'encerrado',
  });
  const aoVivo = sofascore.normalizarEvento(evento(6, 3, 0, 1, 'inprogress', [1, 0]));
  assert.equal(aoVivo.status, 'ao_vivo');
  assert.equal(aoVivo.golsMandante, null);
  assert.equal(sofascore.normalizarEvento(evento(7, 3, 0, 1, 'postponed')).status, 'adiado');
});

test('sofascore: normaliza time com cores e URL do escudo', () => {
  assert.deepEqual(sofascore.normalizarTime(TIMES_SOFA[3]), {
    id: 1003, nome: 'Clube 3', sigla: 'C03', cores: { primaria: '#111111', secundaria: '#eeeeee' },
    escudoUrl: 'https://api.sofascore.app/api/v1/team/1003/image',
  });
});

test('sofascore: coleta as 38 rodadas da temporada pedida', async () => {
  const { fetch, urls } = fetchSofascore(temporadaSofascore());
  const coleta = await sofascore.coletar({ temporada: 2026, fetch, pausa: 0, log: silencio });
  assert.equal(coleta.fonte, 'sofascore');
  assert.equal(coleta.jogos.length, 380);
  assert.equal(coleta.times.length, 20);
  assert.equal(urls.length, 39);
  assert.match(urls[1], /season\/777\/events\/round\/1$/);
});

// ---------- football-data.org ----------

const TIMES_FD = Array.from({ length: 20 }, (_, i) => ({
  id: 1700 + i, name: `Esporte Clube ${i}`, shortName: `EC ${i}`, tla: `E${String(i).padStart(2, '0')}`,
  clubColors: i === 0 ? 'Red / Black' : 'Navy Blue / White', crest: `https://crests.football-data.org/${1700 + i}.png`,
}));

function partida(id, matchday, casa, fora, status = 'TIMED', placar = [null, null]) {
  return {
    id, matchday, status, utcDate: '2026-10-04T19:00:00Z',
    homeTeam: { id: 1700 + casa }, awayTeam: { id: 1700 + fora },
    score: { fullTime: { home: placar[0], away: placar[1] } },
  };
}

test('football-data: normaliza partidas, status e placar', () => {
  assert.deepEqual(footballData.normalizarPartida(partida(9, 4, 0, 1, 'FINISHED', [2, 2])), {
    id: 9, rodada: 4, inicio: '2026-10-04T19:00:00.000Z', mandante: 1700, visitante: 1701,
    golsMandante: 2, golsVisitante: 2, status: 'encerrado',
  });
  assert.equal(footballData.normalizarPartida(partida(1, 1, 0, 1, 'IN_PLAY', [1, 0])).golsMandante, null);
  assert.equal(footballData.normalizarPartida(partida(1, 1, 0, 1, 'PAUSED')).status, 'ao_vivo');
  assert.equal(footballData.normalizarPartida(partida(1, 1, 0, 1, 'POSTPONED')).status, 'adiado');
  assert.equal(footballData.normalizarPartida(partida(1, 1, 0, 1, 'SCHEDULED')).status, 'agendado');
});

test('football-data: converte cores e usa tla e escudo', () => {
  assert.deepEqual(footballData.normalizarTime(TIMES_FD[0]), {
    id: 1700, nome: 'EC 0', sigla: 'E00', cores: { primaria: '#d0021b', secundaria: '#000000' },
    escudoUrl: 'https://crests.football-data.org/1700.png',
  });
  assert.deepEqual(footballData.coresDoTexto('White'), { primaria: '#ffffff', secundaria: '#000000' });
  assert.deepEqual(footballData.coresDoTexto(undefined), { primaria: '#888888', secundaria: '#ffffff' });
});

test('football-data: exige chave e envia o cabeçalho', async () => {
  await assert.rejects(footballData.coletar({ temporada: 2026, log: silencio }), /FOOTBALL_DATA_TOKEN/);
  const chamadas = [];
  const fetch = async (url, { headers }) => {
    chamadas.push({ url, token: headers['X-Auth-Token'] });
    const corpo = url.includes('/matches') ? { matches: [partida(1, 1, 0, 1)] } : { teams: TIMES_FD };
    return { ok: true, json: async () => corpo };
  };
  const coleta = await footballData.coletar({ temporada: 2026, fetch, token: 'abc', log: silencio });
  assert.equal(coleta.fonte, 'football-data');
  assert.equal(coleta.times.length, 20);
  assert.deepEqual(chamadas.map((c) => c.token), ['abc', 'abc']);
  assert.match(chamadas[0].url, /competitions\/BSA\/matches\?season=2026$/);
});

// ---------- Orquestração ----------

test('montarDados valida, ordena e remove a URL do escudo', async () => {
  const { fetch } = fetchSofascore(temporadaSofascore());
  const coleta = await sofascore.coletar({ temporada: 2026, fetch, pausa: 0, log: silencio });
  const dados = montarDados(coleta, '2026', new Date('2026-10-01T00:00:00Z'));
  assert.equal(dados.fonte, 'sofascore');
  assert.equal(dados.jogos.length, 380);
  assert.equal(dados.times.filter((t) => 'escudoUrl' in t).length, 0);
  assert.equal(dados.jogos.filter((j) => j.status === 'encerrado').length, 20);
  assert.throws(() => montarDados({ ...coleta, jogos: coleta.jogos.slice(0, 370) }, '2026'), /380 jogos/);
});

test('escolherFontes: pedido explícito, fonte atual fixa e alternativa no exemplo', () => {
  assert.deepEqual(escolherFontes({ forcada: 'football-data', atual: 'sofascore' }), ['football-data']);
  assert.deepEqual(escolherFontes({ forcada: 'auto', atual: 'football-data', token: 'x' }), ['football-data']);
  assert.deepEqual(escolherFontes({ atual: 'sofascore', token: 'x' }), ['sofascore']);
  assert.deepEqual(escolherFontes({ atual: 'exemplo', token: 'x' }), ['sofascore', 'football-data']);
  assert.deepEqual(escolherFontes({ atual: 'exemplo' }), ['sofascore']);
  assert.throws(() => escolherFontes({ forcada: 'espn' }), /desconhecida/);
});

test('coletarDados cai para a próxima fonte quando a primeira falha', async () => {
  const { fetch } = fetchSofascore(temporadaSofascore());
  const valida = await sofascore.coletar({ temporada: 2026, fetch, pausa: 0, log: silencio });
  const coletores = {
    sofascore: async () => { throw new Error('HTTP 403'); },
    'football-data': async () => ({ ...valida, fonte: 'football-data' }),
  };
  const coleta = await coletarDados({ fontes: ['sofascore', 'football-data'], coletores, log: silencio });
  assert.equal(coleta.fonte, 'football-data');

  const incompleta = { sofascore: async () => ({ ...valida, jogos: [] }) };
  await assert.rejects(coletarDados({ fontes: ['sofascore'], coletores: incompleta, log: silencio }), /sofascore: Esperava 380/);
});

test('baixarEscudos grava as imagens e tolera falhas', async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), 'escudos-'));
  try {
    const png = Buffer.alloc(200, 7);
    const resposta = (status, tipo, corpo) => ({
      ok: status === 200, status, headers: new Headers({ 'content-type': tipo }), arrayBuffer: async () => corpo,
    });
    const fetch = async (url) => {
      if (url.endsWith('/1')) return resposta(200, 'image/png', png);
      if (url.endsWith('/2')) return resposta(200, 'image/svg+xml; charset=utf-8', Buffer.from(`<svg>${'x'.repeat(200)}</svg>`));
      if (url.endsWith('/3')) return resposta(403, 'text/html', Buffer.alloc(0));
      return resposta(200, 'text/html', Buffer.alloc(500));
    };
    await writeFile(path.join(pasta, '5.png'), png);
    const times = [1, 2, 3, 4, 5].map((id) => ({ id, nome: `T${id}`, escudoUrl: `https://x/${id}` }));
    times.push({ id: 6, nome: 'Sem URL', escudoUrl: null });

    await baixarEscudos(times, { fetch, pasta, prefixo: 'img/escudos', pausa: 0, log: silencio });

    assert.deepEqual(times.map((t) => t.escudo ?? null), [
      'img/escudos/1.png', 'img/escudos/2.svg', null, null, 'img/escudos/5.png', null,
    ]);
    assert.deepEqual(await readFile(path.join(pasta, '1.png')), png);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
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

test('padronizarTime corrige nomes e siglas das APIs', () => {
  const base = { id: 1, cores: {}, escudoUrl: 'u' };
  assert.deepEqual(padronizarTime({ ...base, nome: 'Mineiro', sigla: 'CAM' }), { ...base, nome: 'Atlético-MG', sigla: 'CAM' });
  assert.equal(padronizarTime({ ...base, nome: 'Paranaense', sigla: 'CAP' }).nome, 'Athletico-PR');
  assert.equal(padronizarTime({ ...base, nome: 'Clube do Remo', sigla: 'CRE' }).sigla, 'REM');
  assert.equal(padronizarTime({ ...base, nome: 'Coritiba', sigla: 'COR' }).sigla, 'CFC');
  assert.equal(padronizarTime({ ...base, nome: 'São Paulo', sigla: 'PAU' }).sigla, 'SAO');
  assert.equal(padronizarTime({ ...base, nome: 'Grêmio', sigla: 'FBP' }).sigla, 'GRE');
  assert.deepEqual(padronizarTime({ ...base, nome: 'Time Novo', sigla: 'TNV' }), { ...base, nome: 'Time Novo', sigla: 'TNV' });
});

test('coletarDados aplica os nomes padronizados', async () => {
  const { fetch } = fetchSofascore(temporadaSofascore());
  const valida = await sofascore.coletar({ temporada: 2026, fetch, pausa: 0, log: silencio });
  valida.times[0] = { ...valida.times[0], nome: 'Vasco da Gama', sigla: 'VAS' };
  const coleta = await coletarDados({ fontes: ['sofascore'], coletores: { sofascore: async () => valida }, log: silencio });
  assert.equal(coleta.times[0].nome, 'Vasco');
});
