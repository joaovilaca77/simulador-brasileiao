// Fonte: API não oficial do Sofascore (pode mudar sem aviso).

import { buscarJSON, esperar } from './comum.mjs';

const API = 'https://api.sofascore.com/api/v1';
const IMAGENS = 'https://api.sofascore.app/api/v1';
const TORNEIO = 325; // Brasileirão Série A
const RODADAS = 38;

export const CABECALHOS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  Referer: 'https://www.sofascore.com/',
  Origin: 'https://www.sofascore.com',
};

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
    escudoUrl: `${IMAGENS}/team/${t.id}/image`,
  };
}

export async function coletar({ temporada, fetch = globalThis.fetch, pausa = 400, log = console.log } = {}) {
  const opcoes = { fetch, headers: CABECALHOS };
  const { seasons } = await buscarJSON(`${API}/unique-tournament/${TORNEIO}/seasons`, opcoes);
  const ano = String(temporada ?? new Date().getFullYear());
  const season = seasons.find((s) => String(s.year) === ano);
  if (!season) throw new Error(`Temporada ${ano} não encontrada no Sofascore`);
  log(`Sofascore: temporada ${ano}, id ${season.id}`);

  const porId = new Map();
  for (let rodada = 1; rodada <= RODADAS; rodada += 1) {
    const { events = [] } = await buscarJSON(
      `${API}/unique-tournament/${TORNEIO}/season/${season.id}/events/round/${rodada}`, opcoes,
    );
    for (const ev of events) porId.set(ev.id, ev);
    log(`Rodada ${rodada}: ${events.length} jogos`);
    if (pausa) await esperar(pausa);
  }

  const eventos = [...porId.values()];
  const times = new Map();
  for (const ev of eventos) {
    times.set(ev.homeTeam.id, normalizarTime(ev.homeTeam));
    times.set(ev.awayTeam.id, normalizarTime(ev.awayTeam));
  }
  return { fonte: 'sofascore', times: [...times.values()], jogos: eventos.map(normalizarEvento) };
}
