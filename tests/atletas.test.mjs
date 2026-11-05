import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizarAtleta, normalizarClube, montarDados, coletar } from '../scripts/atualizar-atletas.mjs';
import { baixarEscudos, buscarJSON, mudou } from '../scripts/comum.mjs';

// Resposta no formato de /atletas/mercado do Cartola.
function mercadoFalso({ clubes = 20, porClube = 25 } = {}) {
  const c = {};
  const atletas = [];
  let id = 1000;
  for (let i = 0; i < clubes; i += 1) {
    const clubeId = 260 + i;
    c[clubeId] = { id: clubeId, nome: `Clube ${i}`, abreviacao: `c${i}`, nome_fantasia: `Clube ${i} FC`, escudos: { '60x60': `https://img/${clubeId}.png` } };
    for (let k = 0; k < porClube; k += 1) {
      atletas.push({
        atleta_id: id++, nome: `Nome ${id}`, apelido: `Jogador ${id}`, clube_id: clubeId,
        posicao_id: (k % 6) + 1, status_id: 7, preco_num: 5 + k, media_num: k / 3, jogos_num: k,
        foto: 'https://s.sde.globo.com/media/person_role/x/photo_FORMATO.png',
      });
    }
  }
  c[1] = { id: 1, nome: 'Outros', abreviacao: 'OUT', escudos: {} };
  return { atletas, clubes: c };
}

test('normalizarAtleta converte posição, status e foto; descarta técnicos', () => {
  const base = { atleta_id: 7, nome: 'Fulano de Tal', apelido: 'Fulano', clube_id: 262, status_id: 2, preco_num: 12.345, media_num: 4.567, jogos_num: 9, foto: 'https://x/photo_FORMATO.png' };
  assert.deepEqual(normalizarAtleta({ ...base, posicao_id: 3 }), {
    id: 7, apelido: 'Fulano', nome: 'Fulano de Tal', clubeId: 262, posicao: 'ZAG', status: 'duvida',
    preco: 12.35, media: 4.57, jogos: 9, foto: 'https://x/photo_140x140.png',
  });
  assert.equal(normalizarAtleta({ ...base, posicao_id: 6 }), null);
  assert.equal(normalizarAtleta({ ...base, posicao_id: 1, foto: null }).foto, null);
  assert.equal(normalizarAtleta({ ...base, posicao_id: 5, status_id: 99 }).status, 'nulo');
});

test('normalizarClube tira o nome da sigla, não do apelido', () => {
  // Formato real da API: nome e nome_fantasia trazem a sigla; apelido é o apelido da torcida.
  const fla = { id: 262, nome: 'FLA', abreviacao: 'FLA', slug: 'flamengo', apelido: 'Mengão', nome_fantasia: 'FLA', escudos: { '30x30': 'p', '60x60': 'g' } };
  assert.deepEqual(normalizarClube(fla), { id: 262, nome: 'Flamengo', sigla: 'FLA', imagemUrl: 'g' });
  assert.equal(normalizarClube({ id: 1, nome: 'SAO', abreviacao: 'SAO', apelido: 'Tricolor', slug: 'sao-paulo' }).nome, 'São Paulo');
  assert.equal(normalizarClube({ id: 2, nome: 'FLU', abreviacao: 'FLU', apelido: 'Tricolor', slug: 'fluminense' }).nome, 'Fluminense');
  // clube fora da tabela: usa o slug
  assert.equal(normalizarClube({ id: 3, nome: 'XYZ', abreviacao: 'XYZ', slug: 'novo-clube-sc' }).nome, 'Novo-Clube-SC');
  assert.equal(normalizarClube({ id: 4, nome: 'ABC', abreviacao: 'ABC' }).nome, 'ABC');
});

test('montarDados filtra clubes sem jogadores, ordena e valida o tamanho', () => {
  const dados = montarDados({ status: { temporada: 2027, rodada_atual: 1 }, mercado: mercadoFalso() }, new Date('2027-02-01T00:00:00Z'));
  assert.equal(dados.temporada, '2027');
  assert.equal(dados.clubes.length, 20);
  assert.ok(dados.atletas.every((a) => a.posicao !== 'TEC'));
  assert.equal(dados.atletas.length, 20 * 25 - 20 * 4); // 4 técnicos por clube no falso (k = 5, 11, 17, 23)
  assert.ok(dados.atletas[0].media >= dados.atletas.at(-1).media);
  assert.throws(() => montarDados({ status: {}, mercado: mercadoFalso({ clubes: 19 }) }), /20 clubes/);
  assert.throws(() => montarDados({ status: {}, mercado: mercadoFalso({ porClube: 6 }) }), /400 jogadores/);
});

test('coletar busca status e mercado', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => (url.endsWith('/mercado/status') ? { temporada: 2027 } : mercadoFalso()) };
  };
  const r = await coletar({ fetch });
  assert.equal(r.status.temporada, 2027);
  assert.deepEqual(urls, ['https://api.cartola.globo.com/mercado/status', 'https://api.cartola.globo.com/atletas/mercado']);
});

test('baixarEscudos grava imagens e tolera falhas', async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), 'escudos-'));
  try {
    const png = Buffer.alloc(200, 7);
    const resposta = (status, tipo, corpo) => ({ ok: status === 200, status, headers: new Headers({ 'content-type': tipo }), arrayBuffer: async () => corpo });
    const fetch = async (url) => (url.endsWith('/1') ? resposta(200, 'image/png', png) : resposta(404, 'text/html', Buffer.alloc(0)));
    await writeFile(path.join(pasta, '3.png'), png);
    const itens = [1, 2, 3].map((id) => ({ id, nome: `C${id}`, imagemUrl: `https://x/${id}` }));
    await baixarEscudos(itens, { fetch, pasta, prefixo: 'img/escudos', pausa: 0, log: () => {} });
    assert.deepEqual(itens.map((i) => i.escudo ?? null), ['img/escudos/1.png', null, 'img/escudos/3.png']);
    assert.deepEqual(await readFile(path.join(pasta, '1.png')), png);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test('buscarJSON repete em 429 e desiste em 404; mudou ignora a data', async () => {
  let n = 0;
  const instavel = async () => (++n < 2 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ ok: 1 }) });
  assert.deepEqual(await buscarJSON('u', { fetch: instavel, pausaBase: 1 }), { ok: 1 });
  await assert.rejects(buscarJSON('u', { fetch: async () => ({ ok: false, status: 404 }), pausaBase: 1 }), /HTTP 404/);
  assert.equal(mudou({ a: 1, atualizadoEm: '1' }, { a: 1, atualizadoEm: '2' }), false);
  assert.equal(mudou({ a: 1 }, { a: 2 }), true);
});
