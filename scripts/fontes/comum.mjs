// Utilitários compartilhados pelas fontes de dados.

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const REPETIR_PADRAO = [403, 429, 500, 502, 503, 504];

export async function buscarJSON(url, {
  fetch = globalThis.fetch, headers = {}, tentativas = 4, pausaBase = 2000, repetirEm = REPETIR_PADRAO,
} = {}) {
  for (let i = 1; ; i += 1) {
    const resp = await fetch(url, { headers });
    if (resp.ok) return resp.json();
    if (!repetirEm.includes(resp.status) || i >= tentativas) throw new Error(`HTTP ${resp.status} em ${url}`);
    await esperar(pausaBase * 2 ** (i - 1));
  }
}
