// Aba "Evolução": gráfico de linhas com a posição projetada de cada time
// por rodada (até 4 em destaque, os demais em cinza) e a tabela equivalente.

const SVG = 'http://www.w3.org/2000/svg';
const MAX_SELECAO = 4;
const TIMES_NA_TABELA = 20;
const LIMITES_ZONA = [4.5, 6.5, 12.5, 16.5];
const TICKS_Y = [1, 5, 10, 15, 20];

function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function el(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null) n.append(f);
  return n;
}

const corDoSlot = (slot) => `var(--serie-${slot + 1})`;

function seletor({ times, selecao, ordem, aoAlterarSelecao }) {
  const caixa = el('div', { class: 'seletor', role: 'group', 'aria-label': 'Times em destaque (até 4)' });
  const porTime = new Map(selecao.map((s) => [s.timeId, s.slot]));
  for (const timeId of ordem) {
    const time = times.get(timeId);
    const slot = porTime.get(timeId);
    const ativo = slot != null;
    const chave = el('span', { class: 'chave', 'aria-hidden': 'true' });
    if (ativo) chave.style.setProperty('--chave', corDoSlot(slot));
    const botao = el('button', { type: 'button', 'aria-pressed': String(ativo) }, chave, time.nome);
    botao.disabled = !ativo && selecao.length >= MAX_SELECAO;
    if (botao.disabled) botao.title = 'Escolha no máximo 4 times';
    botao.addEventListener('click', () => {
      if (ativo) {
        aoAlterarSelecao(selecao.filter((s) => s.timeId !== timeId));
      } else {
        const usados = new Set(selecao.map((s) => s.slot));
        const livre = [0, 1, 2, 3].find((s) => !usados.has(s));
        aoAlterarSelecao([...selecao, { timeId, slot: livre }]);
      }
    });
    caixa.append(botao);
  }
  return caixa;
}

function legenda(times, selecao) {
  const lista = el('ul', { class: 'legenda-series', 'aria-label': 'Legenda' });
  for (const { timeId, slot } of [...selecao].sort((a, b) => a.slot - b.slot)) {
    const chave = el('span', { class: 'chave', 'aria-hidden': 'true' });
    chave.style.setProperty('--chave', corDoSlot(slot));
    lista.append(el('li', {}, chave, times.get(timeId).nome));
  }
  return lista;
}

function grafico(container, { projecoes, times, selecao }) {
  const largura = Math.max(320, container.clientWidth || 640);
  const estreito = largura < 520;
  const altura = estreito ? 300 : 360;
  const m = { topo: 12, dir: estreito ? 84 : 128, base: 28, esq: 30 };
  const rodadas = projecoes.map((p) => p.rodada);
  const xMin = Math.min(...rodadas);
  const xMax = Math.max(...rodadas);
  const larguraUtil = largura - m.esq - m.dir;
  const x = (r) => (xMax === xMin ? m.esq + larguraUtil / 2 : m.esq + ((r - xMin) / (xMax - xMin)) * larguraUtil);
  const y = (pos) => m.topo + ((pos - 1) / 19) * (altura - m.topo - m.base);

  const raiz = svg('svg', {
    viewBox: `0 0 ${largura} ${altura}`, role: 'img',
    'aria-label': 'Posição final projetada por rodada. Os dados completos estão na tabela abaixo.',
  });

  const grade = svg('g', { class: 'grade-y' });
  for (const pos of TICKS_Y) {
    grade.append(svg('line', { x1: m.esq, x2: largura - m.dir, y1: y(pos), y2: y(pos) }));
    const rotulo = svg('text', { x: m.esq - 8, y: y(pos) + 4, 'text-anchor': 'end', class: 'rotulo-eixo' });
    rotulo.textContent = `${pos}º`;
    grade.append(rotulo);
  }
  for (const lim of LIMITES_ZONA) {
    grade.append(svg('line', { class: 'limite', x1: m.esq, x2: largura - m.dir, y1: y(lim), y2: y(lim) }));
  }
  raiz.append(grade);

  // Rótulos do eixo X sem amontoar.
  const passo = Math.max(1, Math.ceil(rodadas.length / Math.floor(larguraUtil / 44)));
  rodadas.forEach((r, i) => {
    if (i % passo !== 0 && i !== rodadas.length - 1) return;
    const t = svg('text', { x: x(r), y: altura - 8, 'text-anchor': 'middle', class: 'rotulo-eixo' });
    t.textContent = `R${r}`;
    raiz.append(t);
  });

  const posicoes = (timeId) => projecoes
    .map((p) => ({ r: p.rodada, pos: p.classificacao.find((c) => c.timeId === timeId)?.pos }))
    .filter((p) => p.pos != null);
  const caminho = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.r).toFixed(1)},${y(p.pos).toFixed(1)}`).join('');

  const destacados = new Set(selecao.map((s) => s.timeId));
  const contexto = svg('g', { 'aria-hidden': 'true' });
  for (const timeId of times.keys()) {
    if (destacados.has(timeId)) continue;
    const pts = posicoes(timeId);
    if (pts.length > 1) contexto.append(svg('path', { class: 'contexto', d: caminho(pts) }));
  }
  raiz.append(contexto);

  const series = svg('g');
  const rotulos = [];
  for (const { timeId, slot } of selecao) {
    const pts = posicoes(timeId);
    if (!pts.length) continue;
    const cor = corDoSlot(slot);
    if (pts.length > 1) series.append(svg('path', { class: 'serie', d: caminho(pts), style: `stroke:${cor}` }));
    for (const p of pts) {
      series.append(svg('circle', { class: 'ponto', cx: x(p.r), cy: y(p.pos), r: 4.5, style: `fill:${cor}` }));
    }
    const ultimo = pts.at(-1);
    rotulos.push({ timeId, y: y(ultimo.pos), x: x(ultimo.r) });
  }
  raiz.append(series);

  // Rótulos diretos no fim das linhas, afastados para não se sobreporem.
  rotulos.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rotulos.length; i += 1) {
    rotulos[i].y = Math.max(rotulos[i].y, rotulos[i - 1].y + 14);
  }
  for (const r of rotulos) {
    const t = svg('text', { x: r.x + 10, y: r.y + 4, class: 'rotulo-serie' });
    const nome = times.get(r.timeId).nome;
    t.textContent = estreito ? times.get(r.timeId).sigla : nome;
    raiz.append(t);
  }

  // Mira + dica.
  const mira = svg('line', { class: 'mira', y1: m.topo, y2: altura - m.base, visibility: 'hidden' });
  const alvo = svg('rect', {
    class: 'alvo', x: m.esq - 12, y: 0, width: larguraUtil + 24, height: altura, tabindex: 0,
    'aria-label': 'Use as setas para percorrer as rodadas',
  });
  raiz.append(mira, alvo);

  const dica = el('div', { class: 'dica', hidden: '' });
  let indice = rodadas.length - 1;

  function mostrar(i) {
    indice = Math.max(0, Math.min(rodadas.length - 1, i));
    const proj = projecoes[indice];
    const px = x(proj.rodada);
    mira.setAttribute('x1', px);
    mira.setAttribute('x2', px);
    mira.setAttribute('visibility', 'visible');

    dica.replaceChildren(el('div', {
      class: 'titulo', text: `Rodada ${proj.rodada} · ${proj.jogosPalpitados} de ${proj.jogosPendentes} jogos com palpite`,
    }));
    const linhas = selecao
      .map((s) => ({ ...s, pos: proj.classificacao.find((c) => c.timeId === s.timeId)?.pos }))
      .filter((s) => s.pos != null)
      .sort((a, b) => a.pos - b.pos);
    for (const s of linhas) {
      const chave = el('i', { class: 'chave' });
      chave.style.setProperty('--chave', corDoSlot(s.slot));
      dica.append(el('div', { class: 'linha' }, chave, el('strong', { text: `${s.pos}º` }), el('span', { text: times.get(s.timeId).nome })));
    }
    if (!linhas.length) dica.append(el('div', { class: 'linha', text: 'Escolha times acima.' }));
    dica.hidden = false;

    const escala = container.clientWidth / largura || 1;
    const esquerda = px * escala;
    const larguraDica = dica.offsetWidth;
    dica.style.left = `${esquerda + 12 + larguraDica > container.clientWidth ? esquerda - 12 - larguraDica : esquerda + 12}px`;
    dica.style.top = `${m.topo * escala}px`;
  }

  function esconder() {
    mira.setAttribute('visibility', 'hidden');
    dica.hidden = true;
  }

  alvo.addEventListener('pointermove', (ev) => {
    const caixa = raiz.getBoundingClientRect();
    const xSvg = ((ev.clientX - caixa.left) / caixa.width) * largura;
    let melhor = 0;
    rodadas.forEach((r, i) => { if (Math.abs(x(r) - xSvg) < Math.abs(x(rodadas[melhor]) - xSvg)) melhor = i; });
    mostrar(melhor);
  });
  alvo.addEventListener('pointerleave', esconder);
  alvo.addEventListener('focus', () => mostrar(indice));
  alvo.addEventListener('blur', esconder);
  alvo.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') { mostrar(indice - 1); ev.preventDefault(); }
    if (ev.key === 'ArrowRight') { mostrar(indice + 1); ev.preventDefault(); }
  });

  return [raiz, dica];
}

function tabela(projecoes, times, ordem) {
  const t = el('table', { class: 'tabela historico' });
  const cabecalho = el('tr', {}, el('th', { scope: 'col', class: 'esq', text: 'Time' }));
  for (const p of projecoes) cabecalho.append(el('th', { scope: 'col', class: 'num', text: `R${p.rodada}` }));
  t.append(el('caption', { text: 'Posição final projetada em cada rodada.' }));
  t.append(el('thead', {}, cabecalho));
  const corpo = el('tbody');
  for (const timeId of ordem.slice(0, TIMES_NA_TABELA)) {
    const linha = el('tr', {}, el('th', { scope: 'row', class: 'esq', text: times.get(timeId).nome }));
    for (const p of projecoes) {
      const pos = p.classificacao.find((c) => c.timeId === timeId)?.pos;
      linha.append(el('td', { class: 'num', text: pos ?? '–' }));
    }
    corpo.append(linha);
  }
  t.append(corpo);
  return el('div', { class: 'tabela-wrap' }, t);
}

export function desenharEvolucao(container, { projecoes, times, selecao, logado, firebaseDisponivel, aoAlterarSelecao }) {
  container.replaceChildren();

  const dicaLogin = firebaseDisponivel && !logado
    ? el('p', { class: 'mudo nota', text: 'Você está no modo visitante: este histórico fica só neste navegador. Entre com Google para guardar na nuvem e ver em qualquer aparelho.' })
    : null;

  if (!projecoes.length) {
    container.append(el('p', { class: 'vazio', text: 'Ainda não há projeções guardadas. Faça seus palpites: a cada rodada, a tabela prevista por eles fica registrada aqui.' }));
    if (dicaLogin) container.append(dicaLogin);
    return;
  }

  const ultima = projecoes.at(-1);
  const ordem = ultima.classificacao.map((c) => c.timeId).filter((id) => times.has(id));

  container.append(seletor({ times, selecao, ordem, aoAlterarSelecao }));
  if (selecao.length >= 2) container.append(legenda(times, selecao));
  const area = el('div', { class: 'grafico' });
  container.append(area);
  area.append(...grafico(area, { projecoes, times, selecao }));
  container.append(tabela(projecoes, times, ordem));
  if (dicaLogin) container.append(dicaLogin);
}
