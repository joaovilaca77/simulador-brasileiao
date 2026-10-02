// Onde os palpites e as projeções ficam guardados.
// LocalStore: no navegador (modo visitante). FirebaseStore: no Firestore.
// As duas classes têm a mesma interface.

function lerJSON(storage, chave, padrao) {
  try {
    const bruto = storage?.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch {
    return padrao;
  }
}

function gravarJSON(storage, chave, valor) {
  try {
    storage?.setItem(chave, JSON.stringify(valor));
  } catch {
    // Sem storage (aba anônima, bloqueio): segue só na memória.
  }
}

function storagePadrao() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class LocalStore {
  constructor(temporada, storage = storagePadrao()) {
    this.storage = storage;
    this.chavePalpites = `simulador:palpites:${temporada}`;
    this.chaveProjecoes = `simulador:projecoes:${temporada}`;
  }

  async carregarPalpites() {
    return lerJSON(this.storage, this.chavePalpites, {});
  }

  async salvarPalpites(palpites) {
    gravarJSON(this.storage, this.chavePalpites, palpites);
  }

  async carregarProjecoes() {
    const mapa = lerJSON(this.storage, this.chaveProjecoes, {});
    return Object.values(mapa).sort((a, b) => a.rodada - b.rodada);
  }

  async salvarProjecao(snapshot) {
    const mapa = lerJSON(this.storage, this.chaveProjecoes, {});
    mapa[snapshot.rodada] = snapshot;
    gravarJSON(this.storage, this.chaveProjecoes, mapa);
  }
}

// `fs` são as funções do SDK do Firestore (doc, getDoc, setDoc, collection,
// getDocs), injetadas para o módulo funcionar sem build e ser testável.
export class FirebaseStore {
  constructor({ db, fs, uid, temporada }) {
    this.db = db;
    this.fs = fs;
    this.uid = uid;
    this.temporada = String(temporada);
  }

  refTemporada() {
    return this.fs.doc(this.db, 'usuarios', this.uid, 'temporadas', this.temporada);
  }

  refProjecoes() {
    return this.fs.collection(this.db, 'usuarios', this.uid, 'temporadas', this.temporada, 'projecoes');
  }

  async salvarPerfil({ nome, foto }) {
    await this.fs.setDoc(this.fs.doc(this.db, 'usuarios', this.uid), {
      nome: nome ?? '', foto: foto ?? '', atualizadoEm: Date.now(),
    });
  }

  async carregarPalpites() {
    const snap = await this.fs.getDoc(this.refTemporada());
    return snap.exists() ? (snap.data().palpites ?? {}) : {};
  }

  async salvarPalpites(palpites) {
    await this.fs.setDoc(this.refTemporada(), { palpites, atualizadoEm: Date.now() });
  }

  async carregarProjecoes() {
    const snap = await this.fs.getDocs(this.refProjecoes());
    return snap.docs.map((d) => d.data()).sort((a, b) => a.rodada - b.rodada);
  }

  async salvarProjecao(snapshot) {
    await this.fs.setDoc(this.fs.doc(this.refProjecoes(), String(snapshot.rodada)), snapshot);
  }
}
