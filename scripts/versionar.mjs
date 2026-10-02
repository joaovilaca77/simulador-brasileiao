#!/usr/bin/env node
// Carimba as referências ao CSS e aos módulos JS com ?v=<hash do conteúdo>.
// O GitHub Pages deixa o navegador guardar esses arquivos por 10 minutos;
// sem o carimbo, logo depois de publicar dá para ver o HTML novo com o CSS
// e o JS antigos. Com ele, qualquer mudança gera endereços novos.
//
// Uso: node scripts/versionar.mjs            (atualiza os arquivos)
//      node scripts/versionar.mjs --verificar (falha se estiver desatualizado)

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARIMBO = /\?v=[0-9a-f]+/g;
// Editado à mão por quem configura o Firebase (às vezes pelo site do GitHub,
// sem rodar este script): fica fora do hash para não exigir um novo carimbo.
const FORA_DO_HASH = new Set(['js/firebase-config.js']);

// Referências locais: no HTML, href/src de css/ e js/; nos módulos, imports relativos.
const REF_HTML = /((?:href|src)="(?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"/g;
const REF_JS = /((?:from\s+|import\s*\(\s*)'\.\/[\w.-]+\.js)(?:\?v=[0-9a-f]+)?'/g;

async function arquivos() {
  const js = (await readdir(path.join(RAIZ, 'js'))).filter((f) => f.endsWith('.js')).sort().map((f) => `js/${f}`);
  return { html: 'index.html', ativos: ['css/style.css', ...js] };
}

// Hash do conteúdo sem os carimbos, para o resultado não depender dele mesmo.
export function calcularVersao(conteudos) {
  const h = createHash('sha256');
  for (const c of conteudos) h.update(c.replace(CARIMBO, '')).update('\0');
  return h.digest('hex').slice(0, 10);
}

export function carimbarHTML(texto, versao) {
  return texto.replace(REF_HTML, `$1?v=${versao}"`);
}

export function carimbarJS(texto, versao) {
  return texto.replace(REF_JS, `$1?v=${versao}'`);
}

export async function versionar({ verificar = false } = {}) {
  const { html, ativos } = await arquivos();
  const ler = (f) => readFile(path.join(RAIZ, f), 'utf8');
  const conteudos = new Map();
  for (const f of [...ativos, html]) conteudos.set(f, await ler(f));

  const versao = calcularVersao(ativos.filter((f) => !FORA_DO_HASH.has(f)).map((f) => conteudos.get(f)));
  const desatualizados = [];
  for (const [f, texto] of conteudos) {
    const novo = f.endsWith('.html') ? carimbarHTML(texto, versao) : f.endsWith('.js') ? carimbarJS(texto, versao) : texto;
    if (novo === texto) continue;
    desatualizados.push(f);
    if (!verificar) await writeFile(path.join(RAIZ, f), novo);
  }
  return { versao, desatualizados };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const verificar = process.argv.includes('--verificar');
  const { versao, desatualizados } = await versionar({ verificar });
  if (verificar && desatualizados.length) {
    console.error(`Carimbo de versão desatualizado em: ${desatualizados.join(', ')}. Rode: npm run versionar`);
    process.exit(1);
  }
  console.log(desatualizados.length && !verificar
    ? `Versão ${versao} aplicada em: ${desatualizados.join(', ')}`
    : `Versão ${versao} já aplicada.`);
}
