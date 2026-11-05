#!/usr/bin/env node
// Baixa a lista de jogadores do Cartola FC e grava data/atletas.json, com os
// escudos dos clubes em img/escudos/. A API do Cartola é pública, mas não é
// documentada: os campos podem mudar sem aviso.
//
// Uso: node scripts/atualizar-atletas.mjs [--escudos]

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { buscarJSON, baixarEscudos, mudou } from './comum.mjs';

const API = 'https://api.cartola.globo.com';
const MIN_CLUBES = 20;
const MIN_ATLETAS = 400;

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = path.join(RAIZ, 'data', 'atletas.json');

const CABECALHOS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  Accept: 'application/json',
};

// posicao_id do Cartola. O 6 (técnico) não entra no draft.
const POSICOES = { 1: 'GOL', 2: 'LAT', 3: 'ZAG', 4: 'MEI', 5: 'ATA' };

const STATUS = { 2: 'duvida', 3: 'suspenso', 5: 'contundido', 6: 'nulo', 7: 'provavel' };

const numero = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);

export function normalizarAtleta(a) {
  const posicao = POSICOES[a.posicao_id];
  if (!posicao) return null;
  return {
    id: a.atleta_id,
    apelido: a.apelido || a.nome,
    nome: a.nome || a.apelido,
    clubeId: a.clube_id,
    posicao,
    status: STATUS[a.status_id] ?? 'nulo',
    preco: numero(a.preco_num),
    media: numero(a.media_num),
    jogos: Number.isInteger(a.jogos_num) ? a.jogos_num : 0,
    foto: a.foto ? a.foto.replace('FORMATO', '140x140') : null,
  };
}

export function normalizarClube(c) {
  const escudos = c.escudos ?? {};
  return {
    id: c.id,
    nome: c.nome_fantasia || c.nome,
    sigla: (c.abreviacao || c.nome.slice(0, 3)).toUpperCase(),
    imagemUrl: escudos['60x60'] || escudos['45x45'] || escudos['30x30'] || null,
  };
}

export function montarDados({ status, mercado }, agora = new Date()) {
  const atletas = (mercado.atletas ?? []).map(normalizarAtleta).filter(Boolean);
  const comAtletas = new Set(atletas.map((a) => a.clubeId));
  const clubes = Object.values(mercado.clubes ?? {})
    .filter((c) => comAtletas.has(c.id))
    .map(normalizarClube);

  if (clubes.length < MIN_CLUBES) throw new Error(`Esperava ${MIN_CLUBES} clubes, vieram ${clubes.length}`);
  if (atletas.length < MIN_ATLETAS) throw new Error(`Esperava ao menos ${MIN_ATLETAS} jogadores, vieram ${atletas.length}`);

  return {
    fonte: 'cartola',
    temporada: String(status.temporada ?? agora.getFullYear()),
    rodadaAtual: status.rodada_atual ?? null,
    atualizadoEm: agora.toISOString(),
    clubes: clubes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    atletas: atletas.sort((a, b) => b.media - a.media || b.preco - a.preco || a.id - b.id),
  };
}

export async function coletar({ fetch = globalThis.fetch } = {}) {
  const opcoes = { fetch, headers: CABECALHOS };
  const status = await buscarJSON(`${API}/mercado/status`, opcoes);
  const mercado = await buscarJSON(`${API}/atletas/mercado`, opcoes);
  return { status, mercado };
}

async function principal() {
  let antigo = null;
  try {
    antigo = JSON.parse(await readFile(ARQUIVO, 'utf8'));
  } catch {
    // primeira execução
  }

  const dados = montarDados(await coletar());
  console.log(`Cartola ${dados.temporada}: ${dados.clubes.length} clubes, ${dados.atletas.length} jogadores.`);

  await baixarEscudos(dados.clubes, {
    pasta: path.join(RAIZ, 'img', 'escudos'),
    prefixo: 'img/escudos',
    cabecalhos: { 'User-Agent': CABECALHOS['User-Agent'] },
    forcar: process.argv.includes('--escudos'),
  });
  dados.clubes = dados.clubes.map(({ imagemUrl, ...c }) => c);

  if (!mudou(antigo, dados)) {
    console.log('Nenhuma mudança nos jogadores.');
    return;
  }
  await writeFile(ARQUIVO, `${JSON.stringify(dados, null, 1)}\n`);
  console.log(`Gravado ${path.relative(RAIZ, ARQUIVO)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((erro) => {
    console.error(`Falha ao atualizar os jogadores: ${erro.message}`);
    process.exit(1);
  });
}
