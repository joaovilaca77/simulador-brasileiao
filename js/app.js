import { calcularClassificacao, jogoTravado, palpiteCompleto, ZONAS, GOLS_MAX } from './tabela.js?v=151682fd38';
import { rodadaAtual, montarSnapshot, mesclarPalpites, filtrarPalpites, definirPalpite } from './projecao.js?v=151682fd38';
import { LocalStore, FirebaseStore } from './armazenamento.js?v=151682fd38';
import { firebaseConfig } from './firebase-config.js?v=151682fd38';
import { iniciarFirebase } from './firebase.js?v=151682fd38';
import { desenharEvolucao } from './evolucao.js?v=151682fd38';

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

// Escudo do clube quando baixado; senão (ou se a imagem falhar), as cores.
function escudo(time) {
  const cores = el('span', { class: 'escudo', 'aria-hidden': 'true' });
  cores.style.setProperty('--c1', time?.cores?.primaria ?? '#888');
  cores.style.setProperty('--c2', time?.cores?.secundaria ?? '#fff');
  if (!time?.escudo) return cores;
  const img = el('img', {
    class: 'escudo', src: time.escudo, alt: '', loading: 'lazy', decoding: 'async', width: 20, height: 20,
  });
  img.addEventListener('error', () => img.replaceWith(cores), { once: true });
  return img;
}

const NOMES_FONTE = {
  sofascore: 'Sofascore (API não oficial)',
  'football-data': 'football-data.org',
  exemplo: 'exemplo com resultados fictícios',
};

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
  // Com a tabela escondida, os jogos se dividem em duas colunas.
  lista.style.setProperty('--linhas', Math.max(1, Math.ceil(jogos.length / 2)));

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

  atualizarSeletorRodada();
  $('#rodada-ant').disabled = estado.rodadaVisivel <= 1;
  $('#rodada-prox').disabled = estado.rodadaVisivel >= totalRodadas();
  renderResumo();
}

// ---------- Seletor de rodada ----------

const COLUNAS_GRADE = 7;

function abrirSeletorRodada(abrir) {
  const painel = $('#rodada-painel');
  if (abrir === !painel.hidden) return;
  painel.hidden = !abrir;
  $('#rodada-botao').setAttribute('aria-expanded', String(abrir));
  if (abrir) $('#rodada-grade [aria-current="true"]')?.focus();
}

function irParaRodada(n) {
  estado.rodadaVisivel = n;
  renderJogos();
}

function atualizarSeletorRodada() {
  $('#rodada-titulo').textContent = `Rodada ${estado.rodadaVisivel}`;
  const atual = rodadaAtual(estado.dados.jogos);
  for (const b of $('#rodada-grade').children) {
    const n = Number(b.dataset.rodada);
    const jogos = estado.dados.jogos.filter((j) => j.rodada === n);
    const encerrada = jogos.length > 0 && jogos.every((j) => j.status === 'encerrado');
    b.classList.toggle('encerrada', encerrada);
    b.classList.toggle('atual', n === atual);
    b.setAttribute('aria-current', String(n === estado.rodadaVisivel));
    b.setAttribute('aria-label', `Rodada ${n}${n === atual ? ', rodada atual' : encerrada ? ', encerrada' : ''}`);
  }
}

function ligarSeletorRodada() {
  const grade = $('#rodada-grade');
  for (let r = 1; r <= totalRodadas(); r += 1) {
    grade.append(el('button', { type: 'button', text: r, 'data-rodada': r }));
  }
  $('#rodada-botao').addEventListener('click', () => abrirSeletorRodada($('#rodada-painel').hidden));
  grade.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-rodada]');
    if (!b) return;
    irParaRodada(Number(b.dataset.rodada));
    abrirSeletorRodada(false);
    $('#rodada-botao').focus();
  });
  // Setas do teclado andam pela grade; Esc fecha.
  grade.addEventListener('keydown', (ev) => {
    const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUNAS_GRADE, ArrowDown: COLUNAS_GRADE };
    if (!(ev.key in passos)) return;
    const botoes = [...grade.children];
    const i = botoes.indexOf(document.activeElement);
    botoes[Math.min(botoes.length - 1, Math.max(0, i + passos[ev.key]))]?.focus();
    ev.preventDefault();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('#rodada-painel').hidden) {
      abrirSeletorRodada(false);
      $('#rodada-botao').focus();
    }
  });
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('.seletor-rodada')) abrirSeletorRodada(false);
  });
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

// Como a tabela aparece: completa (reais + palpites) ou só com os palpites;
// e se está escondida. Fica guardado no navegador.
const CHAVE_VISAO = 'simulador:visao';
const visao = { modo: 'completa', oculta: false };

function lerVisao() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_VISAO));
    if (v?.modo === 'simulados') visao.modo = 'simulados';
    visao.oculta = v?.oculta === true;
  } catch {
    // sem storage: usa o padrão
  }
}

function gravarVisao() {
  try {
    localStorage.setItem(CHAVE_VISAO, JSON.stringify(visao));
  } catch {
    // ignora
  }
}

function aplicarVisao() {
  const simulados = visao.modo === 'simulados';
  for (const b of document.querySelectorAll('.segmentado [data-modo]')) {
    b.setAttribute('aria-checked', String(b.dataset.modo === visao.modo));
  }
  $('#titulo-tabela').textContent = simulados ? 'Classificação só dos seus palpites' : 'Classificação com seus palpites';
  $('#tabela').classList.toggle('so-simulados', simulados);
  $('#legenda-zonas').hidden = simulados;

  $('#aba-palpites').classList.toggle('tabela-oculta', visao.oculta);
  $('#cartao-tabela').hidden = visao.oculta;
  $('#mostrar-tabela').hidden = !visao.oculta;
  $('#esconder-tabela').setAttribute('aria-expanded', String(!visao.oculta));
  $('#mostrar-tabela').setAttribute('aria-expanded', String(!visao.oculta));
}

function renderTabela() {
  const { jogos } = estado.dados;
  const listaTimes = [...estado.times.values()];
  const simulados = visao.modo === 'simulados';
  // Só simulados: sem os jogos encerrados, a classificação soma apenas os palpites.
  const pendentes = jogos.filter((j) => j.status !== 'encerrado');
  const palpitados = pendentes.filter((j) => palpiteCompleto(estado.palpites[j.id])).length;
  const real = new Map(calcularClassificacao(listaTimes, jogos).map((l) => [l.timeId, l.pos]));
  const linhas = calcularClassificacao(listaTimes, simulados ? pendentes : jogos, estado.palpites);
  const corpo = $('#tabela tbody');
  corpo.replaceChildren();

  const vazia = simulados && palpitados === 0;
  $('#tabela-vazia').hidden = !vazia;
  $('#tabela').closest('.tabela-wrap').hidden = vazia;
  $('#nota-tabela').textContent = simulados
    ? `Pontos apenas dos ${palpitados} ${palpitados === 1 ? 'jogo que você palpitou' : 'jogos que você palpitou'}, sem os resultados reais.`
    : '▲▼ mostra quantas posições o time ganha ou perde em relação à tabela real.';

  for (const l of linhas) {
    const delta = el('span', { class: 'delta' });
    const diferenca = simulados ? 0 : real.get(l.timeId) - l.pos;
    if (diferenca > 0) { delta.textContent = `▲${diferenca}`; delta.classList.add('sobe'); }
    else if (diferenca < 0) { delta.textContent = `▼${-diferenca}`; delta.classList.add('desce'); }
    if (diferenca) delta.title = `Na tabela real: ${real.get(l.timeId)}º`;

    corpo.append(el('tr', { class: !simulados && l.zona ? `zona-${l.zona}` : '' },
      el('td', { class: 'num pos' }, `${l.pos}`, delta),
      el('td', { class: 'esq' }, el('span', { class: 'time' }, escudo(estado.times.get(l.timeId)), el('span', { class: 'nome', text: l.nome }))),
      el('td', { class: 'num pts', text: l.pts }),
      el('td', { class: 'num', text: l.j }),
      el('td', { class: 'num', text: l.v }),
      el('td', { class: 'num opc', text: l.e }),
      el('td', { class: 'num opc', text: l.d }),
      el('td', { class: 'num', text: l.sg > 0 ? `+${l.sg}` : l.sg }),
      el('td', { class: 'num opc', text: l.gp }),
      el('td', { class: 'num opc', text: l.gc }),
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
  const botao = $('#btn-tema');
  const proximo = tema === 'escuro' ? 'claro' : 'escuro';
  botao.setAttribute('aria-label', `Usar tema ${proximo}`);
  botao.title = `Usar tema ${proximo}`;
}

// O <head> já aplicou o tema inicial; aqui ficam o botão e o acompanhamento
// do sistema enquanto a pessoa não escolheu um tema.
function ligarTema() {
  const sistema = window.matchMedia?.('(prefers-color-scheme: dark)');
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
  sistema?.addEventListener('change', (ev) => {
    if (!temaSalvo()) aplicarTema(ev.matches ? 'escuro' : 'claro');
  });
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
  for (const b of document.querySelectorAll('.segmentado [data-modo]')) {
    b.addEventListener('click', () => {
      if (visao.modo === b.dataset.modo) return;
      visao.modo = b.dataset.modo;
      gravarVisao();
      aplicarVisao();
      renderTabela();
    });
  }
  const alternarTabela = (oculta) => {
    visao.oculta = oculta;
    gravarVisao();
    aplicarVisao();
    (oculta ? $('#mostrar-tabela') : $('#esconder-tabela')).focus();
  };
  $('#esconder-tabela').addEventListener('click', () => alternarTabela(true));
  $('#mostrar-tabela').addEventListener('click', () => alternarTabela(false));
  ligarSeletorRodada();
  $('#rodada-ant').addEventListener('click', () => irParaRodada(estado.rodadaVisivel - 1));
  $('#rodada-prox').addEventListener('click', () => irParaRodada(estado.rodadaVisivel + 1));
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
  ligarTema();
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
  $('#fonte-dados').textContent = NOMES_FONTE[dados.fonte] ?? dados.fonte;
  if (dados.fonte === 'exemplo') {
    mostrarAviso('Dados de exemplo, com resultados fictícios. Os jogos reais chegam quando o workflow "Atualizar dados" rodar no GitHub (veja o README).');
  }

  estado.rodadaVisivel = rodadaAtual(dados.jogos) ?? totalRodadas();
  estado.local = new LocalStore(dados.temporada);
  estado.store = estado.local;
  Object.assign(estado, await carregarDoStore(estado.local));

  ligarControles();
  lerVisao();
  aplicarVisao();
  renderLegendaZonas();
  renderTudo();
  await garantirProjecaoDaRodada();
  await prepararLogin();
}

iniciar();
