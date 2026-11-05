// Regras do draft: ordem em serpentina, validação das escolhas e escolha
// automática. Módulo puro (sem DOM nem Firebase), testado no Node.

export const POSICOES = ['GOL', 'LAT', 'ZAG', 'MEI', 'ATA'];

export const NOMES_POSICAO = {
  GOL: 'Goleiro', LAT: 'Lateral', ZAG: 'Zagueiro', MEI: 'Meia', ATA: 'Atacante',
};

export const CONFIG_PADRAO = {
  times: 20,
  jogadores: 23,
  minimos: { GOL: 2, LAT: 4, ZAG: 4, MEI: 4, ATA: 4 },
  maxPorClube: 4,
  segundos: 90,
};

export function totalEscolhas(ordem, config) {
  return ordem.length * config.jogadores;
}

// Serpentina: 1→T na primeira rodada, T→1 na segunda, e assim por diante.
export function indiceNaOrdem(n, totalTimes) {
  const rodada = Math.floor(n / totalTimes);
  const pos = n % totalTimes;
  return rodada % 2 === 0 ? pos : totalTimes - 1 - pos;
}

export function timeDaEscolha(n, ordem) {
  return ordem[indiceNaOrdem(n, ordem.length)];
}

export function rodadaDaEscolha(n, totalTimes) {
  return Math.floor(n / totalTimes) + 1;
}

export function proximasEscolhas(n, ordem, config, quantidade) {
  const fim = totalEscolhas(ordem, config);
  const lista = [];
  for (let k = n; k < fim && lista.length < quantidade; k += 1) lista.push({ n: k, timeId: timeDaEscolha(k, ordem) });
  return lista;
}

function aleatorioCripto(max) {
  const v = new Uint32Array(1);
  globalThis.crypto.getRandomValues(v);
  return v[0] % max;
}

// Fisher–Yates. `aleatorio(max)` devolve um inteiro em [0, max).
export function sortearOrdem(ids, aleatorio = aleatorioCripto) {
  const ordem = [...ids];
  for (let i = ordem.length - 1; i > 0; i -= 1) {
    const j = aleatorio(i + 1);
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }
  return ordem;
}

export function resumoElenco(escolhas, config) {
  const porPosicao = Object.fromEntries(POSICOES.map((p) => [p, 0]));
  const porClube = new Map();
  for (const e of escolhas) {
    porPosicao[e.posicao] = (porPosicao[e.posicao] ?? 0) + 1;
    porClube.set(e.clubeId, (porClube.get(e.clubeId) ?? 0) + 1);
  }
  const faltam = Object.fromEntries(POSICOES.map((p) => [p, Math.max(0, (config.minimos[p] ?? 0) - porPosicao[p])]));
  const faltamTotal = Object.values(faltam).reduce((a, b) => a + b, 0);
  const restantes = config.jogadores - escolhas.length;
  return { total: escolhas.length, porPosicao, porClube, faltam, faltamTotal, restantes, livres: restantes - faltamTotal };
}

function descreverFaltas(faltam) {
  const partes = POSICOES.filter((p) => faltam[p] > 0).map((p) => `${faltam[p]} ${p}`);
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}` : partes[0] ?? '';
}

// Diz se o time pode escolher `atleta` agora. `ocupados` são os ids já
// escolhidos por qualquer time; `nomeClube` só serve para a mensagem.
export function validarEscolha(escolhas, atleta, config, { ocupados = new Set(), nomeClube = (id) => `clube ${id}` } = {}) {
  if (ocupados.has(atleta.id)) return { ok: false, codigo: 'ocupado', motivo: 'Jogador já escolhido' };
  const resumo = resumoElenco(escolhas, config);
  if (resumo.restantes <= 0) return { ok: false, codigo: 'completo', motivo: 'Elenco completo' };
  if ((resumo.porClube.get(atleta.clubeId) ?? 0) >= config.maxPorClube) {
    return { ok: false, codigo: 'clube', motivo: `Você já tem ${config.maxPorClube} jogadores do ${nomeClube(atleta.clubeId)}` };
  }
  // Depois desta escolha, as vagas que sobram precisam cobrir os mínimos.
  const faltaDepois = resumo.faltamTotal - (resumo.faltam[atleta.posicao] > 0 ? 1 : 0);
  if (faltaDepois > resumo.restantes - 1) {
    return { ok: false, codigo: 'minimos', motivo: `Guarde as vagas: ainda faltam ${descreverFaltas(resumo.faltam)}` };
  }
  return { ok: true };
}

export function compararAtletas(a, b) {
  return b.media - a.media || b.preco - a.preco || a.id - b.id;
}

// Escolha quando o relógio estoura: o primeiro válido da fila do time; senão,
// o melhor disponível válido (maior média, depois maior preço).
export function escolhaAutomatica(escolhas, fila, atletas, config, { ocupados = new Set() } = {}) {
  const porId = new Map(atletas.map((a) => [a.id, a]));
  for (const id of fila ?? []) {
    const atleta = porId.get(id);
    if (atleta && validarEscolha(escolhas, atleta, config, { ocupados }).ok) return { atleta, daFila: true };
  }
  const candidatos = atletas.filter((a) => !ocupados.has(a.id)).sort(compararAtletas);
  const atleta = candidatos.find((a) => validarEscolha(escolhas, a, config, { ocupados }).ok);
  return atleta ? { atleta, daFila: false } : null;
}

const celula = (v) => {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV com ";" (o Excel em português usa vírgula como decimal) e BOM para acentos.
export function gerarCSV(escolhas, { nomeTime, nomeClube, totalTimes }) {
  const linhas = [['Escolha', 'Rodada', 'Time', 'Jogador', 'Posição', 'Clube', 'Automática']];
  for (const e of [...escolhas].sort((a, b) => a.n - b.n)) {
    linhas.push([e.n + 1, rodadaDaEscolha(e.n, totalTimes), nomeTime(e.timeId), e.apelido, e.posicao, nomeClube(e.clubeId), e.automatica ? 'sim' : 'não']);
  }
  return `﻿${linhas.map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`;
}
