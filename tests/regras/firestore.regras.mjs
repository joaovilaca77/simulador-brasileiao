// Testes das regras do Firestore. Precisam do emulador:
//   npm run test:regras
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

let env;
const L = 'ligas/L1';
const D = `${L}/drafts/inicial`;
const CONFIG = { times: 3, jogadores: 2, minimos: { GOL: 0, LAT: 0, ZAG: 0, MEI: 0, ATA: 0 }, maxPorClube: 4, segundos: 90 };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-liga',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

after(async () => env?.cleanup());

async function semear({ status = 'andamento', n = 0, atrasoSeg = 0 } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, L), { nome: 'Liga', temporada: '2027', organizadorUid: 'org', convite: 'CONVITE123', criadaEm: 1 });
    for (const uid of ['ana', 'bia', 'org']) await setDoc(doc(db, `${L}/times/${uid}`), { nome: `Time ${uid}`, donoNome: uid });
    await setDoc(doc(db, D), {
      fase: 'inicial', status, config: CONFIG, ordem: ['ana', 'bia', 'org'], n,
      inicioEscolha: Timestamp.fromMillis(Date.now() - atrasoSeg * 1000), prazoSegundos: 90,
    });
  });
}

const banco = (uid) => env.authenticatedContext(uid).firestore();

function escolher(db, { n, timeId, atletaId, uid, status = 'andamento', automatica = false }) {
  const b = writeBatch(db);
  b.set(doc(db, `${D}/escolhas/${n}`), {
    n, rodada: 1, timeId, atletaId, apelido: `J${atletaId}`, clubeId: 1, posicao: 'MEI', automatica, porUid: uid, em: serverTimestamp(),
  });
  b.set(doc(db, `${D}/ocupados/${atletaId}`), { n });
  b.update(doc(db, D), { n: n + 1, inicioEscolha: serverTimestamp(), prazoSegundos: 90, status });
  return b.commit();
}

beforeEach(() => semear());

test('o dono da vez escolhe; os outros não, antes do prazo', async () => {
  await assertFails(escolher(banco('bia'), { n: 0, timeId: 'ana', atletaId: 10, uid: 'bia' }));
  await assertFails(escolher(banco('bia'), { n: 0, timeId: 'bia', atletaId: 10, uid: 'bia' }));
  await assertSucceeds(escolher(banco('ana'), { n: 0, timeId: 'ana', atletaId: 10, uid: 'ana' }));
  // vez da bia: jogador repetido é negado, outro é aceito
  await assertFails(escolher(banco('bia'), { n: 1, timeId: 'bia', atletaId: 10, uid: 'bia' }));
  await assertSucceeds(escolher(banco('bia'), { n: 1, timeId: 'bia', atletaId: 11, uid: 'bia' }));
});

test('serpentina nas regras: a 4ª escolha é do último da 1ª rodada', async () => {
  await semear({ n: 3 });
  await assertFails(escolher(banco('ana'), { n: 3, timeId: 'ana', atletaId: 20, uid: 'ana' }));
  await assertSucceeds(escolher(banco('org'), { n: 3, timeId: 'org', atletaId: 20, uid: 'org' }));
});

test('depois do prazo + 3 s, qualquer participante faz a escolha automática', async () => {
  await semear({ n: 2, atrasoSeg: 92 });
  await assertFails(escolher(banco('ana'), { n: 2, timeId: 'org', atletaId: 30, uid: 'ana', automatica: true }));
  await semear({ n: 2, atrasoSeg: 95 });
  await assertSucceeds(escolher(banco('ana'), { n: 2, timeId: 'org', atletaId: 30, uid: 'ana', automatica: true }));
});

test('quem não participa não escolhe nem depois do prazo', async () => {
  await semear({ n: 0, atrasoSeg: 200 });
  await assertFails(escolher(banco('estranho'), { n: 0, timeId: 'ana', atletaId: 40, uid: 'estranho' }));
});

test('o organizador escolhe por qualquer time na vez dele', async () => {
  await assertSucceeds(escolher(banco('org'), { n: 0, timeId: 'ana', atletaId: 50, uid: 'org' }));
});

test('draft pausado não aceita escolha de participante', async () => {
  await semear({ status: 'pausado' });
  await assertFails(escolher(banco('ana'), { n: 0, timeId: 'ana', atletaId: 60, uid: 'ana' }));
});

test('participante não avança a vez sem escolha nem mexe na ordem', async () => {
  await assertFails(updateDoc(doc(banco('ana'), D), { n: 1, inicioEscolha: serverTimestamp(), prazoSegundos: 90 }));
  await assertFails(updateDoc(doc(banco('ana'), D), { ordem: ['bia', 'ana', 'org'] }));
  await assertSucceeds(updateDoc(doc(banco('org'), D), { ordem: ['bia', 'ana', 'org'] }));
});

test('a última escolha encerra o draft', async () => {
  await semear({ n: 5 });
  await assertFails(escolher(banco('ana'), { n: 5, timeId: 'ana', atletaId: 70, uid: 'ana', status: 'andamento' }));
  await assertSucceeds(escolher(banco('ana'), { n: 5, timeId: 'ana', atletaId: 70, uid: 'ana', status: 'encerrado' }));
});

test('desfazer: só o organizador apaga escolha e ocupado', async () => {
  await escolher(banco('ana'), { n: 0, timeId: 'ana', atletaId: 80, uid: 'ana' });
  await assertFails(deleteDoc(doc(banco('ana'), `${D}/escolhas/0`)));
  const db = banco('org');
  const b = writeBatch(db);
  b.delete(doc(db, `${D}/escolhas/0`));
  b.delete(doc(db, `${D}/ocupados/80`));
  b.update(doc(db, D), { n: 0, inicioEscolha: serverTimestamp(), prazoSegundos: 90 });
  await assertSucceeds(b.commit());
});

test('fila é privada', async () => {
  await assertSucceeds(setDoc(doc(banco('ana'), `${L}/filas/ana`), { atletas: [1, 2] }));
  await assertFails(getDoc(doc(banco('bia'), `${L}/filas/ana`)));
  await assertFails(setDoc(doc(banco('bia'), `${L}/filas/ana`), { atletas: [] }));
});

test('entrar na liga: só com convite e antes do draft', async () => {
  const time = (convite) => ({ nome: 'Time Caio', donoNome: 'Caio', donoFoto: '', convite, entrouEm: 1 });
  await semear({ status: 'preparando' });
  await assertFails(setDoc(doc(banco('caio'), `${L}/times/caio`), time('ERRADO000')));
  await assertFails(setDoc(doc(banco('caio'), `${L}/times/outro`), time('CONVITE123')));
  await assertSucceeds(setDoc(doc(banco('caio'), `${L}/times/caio`), time('CONVITE123')));
  await semear({ status: 'andamento' });
  await assertFails(setDoc(doc(banco('caio'), `${L}/times/caio`), time('CONVITE123')));
});

test('criar liga só como organizador de si mesmo', async () => {
  const liga = (org) => ({ nome: 'Nova', temporada: '2027', organizadorUid: org, convite: 'ABCDEFGH12', criadaEm: 1 });
  await assertFails(setDoc(doc(banco('ana'), 'ligas/L2'), liga('bia')));
  await assertSucceeds(setDoc(doc(banco('ana'), 'ligas/L2'), liga('ana')));
  await assertFails(setDoc(doc(banco('bia'), 'ligas/L2/drafts/inicial'), { status: 'preparando' }));
  await assertSucceeds(setDoc(doc(banco('ana'), 'ligas/L2/drafts/inicial'), { status: 'preparando' }));
});
