// Fonte: football-data.org (API oficial, plano gratuito inclui a Série A).
// Exige uma chave em FOOTBALL_DATA_TOKEN: https://www.football-data.org/client/register

import { buscarJSON } from './comum.mjs';

const API = 'https://api.football-data.org/v4';
const COMPETICAO = 'BSA'; // Campeonato Brasileiro Série A

const STATUS = {
  FINISHED: 'encerrado',
  AWARDED: 'encerrado',
  SCHEDULED: 'agendado',
  TIMED: 'agendado',
  IN_PLAY: 'ao_vivo',
  PAUSED: 'ao_vivo',
  LIVE: 'ao_vivo',
  POSTPONED: 'adiado',
  SUSPENDED: 'adiado',
  CANCELLED: 'adiado',
};

// clubColors vem como texto ("Red / Black"); convertemos os nomes comuns.
const CORES = {
  red: '#d0021b',
  white: '#ffffff',
  black: '#000000',
  green: '#00843d',
  'dark green': '#00544e',
  blue: '#0057a8',
  'royal blue': '#1d4fbf',
  'navy blue': '#0a1f5c',
  navy: '#0a1f5c',
  'sky blue': '#6cace4',
  'light blue': '#6cace4',
  yellow: '#ffd200',
  gold: '#d4af37',
  orange: '#f28c28',
  maroon: '#7a1631',
  claret: '#7a1631',
  burgundy: '#7a1631',
  wine: '#722f37',
  grey: '#8a8d91',
  gray: '#8a8d91',
  silver: '#c0c0c0',
  purple: '#5b2a86',
};

export function coresDoTexto(texto) {
  const nomes = String(texto ?? '').toLowerCase().split('/').map((s) => s.trim()).filter(Boolean);
  const hex = nomes.map((n) => CORES[n]).filter(Boolean);
  return { primaria: hex[0] ?? '#888888', secundaria: hex[1] ?? (hex[0] === '#ffffff' ? '#000000' : '#ffffff') };
}

export function normalizarPartida(p) {
  const status = STATUS[p.status] ?? 'agendado';
  const gol = (g) => (status === 'encerrado' && Number.isInteger(g) ? g : null);
  return {
    id: p.id,
    rodada: p.matchday,
    inicio: new Date(p.utcDate).toISOString(),
    mandante: p.homeTeam.id,
    visitante: p.awayTeam.id,
    golsMandante: gol(p.score?.fullTime?.home),
    golsVisitante: gol(p.score?.fullTime?.away),
    status,
  };
}

export function normalizarTime(t) {
  return {
    id: t.id,
    nome: t.shortName || t.name,
    sigla: (t.tla || t.name.slice(0, 3)).toUpperCase(),
    cores: coresDoTexto(t.clubColors),
    escudoUrl: t.crest || null,
  };
}

export async function coletar({ temporada, fetch = globalThis.fetch, token, log = console.log } = {}) {
  if (!token) throw new Error('FOOTBALL_DATA_TOKEN não definido');
  const ano = String(temporada ?? new Date().getFullYear());
  const opcoes = { fetch, headers: { 'X-Auth-Token': token }, repetirEm: [429, 500, 502, 503, 504], pausaBase: 7000 };

  const { matches = [] } = await buscarJSON(`${API}/competitions/${COMPETICAO}/matches?season=${ano}`, opcoes);
  const { teams = [] } = await buscarJSON(`${API}/competitions/${COMPETICAO}/teams?season=${ano}`, opcoes);
  log(`football-data: temporada ${ano}, ${matches.length} jogos, ${teams.length} times`);

  return { fonte: 'football-data', times: teams.map(normalizarTime), jogos: matches.map(normalizarPartida) };
}
