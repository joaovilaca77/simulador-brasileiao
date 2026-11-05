// Utilitários de interface: criar elementos, avisos, escudos, fotos e tema.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

// Cria um elemento. Textos sempre por textContent (dados vêm de usuários e APIs).
export function el(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'on') for (const [evento, fn] of Object.entries(v)) n.addEventListener(evento, fn);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role' || k === 'for') n.setAttribute(k, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) n.append(f);
  return n;
}

let timerToast;
export function toast(texto, tipo = 'info') {
  const t = $('#toast');
  t.textContent = texto;
  t.dataset.tipo = tipo;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, 4000);
}

// Esconde o aviso só se ainda for aquele texto (ex.: "é a sua vez" que já passou).
export function esconderToast(texto) {
  const t = $('#toast');
  if (!t.hidden && t.textContent === texto) t.hidden = true;
}

export function aviso(texto) {
  const a = $('#aviso');
  a.replaceChildren();
  a.hidden = !texto;
  if (texto) a.append(el('div', { text: texto }));
}

export const fmtPreco = (v) => `C$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtMedia = (v) => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function normalizarTexto(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Escudo do clube; sem imagem (ou se falhar), a sigla.
export function escudo(clube, tamanho = 22) {
  const sigla = el('span', { class: 'escudo-sigla', text: clube?.sigla ?? '?', 'aria-hidden': 'true' });
  sigla.style.setProperty('--tam', `${tamanho}px`);
  if (!clube?.escudo) return sigla;
  const img = el('img', { class: 'escudo', src: clube.escudo, alt: '', loading: 'lazy', width: tamanho, height: tamanho });
  img.addEventListener('error', () => img.replaceWith(sigla), { once: true });
  return img;
}

// Foto do jogador; sem foto, as iniciais.
export function foto(atleta, tamanho = 36) {
  const iniciais = (atleta.apelido ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const sub = el('span', { class: 'foto-iniciais', text: iniciais, 'aria-hidden': 'true' });
  sub.style.setProperty('--tam', `${tamanho}px`);
  if (!atleta.foto) return sub;
  const img = el('img', { class: 'foto', src: atleta.foto, alt: '', loading: 'lazy', width: tamanho, height: tamanho, referrerPolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(sub), { once: true });
  return img;
}

export function tagPosicao(posicao) {
  return el('span', { class: `tag-pos pos-${posicao}`, text: posicao });
}

const STATUS = {
  provavel: ['✓', 'Provável'], duvida: ['?', 'Dúvida'], suspenso: ['■', 'Suspenso'],
  contundido: ['✚', 'Contundido'], nulo: ['–', 'Sem status'],
};

export function iconeStatus(status) {
  const [icone, nome] = STATUS[status] ?? STATUS.nulo;
  return el('span', { class: `status status-${status}`, text: icone, title: nome, 'aria-label': nome });
}

// ---------- Tema ----------

const CHAVE_TEMA = 'simulador:tema';

function temaSalvo() {
  try {
    const t = localStorage.getItem(CHAVE_TEMA);
    return t === 'claro' || t === 'escuro' ? t : null;
  } catch {
    return null;
  }
}

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  const proximo = tema === 'escuro' ? 'claro' : 'escuro';
  $('#btn-tema').setAttribute('aria-label', `Usar tema ${proximo}`);
  $('#btn-tema').title = `Usar tema ${proximo}`;
}

// O <head> já aplicou o tema inicial; aqui ficam o botão e o acompanhamento
// do sistema enquanto a pessoa não escolheu um tema.
export function ligarTema() {
  aplicarTema(document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro');
  $('#btn-tema').addEventListener('click', () => {
    const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
    aplicarTema(novo);
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      // sem storage: vale só nesta visita
    }
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (ev) => {
    if (!temaSalvo()) aplicarTema(ev.matches ? 'escuro' : 'claro');
  });
}

export function baixarArquivo(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    toast('Link copiado.');
  } catch {
    window.prompt('Copie o link:', texto);
  }
}
