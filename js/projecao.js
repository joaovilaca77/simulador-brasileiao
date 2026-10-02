// Tabela projetada por rodada e mesclagem de palpites.

import { calcularClassificacao, palpiteCompleto, jogoTravado } from './tabela.js?v=3fe06855e4';

function agruparPorRodada(jogos) {
  const rodadas = new Map();
  for (const j of jogos) {
    if (!rodadas.has(j.rodada)) rodadas.set(j.rodada, []);
    rodadas.get(j.rodada).push(j);
  }
  return new Map([...rodadas.entries()].sort((a, b) => a[0] - b[0]));
}

// Menor rodada com jogo pendente. Uma rodada cuja seguinte já foi quase toda
// disputada é ignorada, para um jogo adiado não prender a rodada atual.
export function rodadaAtual(jogos) {
  const rodadas = agruparPorRodada(jogos);
  for (const [n, lista] of rodadas) {
    if (lista.every((j) => j.status === 'encerrado')) continue;
    const seguinte = rodadas.get(n + 1);
    const seguinteDisputada = seguinte
      && seguinte.filter((j) => j.status === 'encerrado').length * 2 >= seguinte.length;
    if (!seguinteDisputada) return n;
  }
  return null;
}

export function montarSnapshot(times, jogos, palpites, rodada, agora = Date.now()) {
  const pendentes = jogos.filter((j) => j.status !== 'encerrado');
  return {
    rodada,
    salvoEm: agora,
    jogosPendentes: pendentes.length,
    jogosPalpitados: pendentes.filter((j) => palpiteCompleto(palpites[j.id])).length,
    classificacao: calcularClassificacao(times, jogos, palpites)
      .map(({ timeId, pos, pts, sg, gp }) => ({ timeId, pos, pts, sg, gp })),
  };
}

// Mescla dois conjuntos de palpites jogo a jogo; vence o salvo por último.
// Palpites apagados ficam como { m: null, v: null } para não ressuscitarem.
export function mesclarPalpites(a = {}, b = {}) {
  const resultado = { ...a };
  for (const [id, p] of Object.entries(b)) {
    if (!resultado[id] || (p.salvoEm ?? 0) > (resultado[id].salvoEm ?? 0)) resultado[id] = p;
  }
  return resultado;
}

// Mantém só palpites de jogos que existem nos dados atuais.
export function filtrarPalpites(palpites, jogos) {
  const ids = new Set(jogos.map((j) => String(j.id)));
  return Object.fromEntries(Object.entries(palpites).filter(([id]) => ids.has(id)));
}

// Aplica uma alteração respeitando a trava; devolve o novo objeto ou null.
export function definirPalpite(palpites, jogo, m, v, agora = Date.now()) {
  if (jogoTravado(jogo, agora)) return null;
  return { ...palpites, [jogo.id]: { m, v, salvoEm: agora } };
}
