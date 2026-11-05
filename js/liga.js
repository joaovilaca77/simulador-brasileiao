// Acesso ao Firestore: ligas, times, draft, escolhas e filas.
// Recebe as funções do SDK (fb.fs) para funcionar sem build.

import { CONFIG_PADRAO, rodadaDaEscolha, totalEscolhas, timeDaEscolha } from './draft.js?v=daefe94a8f';

function gerarConvite() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const v = new Uint32Array(10);
  crypto.getRandomValues(v);
  return [...v].map((x) => letras[x % letras.length]).join('');
}

export function criarApi({ db, fs }) {
  const refLiga = (id) => fs.doc(db, 'ligas', id);
  const refDraft = (id, d = 'inicial') => fs.doc(db, 'ligas', id, 'drafts', d);
  const refTime = (id, timeId) => fs.doc(db, 'ligas', id, 'times', timeId);

  async function criarLiga({ nome, temporada, usuario, meuTime }) {
    const ref = fs.doc(fs.collection(db, 'ligas'));
    const convite = gerarConvite();
    await fs.setDoc(ref, { nome, temporada, organizadorUid: usuario.uid, convite, criadaEm: fs.serverTimestamp() });
    await fs.setDoc(refDraft(ref.id), {
      fase: 'inicial', status: 'preparando', config: CONFIG_PADRAO, ordem: [], n: 0,
      inicioEscolha: null, prazoSegundos: CONFIG_PADRAO.segundos, prazoRestante: null,
    });
    if (meuTime) {
      await fs.setDoc(refTime(ref.id, usuario.uid), {
        nome: meuTime, donoNome: usuario.displayName ?? '', donoFoto: usuario.photoURL ?? '', convite, entrouEm: fs.serverTimestamp(),
      });
    }
    await registrarNaMinhaLista(usuario.uid, ref.id, { nome, temporada, papel: 'organizador' });
    return ref.id;
  }

  function registrarNaMinhaLista(uid, ligaId, dados) {
    return fs.setDoc(fs.doc(db, 'usuarios', uid, 'ligas', ligaId), { ...dados, em: fs.serverTimestamp() });
  }

  async function minhasLigas(uid) {
    const snap = await fs.getDocs(fs.collection(db, 'usuarios', uid, 'ligas'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function lerLiga(ligaId) {
    const snap = await fs.getDoc(refLiga(ligaId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  async function entrar({ ligaId, convite, usuario, nomeTime, liga }) {
    await fs.setDoc(refTime(ligaId, usuario.uid), {
      nome: nomeTime, donoNome: usuario.displayName ?? '', donoFoto: usuario.photoURL ?? '', convite, entrouEm: fs.serverTimestamp(),
    });
    await registrarNaMinhaLista(usuario.uid, ligaId, { nome: liga.nome, temporada: liga.temporada, papel: 'participante' });
  }

  // Ouve liga, times, draft e escolhas; chama `aoMudar` com tudo junto.
  function ouvir(ligaId, aoMudar, aoErro, draftId = 'inicial') {
    const atual = { liga: undefined, times: undefined, draft: undefined, escolhas: undefined };
    const avisar = () => {
      if (Object.values(atual).every((v) => v !== undefined)) aoMudar({ ...atual });
    };
    const erro = (e) => aoErro?.(e);
    const parar = [
      fs.onSnapshot(refLiga(ligaId), (s) => { atual.liga = s.exists() ? { id: s.id, ...s.data() } : null; avisar(); }, erro),
      fs.onSnapshot(fs.collection(db, 'ligas', ligaId, 'times'), (s) => {
        atual.times = s.docs.map((d) => ({ id: d.id, ...d.data() })); avisar();
      }, erro),
      fs.onSnapshot(refDraft(ligaId, draftId), (s) => {
        atual.draft = s.exists() ? { id: s.id, ...s.data({ serverTimestamps: 'estimate' }), pendente: s.metadata.hasPendingWrites } : null;
        avisar();
      }, erro),
      fs.onSnapshot(fs.collection(db, 'ligas', ligaId, 'drafts', draftId, 'escolhas'), (s) => {
        atual.escolhas = s.docs.map((d) => d.data()).sort((a, b) => a.n - b.n); avisar();
      }, erro),
    ];
    return () => parar.forEach((p) => p());
  }

  function ouvirFila(ligaId, uid, aoMudar) {
    return fs.onSnapshot(fs.doc(db, 'ligas', ligaId, 'filas', uid), (s) => aoMudar(s.exists() ? s.data().atletas ?? [] : []), () => aoMudar([]));
  }

  function salvarFila(ligaId, uid, atletas) {
    return fs.setDoc(fs.doc(db, 'ligas', ligaId, 'filas', uid), { atletas });
  }

  // Faz a escolha da vez numa transação: se a vez já passou ou o jogador foi
  // escolhido por outro, nada é gravado e o erro explica o motivo.
  async function escolher({ ligaId, nEsperado, atleta, automatica, uid, draftId = 'inicial' }) {
    const dref = refDraft(ligaId, draftId);
    await fs.runTransaction(db, async (tx) => {
      const snap = await tx.get(dref);
      const d = snap.data();
      if (d.status !== 'andamento') throw new Error('O draft não está em andamento.');
      if (d.n !== nEsperado) throw new Error('A vez já passou.');
      const oref = fs.doc(dref, 'ocupados', String(atleta.id));
      if ((await tx.get(oref)).exists()) throw new Error(`${atleta.apelido} já foi escolhido.`);
      const total = totalEscolhas(d.ordem, d.config);
      tx.set(fs.doc(dref, 'escolhas', String(d.n)), {
        n: d.n,
        rodada: rodadaDaEscolha(d.n, d.ordem.length),
        timeId: timeDaEscolha(d.n, d.ordem),
        atletaId: atleta.id,
        apelido: atleta.apelido,
        clubeId: atleta.clubeId,
        posicao: atleta.posicao,
        automatica: Boolean(automatica),
        porUid: uid,
        em: fs.serverTimestamp(),
      });
      tx.set(oref, { n: d.n });
      tx.update(dref, {
        n: d.n + 1,
        inicioEscolha: fs.serverTimestamp(),
        prazoSegundos: d.config.segundos,
        status: d.n + 1 === total ? 'encerrado' : 'andamento',
      });
    });
  }

  // ---------- Organizador ----------

  const atualizarDraft = (ligaId, dados, draftId = 'inicial') => fs.updateDoc(refDraft(ligaId, draftId), dados);

  return {
    criarLiga,
    minhasLigas,
    lerLiga,
    entrar,
    ouvir,
    ouvirFila,
    salvarFila,
    escolher,
    renomearTime: (ligaId, timeId, nome) => fs.updateDoc(refTime(ligaId, timeId), { nome }),
    removerTime: (ligaId, timeId) => fs.deleteDoc(refTime(ligaId, timeId)),
    criarTimeVago: (ligaId, nome) => fs.setDoc(fs.doc(fs.collection(db, 'ligas', ligaId, 'times')), {
      nome, reserva: true, donoNome: '', donoFoto: '', entrouEm: fs.serverTimestamp(),
    }),
    salvarConfig: (ligaId, config) => atualizarDraft(ligaId, { config, ordem: [], prazoSegundos: config.segundos }),
    sortear: (ligaId, ordem) => atualizarDraft(ligaId, { ordem }),
    iniciar: (ligaId, config) => atualizarDraft(ligaId, {
      status: 'andamento', n: 0, inicioEscolha: fs.serverTimestamp(), prazoSegundos: config.segundos, prazoRestante: null,
    }),
    pausar: (ligaId, restante) => atualizarDraft(ligaId, { status: 'pausado', prazoRestante: Math.max(5, Math.ceil(restante)) }),
    retomar: (ligaId, draft) => atualizarDraft(ligaId, {
      status: 'andamento', inicioEscolha: fs.serverTimestamp(), prazoSegundos: draft.prazoRestante ?? draft.config.segundos, prazoRestante: null,
    }),
    async desfazer(ligaId, draft, ultima, draftId = 'inicial') {
      const dref = refDraft(ligaId, draftId);
      const b = fs.writeBatch(db);
      b.delete(fs.doc(dref, 'escolhas', String(ultima.n)));
      b.delete(fs.doc(dref, 'ocupados', String(ultima.atletaId)));
      b.update(dref, {
        n: ultima.n,
        inicioEscolha: fs.serverTimestamp(),
        prazoSegundos: draft.config.segundos,
        status: draft.status === 'encerrado' ? 'andamento' : draft.status,
        prazoRestante: draft.status === 'pausado' ? draft.config.segundos : null,
      });
      await b.commit();
    },
  };
}
