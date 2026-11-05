// Utilitários para baixar dados e imagens das APIs.

import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

const EXTENSOES = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/jpeg': 'jpg' };

async function existe(arquivo) {
  try {
    await access(arquivo);
    return true;
  } catch {
    return false;
  }
}

// Baixa a imagem de cada item (`item.imagemUrl`) para `pasta/{id}.{ext}` e
// preenche `item.escudo` com o caminho relativo ao site. Falhas não param a
// coleta: o site mostra a sigla no lugar.
export async function baixarEscudos(itens, {
  fetch = globalThis.fetch, pasta, prefixo, cabecalhos = {}, forcar = false, pausa = 200, log = console.log,
}) {
  await mkdir(pasta, { recursive: true });
  let baixados = 0;
  for (const item of itens) {
    let atual = null;
    for (const ext of Object.values(EXTENSOES)) {
      if (await existe(path.join(pasta, `${item.id}.${ext}`))) { atual = ext; break; }
    }
    if (atual && !forcar) {
      item.escudo = `${prefixo}/${item.id}.${atual}`;
      continue;
    }
    if (!item.imagemUrl) continue;
    try {
      const resp = await fetch(item.imagemUrl, { headers: { ...cabecalhos, Accept: 'image/*' } });
      const tipo = (resp.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ext = EXTENSOES[tipo];
      if (!ext) throw new Error(`tipo inesperado "${tipo}"`);
      const bytes = Buffer.from(await resp.arrayBuffer());
      if (bytes.length < 100) throw new Error('imagem vazia');
      await writeFile(path.join(pasta, `${item.id}.${ext}`), bytes);
      item.escudo = `${prefixo}/${item.id}.${ext}`;
      baixados += 1;
    } catch (erro) {
      log(`Escudo de ${item.nome} não baixado: ${erro.message}`);
      if (atual) item.escudo = `${prefixo}/${item.id}.${atual}`;
    }
    if (pausa) await esperar(pausa);
  }
  log(`Escudos: ${baixados} baixados, ${itens.filter((t) => t.escudo).length} de ${itens.length} disponíveis.`);
  return itens;
}

// Compara ignorando a data de atualização, para não commitar à toa.
export function mudou(antigo, novo) {
  if (!antigo) return true;
  const semData = ({ atualizadoEm, ...resto }) => resto;
  return JSON.stringify(semData(antigo)) !== JSON.stringify(semData(novo));
}
