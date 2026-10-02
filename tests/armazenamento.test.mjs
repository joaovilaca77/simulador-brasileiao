import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore, FirebaseStore } from '../js/armazenamento.js';

function storageFalso() {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: (k) => dados.delete(k),
  };
}

test('LocalStore guarda palpites e projeções por temporada', async () => {
  const storage = storageFalso();
  const a = new LocalStore('2026', storage);
  await a.salvarPalpites({ 1: { m: 1, v: 0, salvoEm: 1 } });
  await a.salvarProjecao({ rodada: 3, classificacao: [] });
  await a.salvarProjecao({ rodada: 2, classificacao: [] });
  await a.salvarProjecao({ rodada: 3, classificacao: [{ timeId: 1 }] });

  assert.deepEqual(await a.carregarPalpites(), { 1: { m: 1, v: 0, salvoEm: 1 } });
  assert.deepEqual((await a.carregarProjecoes()).map((p) => p.rodada), [2, 3]);
  assert.deepEqual((await a.carregarProjecoes())[1].classificacao, [{ timeId: 1 }]);
  assert.deepEqual(await new LocalStore('2027', storage).carregarPalpites(), {});
});

test('LocalStore funciona sem storage ou com storage quebrado', async () => {
  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('cheio'); } };
  for (const storage of [null, quebrado]) {
    const s = new LocalStore('2026', storage);
    await s.salvarPalpites({ 1: { m: 0, v: 0 } });
    assert.deepEqual(await s.carregarPalpites(), {});
    assert.deepEqual(await s.carregarProjecoes(), []);
  }
});

// Firestore falso, com a mesma forma das funções do SDK modular.
function firestoreFalso() {
  const docs = new Map();
  const fs = {
    doc: (base, ...partes) => ({ caminho: (base.caminho ? [base.caminho, ...partes] : partes).join('/') }),
    collection: (_db, ...partes) => ({ caminho: partes.join('/') }),
    setDoc: async (ref, dados) => { docs.set(ref.caminho, structuredClone(dados)); },
    getDoc: async (ref) => ({ exists: () => docs.has(ref.caminho), data: () => structuredClone(docs.get(ref.caminho)) }),
    getDocs: async (ref) => ({
      docs: [...docs.entries()]
        .filter(([k]) => k.startsWith(`${ref.caminho}/`) && !k.slice(ref.caminho.length + 1).includes('/'))
        .map(([, v]) => ({ data: () => structuredClone(v) })),
    }),
  };
  return { fs, docs };
}

test('FirebaseStore grava nos caminhos do usuário', async () => {
  const { fs, docs } = firestoreFalso();
  const s = new FirebaseStore({ db: {}, fs, uid: 'u1', temporada: 2026 });

  assert.deepEqual(await s.carregarPalpites(), {});
  await s.salvarPerfil({ nome: 'Ana', foto: null });
  await s.salvarPalpites({ 10: { m: 2, v: 1, salvoEm: 5 } });
  await s.salvarProjecao({ rodada: 12, classificacao: [] });
  await s.salvarProjecao({ rodada: 3, classificacao: [] });

  assert.deepEqual([...docs.keys()].sort(), [
    'usuarios/u1',
    'usuarios/u1/temporadas/2026',
    'usuarios/u1/temporadas/2026/projecoes/12',
    'usuarios/u1/temporadas/2026/projecoes/3',
  ]);
  assert.equal(docs.get('usuarios/u1').nome, 'Ana');
  assert.deepEqual(await s.carregarPalpites(), { 10: { m: 2, v: 1, salvoEm: 5 } });
  assert.deepEqual((await s.carregarProjecoes()).map((p) => p.rodada), [3, 12]);
  assert.equal(typeof docs.get('usuarios/u1/temporadas/2026').atualizadoEm, 'number');
});
