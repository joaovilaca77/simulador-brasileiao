#!/usr/bin/env node
// Gera data/brasileirao.json de EXEMPLO (resultados fictícios), usado até o
// primeiro `npm run dados` trazer os dados reais do Sofascore.
//
// Uso: node scripts/gerar-exemplo.mjs [--rodadas-disputadas 26] [--proxima 2026-10-04]

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// [nome, sigla, cor primária, cor secundária, força relativa]
const CLUBES = [
  ['Athletico-PR', 'CAP', '#c8102e', '#000000', 0.95],
  ['Atlético-MG', 'CAM', '#000000', '#ffffff', 1.05],
  ['Bahia', 'BAH', '#0057a8', '#e30613', 1.0],
  ['Botafogo', 'BOT', '#000000', '#ffffff', 1.1],
  ['Chapecoense', 'CHA', '#00843d', '#ffffff', 0.85],
  ['Corinthians', 'COR', '#ffffff', '#000000', 1.0],
  ['Coritiba', 'CFC', '#00544e', '#ffffff', 0.85],
  ['Cruzeiro', 'CRU', '#003da5', '#ffffff', 1.1],
  ['Flamengo', 'FLA', '#c8102e', '#000000', 1.3],
  ['Fluminense', 'FLU', '#7a1631', '#00613c', 1.05],
  ['Grêmio', 'GRE', '#0d80bf', '#000000', 0.95],
  ['Internacional', 'INT', '#e30613', '#ffffff', 1.0],
  ['Mirassol', 'MIR', '#ffd200', '#00843d', 1.0],
  ['Palmeiras', 'PAL', '#006437', '#ffffff', 1.25],
  ['Red Bull Bragantino', 'RBB', '#ffffff', '#d50032', 0.95],
  ['Remo', 'REM', '#0a1f5c', '#ffffff', 0.8],
  ['Santos', 'SAN', '#ffffff', '#000000', 0.9],
  ['São Paulo', 'SAO', '#e30613', '#000000', 1.0],
  ['Vasco', 'VAS', '#000000', '#ffffff', 0.95],
  ['Vitória', 'VIT', '#e30613', '#000000', 0.85],
];

// Gerador pseudoaleatório com semente, para o exemplo ser reproduzível.
function mulberry32(semente) {
  let a = semente;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda, rnd) {
  const limite = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k += 1; p *= rnd(); } while (p > limite);
  return k - 1;
}

// Método do círculo: 19 rodadas de turno; o returno inverte os mandos.
function tabelaDeJogos(ids) {
  const n = ids.length;
  const giro = [...ids];
  const turno = [];
  for (let r = 0; r < n - 1; r += 1) {
    const jogos = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = giro[i];
      const b = giro[n - 1 - i];
      jogos.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    turno.push(jogos);
    giro.splice(1, 0, giro.pop());
  }
  const returno = turno.map((jogos) => jogos.map(([a, b]) => [b, a]));
  return [...turno, ...returno];
}

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i > -1 ? process.argv[i + 1] : padrao;
}

const disputadas = Number(arg('--rodadas-disputadas', 26));
const proxima = new Date(`${arg('--proxima', '2026-10-04')}T19:00:00Z`);
const rnd = mulberry32(2026);

const times = CLUBES.map(([nome, sigla, primaria, secundaria], i) => ({
  id: i + 1, nome, sigla, cores: { primaria, secundaria },
}));
const forca = new Map(CLUBES.map((c, i) => [i + 1, c[4]]));

const HORA = 3600 * 1000;
const DIA = 24 * HORA;
const SEMANA = 7 * DIA;
// Sábado e domingo às 16h, 18h30 e 21h (horário de Brasília).
const HORARIOS = [0, 2.5, 2.5, 5, 5];
const jogos = [];
tabelaDeJogos(times.map((t) => t.id)).forEach((lista, idx) => {
  const rodada = idx + 1;
  const base = proxima.getTime() + (rodada - disputadas - 1) * SEMANA;
  lista.forEach(([mandante, visitante], k) => {
    const encerrado = rodada <= disputadas;
    const inicio = new Date(base - (k < 5 ? DIA : 0) + HORARIOS[k % 5] * HORA);
    jogos.push({
      id: rodada * 100 + k,
      rodada,
      inicio: inicio.toISOString(),
      mandante,
      visitante,
      golsMandante: encerrado ? poisson(1.45 * forca.get(mandante) / forca.get(visitante), rnd) : null,
      golsVisitante: encerrado ? poisson(1.05 * forca.get(visitante) / forca.get(mandante), rnd) : null,
      status: encerrado ? 'encerrado' : 'agendado',
    });
  });
});

const dados = {
  fonte: 'exemplo',
  temporada: '2026',
  atualizadoEm: new Date(proxima.getTime() - 2 * DIA).toISOString(),
  times,
  jogos,
};

const destino = path.join(RAIZ, 'data', 'brasileirao.json');
await writeFile(destino, `${JSON.stringify(dados, null, 2)}\n`);
console.log(`Exemplo gravado em ${path.relative(RAIZ, destino)}: ${jogos.length} jogos, ${disputadas} rodadas disputadas.`);
