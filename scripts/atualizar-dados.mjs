#!/usr/bin/env node
// Baixa a tabela de jogos do Brasileirão Série A e grava data/brasileirao.json,
// junto com os escudos dos clubes em img/escudos/.
//
// Uso: node scripts/atualizar-dados.mjs [--temporada 2026] [--fonte auto|sofascore|football-data] [--escudos]
//
// Fonte: a de --fonte ou FONTE_DADOS; senão, a mesma do arquivo atual; se o
// arquivo ainda for o exemplo, tenta o Sofascore e depois o football-data.org
// (este exige FOOTBALL_DATA_TOKEN).

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as sofascore from './fontes/sofascore.mjs';
import * as footballData from './fontes/football-data.mjs';
import { esperar } from './fontes/comum.mjs';
import { padronizarTime } from './fontes/nomes.mjs';

const TOTAL_JOGOS = 380;
const TOTAL_TIMES = 20;

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = path.join(RAIZ, 'data', 'brasileirao.json');
const PASTA_ESCUDOS = path.join(RAIZ, 'img', 'escudos');
const PREFIXO_ESCUDOS = 'img/escudos';

export const COLETORES = {
  sofascore: sofascore.coletar,
  'football-data': footballData.coletar,
};

export function validar({ times, jogos }) {
  if (times.length !== TOTAL_TIMES) throw new Error(`Esperava ${TOTAL_TIMES} times, vieram ${times.length}`);
  if (jogos.length !== TOTAL_JOGOS) throw new Error(`Esperava ${TOTAL_JOGOS} jogos, vieram ${jogos.length}`);
  if (jogos.some((j) => !Number.isInteger(j.rodada))) throw new Error('Jogo sem rodada definida');
  const ids = new Set(times.map((t) => t.id));
  if (jogos.some((j) => !ids.has(j.mandante) || !ids.has(j.visitante))) throw new Error('Jogo com time desconhecido');
}

export function montarDados(coleta, temporada, agora = new Date()) {
  validar(coleta);
  return {
    fonte: coleta.fonte,
    temporada: String(temporada ?? new Date().getFullYear()),
    atualizadoEm: agora.toISOString(),
    times: coleta.times
      .map(({ escudoUrl, ...time }) => time)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    jogos: [...coleta.jogos]
      .sort((a, b) => a.rodada - b.rodada || a.inicio.localeCompare(b.inicio) || a.id - b.id),
  };
}

// A fonte só muda quando alguém pede: trocar de fonte muda os IDs dos jogos
// e os palpites já feitos deixariam de corresponder.
export function escolherFontes({ forcada, atual, token }) {
  if (forcada && forcada !== 'auto') {
    if (!COLETORES[forcada]) throw new Error(`Fonte desconhecida: ${forcada}`);
    return [forcada];
  }
  if (atual && COLETORES[atual]) return [atual];
  return token ? ['sofascore', 'football-data'] : ['sofascore'];
}

export async function coletarDados({ fontes, temporada, token, fetch = globalThis.fetch, log = console.log, coletores = COLETORES }) {
  const erros = [];
  for (const nome of fontes) {
    try {
      const coleta = await coletores[nome]({ temporada, fetch, token, log });
      validar(coleta);
      return { ...coleta, times: coleta.times.map(padronizarTime) };
    } catch (erro) {
      erros.push(`${nome}: ${erro.message}`);
      log(`Falha em ${nome}: ${erro.message}`);
    }
  }
  throw new Error(erros.join(' | '));
}

const EXTENSOES = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

async function existe(arquivo) {
  try {
    await access(arquivo);
    return true;
  } catch {
    return false;
  }
}

// Baixa o escudo de cada time e preenche `time.escudo` com o caminho local.
// Falhas não interrompem a coleta: o site mostra as cores do time no lugar.
export async function baixarEscudos(times, {
  fetch = globalThis.fetch, pasta = PASTA_ESCUDOS, prefixo = PREFIXO_ESCUDOS,
  cabecalhos = {}, forcar = false, pausa = 200, log = console.log,
} = {}) {
  await mkdir(pasta, { recursive: true });
  let baixados = 0;
  for (const time of times) {
    let atual = null;
    for (const ext of Object.values(EXTENSOES)) {
      if (await existe(path.join(pasta, `${time.id}.${ext}`))) { atual = ext; break; }
    }
    if (atual && !forcar) {
      time.escudo = `${prefixo}/${time.id}.${atual}`;
      continue;
    }
    if (!time.escudoUrl) continue;
    try {
      const resp = await fetch(time.escudoUrl, { headers: { ...cabecalhos, Accept: 'image/*' } });
      const tipo = (resp.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ext = EXTENSOES[tipo];
      if (!ext) throw new Error(`tipo inesperado "${tipo}"`);
      const bytes = Buffer.from(await resp.arrayBuffer());
      if (bytes.length < 100) throw new Error('imagem vazia');
      await writeFile(path.join(pasta, `${time.id}.${ext}`), bytes);
      time.escudo = `${prefixo}/${time.id}.${ext}`;
      baixados += 1;
    } catch (erro) {
      log(`Escudo de ${time.nome} não baixado: ${erro.message}`);
      if (atual) time.escudo = `${prefixo}/${time.id}.${atual}`;
    }
    if (pausa) await esperar(pausa);
  }
  log(`Escudos: ${baixados} baixados, ${times.filter((t) => t.escudo).length} de ${times.length} disponíveis.`);
  return times;
}

// Compara ignorando a data de atualização, para não commitar à toa.
export function mudou(antigo, novo) {
  if (!antigo) return true;
  const semData = ({ atualizadoEm, ...resto }) => resto;
  return JSON.stringify(semData(antigo)) !== JSON.stringify(semData(novo));
}

function lerArgumento(nome) {
  const i = process.argv.indexOf(nome);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function principal() {
  const temporada = lerArgumento('--temporada');
  const forcada = lerArgumento('--fonte') ?? process.env.FONTE_DADOS;
  const token = process.env.FOOTBALL_DATA_TOKEN;

  let antigo = null;
  try {
    antigo = JSON.parse(await readFile(ARQUIVO, 'utf8'));
  } catch {
    // primeira execução
  }

  const fontes = escolherFontes({ forcada, atual: antigo?.fonte, token });
  console.log(`Fontes a tentar: ${fontes.join(', ')}`);
  const coleta = await coletarDados({ fontes, temporada, token });

  await baixarEscudos(coleta.times, {
    forcar: process.argv.includes('--escudos'),
    cabecalhos: coleta.fonte === 'sofascore' ? sofascore.CABECALHOS : {},
  });

  const novo = montarDados(coleta, temporada);
  if (!mudou(antigo, novo)) {
    console.log('Nenhuma mudança nos dados.');
    return;
  }
  await writeFile(ARQUIVO, `${JSON.stringify(novo, null, 2)}\n`);
  console.log(`Gravado ${path.relative(RAIZ, ARQUIVO)}: ${novo.jogos.length} jogos, fonte ${novo.fonte}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((erro) => {
    console.error(`Falha ao atualizar os dados: ${erro.message}`);
    if (!process.env.FOOTBALL_DATA_TOKEN) {
      console.error('Dica: com uma chave grátis do football-data.org em FOOTBALL_DATA_TOKEN, ele é usado como alternativa.');
    }
    process.exit(1);
  });
}
