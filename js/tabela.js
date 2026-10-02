// Cálculo da classificação do Brasileirão a partir dos jogos e dos palpites.
// Módulo puro (sem DOM), usado pelo site e pelos testes no Node.

export const GOLS_MAX = 20;

// Faixas de classificação. As vagas reais mudam conforme os campeões da
// Copa do Brasil e da Libertadores; ajuste aqui se necessário.
export const ZONAS = [
  { id: 'libertadores', nome: 'Libertadores', de: 1, ate: 4 },
  { id: 'pre-libertadores', nome: 'Pré-Libertadores', de: 5, ate: 6 },
  { id: 'sul-americana', nome: 'Sul-Americana', de: 7, ate: 12 },
  { id: 'rebaixamento', nome: 'Rebaixamento', de: 17, ate: 20 },
];

export function zonaDaPosicao(pos) {
  return ZONAS.find((z) => pos >= z.de && pos <= z.ate) ?? null;
}

function golValido(g) {
  return Number.isInteger(g) && g >= 0 && g <= GOLS_MAX;
}

export function palpiteCompleto(p) {
  return Boolean(p) && golValido(p.m) && golValido(p.v);
}

// Um jogo só aceita palpite enquanto não começou.
export function jogoTravado(jogo, agora = Date.now()) {
  if (jogo.status === 'encerrado' || jogo.status === 'ao_vivo') return true;
  if (jogo.status === 'adiado') return false;
  const inicio = Date.parse(jogo.inicio);
  return Number.isFinite(inicio) && agora >= inicio;
}

// Placar que conta para a tabela: o real, se o jogo terminou; senão o palpite.
export function placarDoJogo(jogo, palpites = {}) {
  if (jogo.status === 'encerrado' && golValido(jogo.golsMandante) && golValido(jogo.golsVisitante)) {
    return { m: jogo.golsMandante, v: jogo.golsVisitante, origem: 'real' };
  }
  const p = palpites[jogo.id];
  if (palpiteCompleto(p)) return { m: p.m, v: p.v, origem: 'palpite' };
  return null;
}

function linhaVazia(time) {
  return {
    timeId: time.id, nome: time.nome, sigla: time.sigla, cores: time.cores,
    pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0, sg: 0, aproveitamento: 0,
  };
}

function registrar(linha, pro, contra) {
  linha.j += 1;
  linha.gp += pro;
  linha.gc += contra;
  if (pro > contra) { linha.v += 1; linha.pts += 3; }
  else if (pro === contra) { linha.e += 1; linha.pts += 1; }
  else linha.d += 1;
}

function compararPrincipais(a, b) {
  return (b.pts - a.pts) || (b.v - a.v) || (b.sg - a.sg) || (b.gp - a.gp);
}

// Pontos de `a` e `b` nos jogos entre os dois.
function confrontoDireto(a, b, placares) {
  let ptsA = 0;
  let ptsB = 0;
  for (const { jogo, placar } of placares) {
    let golsA; let golsB;
    if (jogo.mandante === a && jogo.visitante === b) { golsA = placar.m; golsB = placar.v; }
    else if (jogo.mandante === b && jogo.visitante === a) { golsA = placar.v; golsB = placar.m; }
    else continue;
    if (golsA > golsB) ptsA += 3;
    else if (golsA < golsB) ptsB += 3;
    else { ptsA += 1; ptsB += 1; }
  }
  return ptsB - ptsA;
}

const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');

// Critérios: pontos, vitórias, saldo, gols pró, confronto direto (só quando
// dois times empatam em tudo) e, no lugar de cartões e sorteio, o nome.
export function calcularClassificacao(times, jogos, palpites = {}) {
  const linhas = new Map(times.map((t) => [t.id, linhaVazia(t)]));
  const placares = [];

  for (const jogo of jogos) {
    const placar = placarDoJogo(jogo, palpites);
    const mandante = linhas.get(jogo.mandante);
    const visitante = linhas.get(jogo.visitante);
    if (!placar || !mandante || !visitante) continue;
    registrar(mandante, placar.m, placar.v);
    registrar(visitante, placar.v, placar.m);
    placares.push({ jogo, placar });
  }

  const ordenadas = [...linhas.values()];
  for (const l of ordenadas) {
    l.sg = l.gp - l.gc;
    l.aproveitamento = l.j ? Math.round((l.pts / (l.j * 3)) * 1000) / 10 : 0;
  }
  ordenadas.sort((a, b) => compararPrincipais(a, b) || porNome(a, b));

  // Reordena os grupos empatados nos critérios principais.
  for (let i = 0; i < ordenadas.length;) {
    let fim = i + 1;
    while (fim < ordenadas.length && compararPrincipais(ordenadas[i], ordenadas[fim]) === 0) fim += 1;
    if (fim - i === 2) {
      const [a, b] = [ordenadas[i], ordenadas[i + 1]];
      if (confrontoDireto(a.timeId, b.timeId, placares) > 0) {
        ordenadas[i] = b;
        ordenadas[i + 1] = a;
      }
    }
    i = fim;
  }

  return ordenadas.map((l, idx) => ({ ...l, pos: idx + 1, zona: zonaDaPosicao(idx + 1)?.id ?? null }));
}
