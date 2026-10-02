import { calcularClassificacao, jogoTravado, palpiteCompleto, ZONAS, GOLS_MAX } from './tabela.js';
import { rodadaAtual, montarSnapshot, mesclarPalpites, filtrarPalpites, definirPalpite } from './projecao.js';
import { LocalStore, FirebaseStore } from './armazenamento.js';
import { firebaseConfig } from './firebase-config.js';
import { iniciarFirebase } from './firebase.js';
import { desenharEvolucao } from './evolucao.js';

const $ = (sel) => document.querySelector(sel);
const ESPERA_SALVAR = 800;

const estado = {
  dados: null,
  times: new Map(),
  palpites: {},
  projecoes: [],
  rodadaVisivel: 1,
  local: null,
  store: null,
  firebase: null,
  usuario: null,
  timerSalvar: null,
  pendente: false,
  salvando: Promise.resolve(),
};

function el(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') Object.assign(n.style, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null) n.append(f);
  return n;
}

function escudo(time) {
  const e = el('span', { class: 'escudo', 'aria-hidden': 'true' });
  e.style.setProperty('--c1', time?.cores?.primaria ?? '#888');
  e.style.setProperty('--c2', time?.cores?.secundaria ?? '#fff');
  return e;
}

// Horários sempre no fuso de Brasília, como na tabela da CBF.
const FUSO = 'America/Sao_Paulo';
const fmtData = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: FUSO,
});
const fmtAtualizado = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: FUSO });

function mostrarAviso(texto) {
  const aviso = $('#aviso');
  aviso.replaceChildren();
  if (!texto) { aviso.hidden = true; return; }
  aviso.append(el('div', { text: texto }));
  aviso.hidden = false;
}

function statusSalvamento(texto, erro = false) {
  const s = $('#status-salvamento');
  s.textContent = texto;
  s.classList.toggle('erro', erro);
}

// ---------- Jogos da rodada ----------

function lerGol(input) {
  const bruto = input.value.trim();
  if (bruto === '') return { valor: null, ok: true };
  const n = Number(bruto);
  const ok = Number.isInteger(n) && n >= 0 && n <= GOLS_MAX;
  return { valor: ok ? n : null, ok };
}

function aoDigitar(jogo, inM, inV) {
  const m = lerGol(inM);
  const v = lerGol(inV);
  inM.classList.toggle('invalido', !m.ok);
  inV.classList.toggle('invalido', !v.ok);
  if (!m.ok || !v.ok) return;
  const novos = definirPalpite(estado.palpites, jogo, m.valor, v.valor);
  if (!novos) {
    renderJogos();
    return;
  }
  estado.palpites = novos;
  renderTabela();
  renderResumo();
  agendarSalvamento();
}

function textoStatus(jogo, travado) {
  if (jogo.status === 'encerrado') return 'Encerrado';
  if (jogo.status === 'ao_vivo') return '🔒 Em andamento';
  if (jogo.status === 'adiado') return 'Adiado — data a definir';
  if (travado) return '🔒 Palpites encerrados';
  return '';
}

function renderJogos() {
  const lista = $('#lista-jogos');
  const jogos = estado.dados.jogos.filter((j) => j.rodada === estado.rodadaVisivel);
  const agora = Date.now();
  lista.replaceChildren();

  for (const jogo of jogos) {
    const mandante = estado.times.get(jogo.mandante);
    const visitante = estado.times.get(jogo.visitante);
    const travado = jogoTravado(jogo, agora);
    const palpite = estado.palpites[jogo.id];
    const placar = el('div', { class: 'placar' });
    let nota = textoStatus(jogo, travado);

    if (jogo.status === 'encerrado') {
      placar.append(
        el('span', { class: 'real', text: jogo.golsMandante ?? '–' }),
        el('span', { class: 'x', text: '×' }),
        el('span', { class: 'real', text: jogo.golsVisitante ?? '–' }),
      );
      if (palpiteCompleto(palpite)) nota += ` · seu palpite: ${palpite.m} × ${palpite.v}`;
    } else {
      const campo = (time, valor) => el('input', {
        type: 'number', min: 0, max: GOLS_MAX, step: 1, inputMode: 'numeric',
        value: valor ?? '', disabled: travado,
        'aria-label': `Gols do ${time?.nome ?? 'time'}`,
      });
      const inM = campo(mandante, palpite?.m);
      const inV = campo(visitante, palpite?.v);
      if (!travado) {
        inM.addEventListener('input', () => aoDigitar(jogo, inM, inV));
        inV.addEventListener('input', () => aoDigitar(jogo, inM, inV));
      }
      placar.append(inM, el('span', { class: 'x', text: '×' }), inV);
    }

    lista.append(el('li', { class: `jogo${travado ? ' travado' : ''}` },
      el('span', { class: 'quando', text: fmtData.format(new Date(jogo.inicio)) }),
      el('span', { class: 'time mandante' }, el('span', { class: 'nome', text: mandante?.nome ?? '?' }), escudo(mandante)),
      placar,
      el('span', { class: 'time visitante' }, escudo(visitante), el('span', { class: 'nome', text: visitante?.nome ?? '?' })),
      el('span', { class: 'nota', text: nota }),
    ));
  }

  $('#rodada-select').value = String(estado.rodadaVisivel);
  $('#rodada-ant').disabled = estado.rodadaVisivel <= 1;
  $('#rodada-prox').disabled = estado.rodadaVisivel >= totalRodadas();
  renderResumo();
}

function totalRodadas() {
  return Math.max(...estado.dados.jogos.map((j) => j.rodada));
}

function renderResumo() {
  const pendentes = estado.dados.jogos.filter((j) => j.status !== 'encerrado');
  const comPalpite = pendentes.filter((j) => palpiteCompleto(estado.palpites[j.id])).length;
  $('#resumo-palpites').textContent = pendentes.length
    ? `${comPalpite} de ${pendentes.length} jogos restantes com palpite.`
    : 'Campeonato encerrado.';
}

function limpar(jogos) {
  const agora = Date.now();
  let palpites = estado.palpites;
  for (const jogo of jogos) {
    const p = palpites[jogo.id];
    if (!p || (p.m == null && p.v == null)) continue;
    palpites = definirPalpite(palpites, jogo, null, null, agora) ?? palpites;
  }
  if (palpites === estado.palpites) return;
  estado.palpites = palpites;
  renderJogos();
  renderTabela();
  agendarSalvamento();
}

// ---------- Tabela ----------

function renderTabela() {
  const { jogos } = estado.dados;
  const listaTimes = [...estado.times.values()];
  const real = new Map(calcularClassificacao(listaTimes, jogos).map((l) => [l.timeId, l.pos]));
  const projetada = calcularClassificacao(listaTimes, jogos, estado.palpites);
  const corpo = $('#tabela tbody');
  corpo.replaceChildren();

  for (const l of projetada) {
    const diferenca = real.get(l.timeId) - l.pos;
    const delta = el('span', { class: 'delta' });
    if (diferenca > 0) { delta.textContent = `▲${diferenca}`; delta.classList.add('sobe'); }
    else if (diferenca < 0) { delta.textContent = `▼${-diferenca}`; delta.classList.add('desce'); }
    if (diferenca) delta.title = `Na tabela real: ${real.get(l.timeId)}º`;

    corpo.append(el('tr', { class: l.zona ? `zona-${l.zona}` : '' },
      el('td', { class: 'num pos' }, `${l.pos}`, delta),
      el('td', { class: 'esq' }, el('span', { class: 'time' }, escudo(l), el('span', { class: 'nome', text: l.nome }))),
      el('td', { class: 'num pts', text: l.pts }),
      el('td', { class: 'num', text: l.j }),
      el('td', { class: 'num', text: l.v }),
      el('td', { class: 'num opc', text: l.e }),
      el('td', { class: 'num opc', text: l.d }),
      el('td', { class: 'num', text: l.sg > 0 ? `+${l.sg}` : l.sg }),
      el('td', { class: 'num opc', text: l.gp }),
      el('td', { class: 'num opc', text: l.aproveitamento.toLocaleString('pt-BR') }),
    ));
  }
}

function renderLegendaZonas() {
  $('#legenda-zonas').replaceChildren(...ZONAS.map((z) => {
    const cor = el('i');
    cor.style.setProperty('--cor', `var(--zona-${z.id})`);
    return el('li', {}, cor, `${z.nome} (${z.de}º–${z.ate}º)`);
  }));
}

// ---------- Evolução ----------

const CHAVE_SELECAO = 'simulador:evolucao:selecao';

function lerSelecao() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE_SELECAO));
    return Array.isArray(s) ? s : null;
  } catch {
    return null;
  }
}

function gravarSelecao(selecao) {
  try {
    localStorage.setItem(CHAVE_SELECAO, JSON.stringify(selecao));
  } catch {
    // ignora
  }
}

let selecao = null;

function renderEvolucao() {
  const container = $('#evolucao');
  if (selecao == null) {
    const ultima = estado.projecoes.at(-1);
    selecao = lerSelecao()
      ?? (ultima ? ultima.classificacao.slice(0, 4).map((c, slot) => ({ timeId: c.timeId, slot })) : []);
  }
  selecao = selecao.filter((s) => estado.times.has(s.timeId));
  desenharEvolucao(container, {
    projecoes: estado.projecoes,
    times: estado.times,
    selecao,
    logado: Boolean(estado.usuario),
    firebaseDisponivel: Boolean(estado.firebase),
    aoAlterarSelecao: (nova) => {
      selecao = nova;
      gravarSelecao(nova);
      renderEvolucao();
    },
  });
}

// ---------- Salvamento ----------

function agendarSalvamento() {
  statusSalvamento('Alterações não salvas…');
  estado.pendente = true;
  clearTimeout(estado.timerSalvar);
  estado.timerSalvar = setTimeout(salvarAgora, ESPERA_SALVAR);
}

async function salvarAgora() {
  clearTimeout(estado.timerSalvar);
  estado.pendente = false;
  const store = estado.store;
  const palpites = estado.palpites;
  estado.salvando = estado.salvando.then(async () => {
    statusSalvamento('Salvando…');
    try {
      await store.salvarPalpites(palpites);
      await salvarProjecao(store);
      if (store === estado.store) statusSalvamento(estado.usuario ? 'Salvo na nuvem ✓' : 'Salvo neste navegador ✓');
    } catch (erro) {
      console.error(erro);
      statusSalvamento('Erro ao salvar', true);
    }
  });
  return estado.salvando;
}

async function salvarProjecao(store) {
  const rodada = rodadaAtual(estado.dados.jogos);
  if (rodada == null) return;
  const listaTimes = [...estado.times.values()];
  const snapshot = montarSnapshot(listaTimes, estado.dados.jogos, estado.palpites, rodada);
  await store.salvarProjecao(snapshot);
  estado.projecoes = [...estado.projecoes.filter((p) => p.rodada !== rodada), snapshot]
    .sort((a, b) => a.rodada - b.rodada);
  if (!$('#aba-evolucao').hidden) renderEvolucao();
}

// Na primeira visita de uma rodada nova, guarda a projeção mesmo sem edições.
async function garantirProjecaoDaRodada() {
  const rodada = rodadaAtual(estado.dados.jogos);
  const temPalpite = Object.values(estado.palpites).some(palpiteCompleto);
  if (rodada == null || !temPalpite || estado.projecoes.some((p) => p.rodada === rodada)) return;
  try {
    await salvarProjecao(estado.store);
  } catch (erro) {
    console.error(erro);
  }
}

async function carregarDoStore(store) {
  const [palpites, projecoes] = await Promise.all([store.carregarPalpites(), store.carregarProjecoes()]);
  return { palpites: filtrarPalpites(palpites, estado.dados.jogos), projecoes };
}

function renderTudo() {
  renderJogos();
  renderTabela();
  selecao = null;
  if (!$('#aba-evolucao').hidden) renderEvolucao();
}

// ---------- Login ----------

async function aoMudarUsuario(usuario) {
  await estado.salvando;
  clearTimeout(estado.timerSalvar);
  estado.usuario = usuario;
  $('#btn-entrar').hidden = Boolean(usuario);
  $('#usuario').hidden = !usuario;

  if (!usuario) {
    estado.store = estado.local;
    Object.assign(estado, await carregarDoStore(estado.local));
    statusSalvamento('');
    renderTudo();
    return;
  }

  $('#usuario-nome').textContent = usuario.displayName ?? usuario.email ?? '';
  $('#usuario-foto').src = usuario.photoURL ?? '';
  $('#usuario-foto').hidden = !usuario.photoURL;

  const remoto = new FirebaseStore({
    db: estado.firebase.db, fs: estado.firebase.fs, uid: usuario.uid, temporada: estado.dados.temporada,
  });
  try {
    statusSalvamento('Carregando seus palpites…');
    const [nuvem, local] = await Promise.all([carregarDoStore(remoto), carregarDoStore(estado.local)]);
    const mesclados = filtrarPalpites(mesclarPalpites(nuvem.palpites, local.palpites), estado.dados.jogos);
    estado.store = remoto;
    estado.palpites = mesclados;
    estado.projecoes = nuvem.projecoes;
    renderTudo();
    remoto.salvarPerfil({ nome: usuario.displayName, foto: usuario.photoURL }).catch(console.error);
    if (JSON.stringify(mesclados) !== JSON.stringify(nuvem.palpites)) await salvarAgora();
    else statusSalvamento('Sincronizado ✓');
    await garantirProjecaoDaRodada();
  } catch (erro) {
    console.error(erro);
    statusSalvamento('Erro ao carregar da nuvem', true);
  }
}

async function prepararLogin() {
  if (!firebaseConfig) return;
  try {
    estado.firebase = await iniciarFirebase(firebaseConfig);
  } catch (erro) {
    console.error(erro);
    mostrarAviso('Não foi possível carregar o login. Seus palpites ficam salvos só neste navegador.');
    return;
  }
  $('#btn-entrar').hidden = false;
  $('#btn-entrar').addEventListener('click', async () => {
    try {
      await estado.firebase.entrar();
    } catch (erro) {
      if (erro?.code !== 'auth/popup-closed-by-user') {
        console.error(erro);
        statusSalvamento('Não foi possível entrar', true);
      }
    }
  });
  $('#btn-sair').addEventListener('click', () => estado.firebase.sair());
  estado.firebase.aoMudarUsuario((u) => { aoMudarUsuario(u); });
}

// ---------- Início ----------

function trocarAba(aba) {
  for (const botao of document.querySelectorAll('.abas [role="tab"]')) {
    const ativa = botao.dataset.aba === aba;
    botao.setAttribute('aria-selected', String(ativa));
    $(`#aba-${botao.dataset.aba}`).hidden = !ativa;
  }
  if (aba === 'evolucao') renderEvolucao();
}

function ligarControles() {
  const select = $('#rodada-select');
  for (let r = 1; r <= totalRodadas(); r += 1) select.append(el('option', { value: r, text: `Rodada ${r}` }));
  select.addEventListener('change', () => { estado.rodadaVisivel = Number(select.value); renderJogos(); });
  $('#rodada-ant').addEventListener('click', () => { estado.rodadaVisivel -= 1; renderJogos(); });
  $('#rodada-prox').addEventListener('click', () => { estado.rodadaVisivel += 1; renderJogos(); });
  $('#limpar-rodada').addEventListener('click', () => {
    limpar(estado.dados.jogos.filter((j) => j.rodada === estado.rodadaVisivel));
  });
  $('#limpar-todos').addEventListener('click', () => {
    if (confirm('Apagar todos os palpites dos jogos que ainda não começaram?')) limpar(estado.dados.jogos);
  });
  for (const botao of document.querySelectorAll('.abas [role="tab"]')) {
    botao.addEventListener('click', () => trocarAba(botao.dataset.aba));
  }
  let largura = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === largura) return;
    largura = window.innerWidth;
    if (!$('#aba-evolucao').hidden) renderEvolucao();
  });
  window.addEventListener('beforeunload', (ev) => {
    if (!estado.pendente) return;
    // O LocalStore grava de forma síncrona; a nuvem pode não dar tempo.
    estado.store.salvarPalpites(estado.palpites);
    if (estado.usuario) ev.preventDefault();
  });
}

async function iniciar() {
  try {
    const resp = await fetch('data/brasileirao.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    estado.dados = await resp.json();
  } catch (erro) {
    console.error(erro);
    mostrarAviso('Não foi possível carregar os dados dos jogos (data/brasileirao.json).');
    return;
  }

  const { dados } = estado;
  estado.times = new Map(dados.times.map((t) => [t.id, t]));
  $('#temporada').textContent = dados.temporada;
  $('#atualizado').textContent = `Dados atualizados em ${fmtAtualizado.format(new Date(dados.atualizadoEm))}`;
  if (dados.fonte === 'exemplo') {
    mostrarAviso('Dados de exemplo, com resultados fictícios. Rode o workflow "Atualizar dados" (ou npm run dados) para carregar o Brasileirão real do Sofascore.');
  }

  estado.rodadaVisivel = rodadaAtual(dados.jogos) ?? totalRodadas();
  estado.local = new LocalStore(dados.temporada);
  estado.store = estado.local;
  Object.assign(estado, await carregarDoStore(estado.local));

  ligarControles();
  renderLegendaZonas();
  renderTudo();
  await garantirProjecaoDaRodada();
  await prepararLogin();
}

iniciar();
