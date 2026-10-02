#!/usr/bin/env node
// Baixa a tabela de jogos do Brasileirão Série A no Sofascore e grava
// data/brasileirao.json. A API do Sofascore não é oficial e pode mudar.
//
// Uso: node scripts/atualizar-dados.mjs [--temporada 2026]

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const API = 'https://api.sofascore.com/api/v1';
const TORNEIO = 325; // Brasileirão Série A
const RODADAS = 38;
const TOTAL_JOGOS = 380;
const TOTAL_TIMES = 20;

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = path.join(RAIZ, 'data', 'brasileirao.json');

const CABECALHOS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  Referer: 'https://www.sofascore.com/',
  Origin: 'https://www.sofascore.com',
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buscarJSON(url, { fetch = globalThis.fetch, tentativas = 4, pausaBase = 2000 } = {}) {
  for (let i = 1; ; i += 1) {
    const resp = await fetch(url, { headers: CABECALHOS });
    if (resp.ok) return resp.json();
    const repetir = [403, 429, 500, 502, 503, 504].includes(resp.status);
    if (!repetir || i >= tentativas) throw new Error(`HTTP ${resp.status} em ${url}`);
    await esperar(pausaBase * 2 ** (i - 1));
  }
}

const STATUS = {
  finished: 'encerrado',
  notstarted: 'agendado',
  inprogress: 'ao_vivo',
  postponed: 'adiado',
  canceled: 'adiado',
  cancelled: 'adiado',
  delayed: 'adiado',
  interrupted: 'adiado',
  suspended: 'adiado',
  abandoned: 'adiado',
};

export function normalizarEvento(ev) {
  const status = STATUS[ev.status?.type] ?? 'agendado';
  const placar = (s) => (status === 'encerrado' && Number.isInteger(s?.current) ? s.current : null);
  return {
    id: ev.id,
    rodada: ev.roundInfo?.round,
    inicio: new Date(ev.startTimestamp * 1000).toISOString(),
    mandante: ev.homeTeam.id,
    visitante: ev.awayTeam.id,
    golsMandante: placar(ev.homeScore),
    golsVisitante: placar(ev.awayScore),
    status,
  };
}

export function normalizarTime(t) {
  return {
    id: t.id,
    nome: t.shortName || t.name,
    sigla: (t.nameCode || t.name.slice(0, 3)).toUpperCase(),
    cores: {
      primaria: t.teamColors?.primary ?? '#888888',
      secundaria: t.teamColors?.secondary ?? '#ffffff',
    },
  };
}

export function montarDados(eventos, temporada, agora = new Date()) {
  const porId = new Map();
  for (const ev of eventos) porId.set(ev.id, ev);
  const unicos = [...porId.values()];

  const times = new Map();
  for (const ev of unicos) {
    times.set(ev.homeTeam.id, normalizarTime(ev.homeTeam));
    times.set(ev.awayTeam.id, normalizarTime(ev.awayTeam));
  }

  const jogos = unicos.map(normalizarEvento)
    .sort((a, b) => a.rodada - b.rodada || a.inicio.localeCompare(b.inicio) || a.id - b.id);

  if (times.size !== TOTAL_TIMES) throw new Error(`Esperava ${TOTAL_TIMES} times, vieram ${times.size}`);
  if (jogos.length !== TOTAL_JOGOS) throw new Error(`Esperava ${TOTAL_JOGOS} jogos, vieram ${jogos.length}`);
  if (jogos.some((j) => !Number.isInteger(j.rodada))) throw new Error('Jogo sem rodada definida');

  return {
    fonte: 'sofascore',
    temporada: String(temporada),
    atualizadoEm: agora.toISOString(),
    times: [...times.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    jogos,
  };
}

export async function coletar({ temporada, fetch = globalThis.fetch, pausa = 400, log = console.log } = {}) {
  const { seasons } = await buscarJSON(`${API}/unique-tournament/${TORNEIO}/seasons`, { fetch });
  const ano = String(temporada ?? new Date().getFullYear());
  const season = seasons.find((s) => String(s.year) === ano);
  if (!season) throw new Error(`Temporada ${ano} não encontrada no Sofascore`);
  log(`Temporada ${ano}: id ${season.id}`);

  const eventos = [];
  for (let rodada = 1; rodada <= RODADAS; rodada += 1) {
    const { events = [] } = await buscarJSON(
      `${API}/unique-tournament/${TORNEIO}/season/${season.id}/events/round/${rodada}`, { fetch },
    );
    eventos.push(...events);
    log(`Rodada ${rodada}: ${events.length} jogos`);
    if (pausa) await esperar(pausa);
  }
  return montarDados(eventos, ano);
}

// Compara ignorando a data de atualização, para não commitar à toa.
export function mudou(antigo, novo) {
  if (!antigo) return true;
  const semData = ({ atualizadoEm, ...resto }) => resto;
  return JSON.stringify(semData(antigo)) !== JSON.stringify(semData(novo));
}

async function principal() {
  const idx = process.argv.indexOf('--temporada');
  const temporada = idx > -1 ? process.argv[idx + 1] : undefined;

  let antigo = null;
  try {
    antigo = JSON.parse(await readFile(ARQUIVO, 'utf8'));
  } catch {
    // primeira execução
  }

  const novo = await coletar({ temporada });
  if (!mudou(antigo, novo)) {
    console.log('Nenhuma mudança nos dados.');
    return;
  }
  await writeFile(ARQUIVO, `${JSON.stringify(novo, null, 2)}\n`);
  console.log(`Gravado ${path.relative(RAIZ, ARQUIVO)} (${novo.jogos.length} jogos).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((erro) => {
    console.error(`Falha ao atualizar os dados: ${erro.message}`);
    process.exit(1);
  });
}
