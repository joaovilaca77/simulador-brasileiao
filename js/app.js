import { $, el, toast, aviso, ligarTema, copiar } from './ui.js?v=daefe94a8f';
import { CONFIG_PADRAO, POSICOES, sortearOrdem } from './draft.js?v=daefe94a8f';
import { criarApi } from './liga.js?v=daefe94a8f';
import { montarSala } from './sala.js?v=daefe94a8f';
import { firebaseConfig } from './firebase-config.js?v=daefe94a8f';
import { iniciarFirebase } from './firebase.js?v=daefe94a8f';

const app = $('#app');
const MODO_TESTE = new URLSearchParams(location.search).has('emulador');

const estado = {
  fb: null,
  api: null,
  usuario: undefined,
  dados: null,
  clubes: new Map(),
  pararLiga: null,
  sala: null,
  ordemVista: '',
};

const fmtData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

function cabecalho(titulo, subtitulo = '') {
  $('#titulo-pagina').textContent = titulo;
  $('#subtitulo-pagina').textContent = subtitulo;
}

function tela(...filhos) {
  app.replaceChildren(...filhos);
}

function cartao(titulo, ...filhos) {
  return el('section', { class: 'cartao' }, titulo ? el('h2', { class: 'titulo-cartao', text: titulo }) : null, ...filhos);
}

function erro(e) {
  console.error(e);
  toast(e?.message?.includes('permission') ? 'Sem permissão para isso.' : (e?.message || 'Algo deu errado.'), 'erro');
}

// ---------- Rotas ----------

function lerRota() {
  const [caminho, qs] = location.hash.replace(/^#/, '').split('?');
  const partes = caminho.split('/').filter(Boolean);
  return { partes, params: new URLSearchParams(qs ?? '') };
}

function limparLiga() {
  estado.pararLiga?.();
  estado.pararLiga = null;
  estado.sala?.destruir();
  estado.sala = null;
  estado.ordemVista = '';
}

function rotear() {
  limparLiga();
  aviso('');
  if (!estado.api) return;
  if (estado.usuario === undefined) {
    tela(el('p', { class: 'carregando', text: 'Carregando…' }));
    return;
  }
  const { partes, params } = lerRota();
  if (!estado.usuario) {
    telaBoasVindas(partes[0] === 'liga');
    return;
  }
  if (partes[0] === 'liga' && partes[1]) abrirLiga(partes[1], params.get('convite'));
  else telaInicio();
}

// ---------- Telas ----------

function resumoRegras(config = CONFIG_PADRAO) {
  const minimos = POSICOES.map((p) => `${config.minimos[p]} ${p}`).join(', ');
  const fixas = POSICOES.reduce((s, p) => s + config.minimos[p], 0);
  return el('ul', { class: 'regras' },
    el('li', { text: `${config.times} times, ${config.jogadores} jogadores cada (sem técnico).` }),
    el('li', { text: `Mínimo por posição: ${minimos}; as outras ${config.jogadores - fixas} vagas são livres.` }),
    el('li', { text: `No máximo ${config.maxPorClube} jogadores do mesmo clube.` }),
    el('li', { text: 'Ordem em serpentina: 1→último na 1ª rodada, último→1 na 2ª, e assim por diante.' }),
    el('li', { text: `Relógio de ${config.segundos} s por escolha. Se acabar, sai o primeiro da sua fila que couber; sem fila, o de maior média.` }));
}

function telaBoasVindas(temConvite) {
  cabecalho('Cartola');
  tela(el('div', { class: 'boas-vindas' },
    cartao('Draft ao vivo da liga',
      el('p', { text: temConvite ? 'Você recebeu um convite para uma liga. Entre com sua conta Google para montar seu time.' : 'Cada técnico escolhe, na sua vez, os jogadores do Cartola que vão formar o seu elenco para a temporada.' }),
      resumoRegras(),
      el('button', { class: 'botao primario grande', type: 'button', text: 'Entrar com Google', on: { click: entrar } }))));
}

function telaSemFirebase() {
  cabecalho('Cartola');
  tela(cartao('Falta configurar o Firebase',
    el('p', { text: 'O draft ao vivo usa o Firebase para o login e para sincronizar as escolhas entre todos.' }),
    el('p', { text: 'Siga o passo a passo do README (seção "Configurar o Firebase") e cole a configuração em js/firebase-config.js.' }),
    resumoRegras()));
}

async function telaInicio() {
  cabecalho('Cartola', 'Minhas ligas');
  const lista = el('ul', { class: 'lista-ligas' }, el('li', { class: 'mudo', text: 'Carregando…' }));
  const anoPadrao = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();

  const nome = el('input', { id: 'nome-liga', required: true, maxLength: 60, value: 'Liga dos amigos' });
  const temporada = el('input', { id: 'temporada-liga', type: 'number', min: 2025, max: 2100, value: anoPadrao, required: true });
  const vouJogar = el('input', { id: 'vou-jogar', type: 'checkbox', checked: true });
  const meuTime = el('input', { id: 'meu-time', maxLength: 40, value: estado.usuario.displayName ? `Time do ${estado.usuario.displayName.split(' ')[0]}` : 'Meu time' });
  vouJogar.addEventListener('change', () => { meuTime.disabled = !vouJogar.checked; });

  const form = el('form', { class: 'formulario', on: { submit: criar } },
    el('label', { for: 'nome-liga', text: 'Nome da liga' }), nome,
    el('label', { for: 'temporada-liga', text: 'Temporada' }), temporada,
    el('label', { class: 'check' }, vouJogar, ' Também vou ter um time'),
    el('label', { for: 'meu-time', text: 'Nome do meu time' }), meuTime,
    el('button', { class: 'botao primario', type: 'submit', text: 'Criar liga' }));

  async function criar(ev) {
    ev.preventDefault();
    form.querySelector('button').disabled = true;
    try {
      const id = await estado.api.criarLiga({
        nome: nome.value.trim(), temporada: String(temporada.value), usuario: estado.usuario,
        meuTime: vouJogar.checked ? meuTime.value.trim() || 'Meu time' : null,
      });
      location.hash = `#/liga/${id}`;
    } catch (e) {
      erro(e);
      form.querySelector('button').disabled = false;
    }
  }

  tela(el('div', { class: 'grade-inicio' }, cartao('Minhas ligas', lista), cartao('Criar uma liga', form)));

  try {
    const ligas = await estado.api.minhasLigas(estado.usuario.uid);
    lista.replaceChildren(...(ligas.length
      ? ligas.map((l) => el('li', {}, el('a', { href: `#/liga/${l.id}`, text: l.nome }), el('span', { class: 'mudo', text: ` · ${l.temporada} · ${l.papel === 'organizador' ? 'organizador' : 'participante'}` })))
      : [el('li', { class: 'mudo', text: 'Você ainda não está em nenhuma liga. Crie uma ou abra o link de convite que recebeu.' })]));
  } catch (e) {
    erro(e);
  }
}

function abrirLiga(ligaId, convite) {
  tela(el('p', { class: 'carregando', text: 'Abrindo a liga…' }));
  estado.pararLiga = estado.api.ouvir(ligaId, (st) => renderLiga(ligaId, st, convite), () => {
    tela(cartao('Liga não encontrada', el('p', { text: 'Confira o link ou peça um novo convite ao organizador.' }), el('a', { href: '#/', text: '← Minhas ligas' })));
  });
}

const STATUS_TEXTO = { preparando: 'preparando o draft', andamento: 'draft ao vivo', pausado: 'draft pausado', encerrado: 'draft encerrado' };

function renderLiga(ligaId, st, convite) {
  if (!st.liga || !st.draft) {
    tela(cartao('Liga não encontrada', el('a', { href: '#/', text: '← Minhas ligas' })));
    return;
  }
  cabecalho(st.liga.nome, `Temporada ${st.liga.temporada} · ${STATUS_TEXTO[st.draft.status] ?? ''}`);
  avisoTemporada(st.liga);
  const uid = estado.usuario.uid;
  const membro = st.times.some((t) => t.id === uid);
  const organizador = st.liga.organizadorUid === uid;

  if (st.draft.status === 'preparando') {
    estado.sala?.destruir();
    estado.sala = null;
    if (!membro && !organizador) telaEntrarNaLiga(ligaId, st, convite);
    else telaSaguao(ligaId, st, { organizador, membro });
    return;
  }
  if (!estado.dados) {
    tela(cartao('Lista de jogadores indisponível', el('p', { text: 'Não foi possível carregar data/atletas.json.' })));
    return;
  }
  if (!estado.sala) {
    estado.sala = montarSala(app, { api: estado.api, ligaId, usuario: estado.usuario, atletas: estado.dados.atletas, clubes: estado.clubes });
  }
  estado.sala.atualizar(st);
}

function avisoTemporada(liga) {
  if (estado.dados && String(estado.dados.temporada) !== String(liga.temporada)) {
    aviso(`A lista de jogadores ainda é do Cartola ${estado.dados.temporada}. Para a temporada ${liga.temporada}, espere o Cartola abrir o mercado da nova temporada antes de iniciar o draft (a lista se atualiza sozinha todo dia).`);
  } else {
    aviso('');
  }
}

function telaEntrarNaLiga(ligaId, st, convite) {
  const cheia = st.times.length >= st.draft.config.times;
  if (!convite) {
    tela(cartao(`Liga ${st.liga.nome}`, el('p', { text: 'Para entrar, abra o link de convite que o organizador enviou.' }), el('a', { href: '#/', text: '← Minhas ligas' })));
    return;
  }
  const nomeTime = el('input', { id: 'nome-time', required: true, maxLength: 40, value: estado.usuario.displayName ? `Time do ${estado.usuario.displayName.split(' ')[0]}` : '' });
  const form = el('form', {
    class: 'formulario',
    on: {
      async submit(ev) {
        ev.preventDefault();
        form.querySelector('button').disabled = true;
        try {
          await estado.api.entrar({ ligaId, convite, usuario: estado.usuario, nomeTime: nomeTime.value.trim(), liga: st.liga });
          history.replaceState(null, '', `#/liga/${ligaId}`);
        } catch (e) {
          erro(new Error('Não foi possível entrar. Confira se o link de convite está completo e se o draft ainda não começou.'));
          form.querySelector('button').disabled = false;
        }
      },
    },
  },
  el('label', { for: 'nome-time', text: 'Nome do seu time' }), nomeTime,
  el('button', { class: 'botao primario', type: 'submit', text: 'Entrar na liga', disabled: cheia }));

  tela(el('div', { class: 'grade-inicio' },
    cartao(`Entrar na ${st.liga.nome}`,
      el('p', { text: `${st.times.length} de ${st.draft.config.times} times inscritos.` }),
      cheia ? el('p', { class: 'erro-texto', text: 'A liga já está cheia. Fale com o organizador.' }) : form),
    cartao('Regras do draft', resumoRegras(st.draft.config))));
}

function telaSaguao(ligaId, st, { organizador }) {
  const { liga, times, draft } = st;
  const config = draft.config;
  const uid = estado.usuario.uid;
  const idsTimes = new Set(times.map((t) => t.id));
  const ordemValida = draft.ordem.length === times.length && draft.ordem.every((id) => idsTimes.has(id));
  const completos = times.length === config.times;
  const api = estado.api;

  // --- Times ---
  const ordenados = [...times].sort((a, b) => (a.entrouEm?.toMillis?.() ?? 0) - (b.entrouEm?.toMillis?.() ?? 0));
  const listaTimes = el('ul', { class: 'lista-times' }, ordenados
    .map((t) => {
      const meu = t.id === uid;
      const acoes = [];
      if (organizador || meu) {
        acoes.push(el('button', {
          class: 'botao link', type: 'button', text: 'Renomear',
          on: { click: () => { const n = prompt('Novo nome do time:', t.nome); if (n?.trim()) api.renomearTime(ligaId, t.id, n.trim().slice(0, 40)).catch(erro); } },
        }));
      }
      if (organizador || meu) {
        acoes.push(el('button', {
          class: 'botao link', type: 'button', text: meu && !organizador ? 'Sair' : 'Remover',
          on: { click: () => { if (confirm(`Remover "${t.nome}" da liga?`)) api.removerTime(ligaId, t.id).catch(erro); } },
        }));
      }
      return el('li', { class: meu ? 'meu' : '' },
        t.donoFoto ? el('img', { class: 'avatar', src: t.donoFoto, alt: '', width: 32, height: 32, referrerPolicy: 'no-referrer' }) : el('span', { class: 'avatar vazio', text: (t.nome[0] ?? '?').toUpperCase() }),
        el('div', { class: 'time-info' },
          el('strong', { text: t.nome }),
          el('span', { class: 'mudo', text: t.reserva ? 'Vago · conduzido pelo organizador' : t.donoNome || '' })),
        meu ? el('span', { class: 'tag', text: 'você' }) : null,
        t.id === liga.organizadorUid ? el('span', { class: 'tag', text: 'organizador' }) : null,
        el('span', { class: 'acoes-time' }, acoes));
    }));

  const cartaoTimes = cartao(`Times (${times.length}/${config.times})`, listaTimes,
    organizador ? el('button', {
      class: 'botao', type: 'button', text: 'Adicionar time vago', disabled: completos,
      title: 'Para quem não vai entrar no app: o organizador escolhe por esse time',
      on: { click: () => { const n = prompt('Nome do time vago:'); if (n?.trim()) api.criarTimeVago(ligaId, n.trim().slice(0, 40)).catch(erro); } },
    }) : null);

  // --- Convite ---
  const link = `${location.origin}${location.pathname}${location.search}#/liga/${ligaId}?convite=${liga.convite}`;
  const cartaoConvite = cartao('Convite',
    el('p', { text: 'Mande este link para os técnicos. Cada um entra com a conta Google e dá nome ao time.' }),
    el('div', { class: 'linha-convite' },
      el('input', { readOnly: true, value: link, 'aria-label': 'Link de convite', on: { focus: (e) => e.target.select() } }),
      el('button', { class: 'botao', type: 'button', text: 'Copiar', on: { click: () => copiar(link) } })));

  // --- Ordem ---
  const chaveOrdem = draft.ordem.join(',');
  const revelar = ordemValida && estado.ordemVista !== '' && estado.ordemVista !== chaveOrdem;
  estado.ordemVista = chaveOrdem || '-';
  const nomes = new Map(times.map((t) => [t.id, t.nome]));
  const listaOrdem = ordemValida
    ? el('ol', { class: `ordem${revelar ? ' revelar' : ''}` }, draft.ordem.map((id, i) => {
      const li = el('li', { class: id === uid ? 'meu' : '' }, el('span', { class: 'ordem-n', text: String(i + 1) }), el('span', { text: nomes.get(id) }));
      li.style.setProperty('--i', String(i));
      return li;
    }))
    : el('p', { class: 'mudo', text: completos ? 'Ordem ainda não sorteada.' : `Esperando os ${config.times} times entrarem para sortear a ordem.` });

  const botoesOrg = organizador ? el('div', { class: 'acoes' },
    el('button', {
      class: 'botao', type: 'button', text: ordemValida ? 'Sortear de novo' : 'Sortear ordem', disabled: !completos,
      on: { click: () => api.sortear(ligaId, sortearOrdem(times.map((t) => t.id))).catch(erro) },
    }),
    el('button', {
      class: 'botao primario', type: 'button', text: 'Iniciar draft', disabled: !ordemValida || !estado.dados,
      on: { click: () => { if (confirm('Iniciar o draft agora? O relógio começa a contar para o primeiro time.')) api.iniciar(ligaId, config).catch(erro); } },
    })) : el('p', { class: 'mudo', text: ordemValida ? 'Aguardando o organizador iniciar o draft.' : 'Aguardando o organizador sortear a ordem.' });

  const cartaoOrdem = cartao('Ordem do draft', listaOrdem, botoesOrg);

  // --- Regras e configuração ---
  const cartaoRegras = cartao('Regras', resumoRegras(config), organizador ? formConfig(ligaId, config) : null, infoDados());

  tela(el('div', { class: 'saguao' }, el('div', { class: 'coluna' }, cartaoOrdem, cartaoTimes), el('div', { class: 'coluna' }, cartaoConvite, cartaoRegras)));
}

function formConfig(ligaId, config) {
  const selTimes = el('select', { id: 'cfg-times' }, Array.from({ length: 19 }, (_, i) => i + 2).map((n) => el('option', { value: n, text: `${n} times`, selected: n === config.times })));
  const opcoesSeg = [...(MODO_TESTE ? [10] : []), 30, 45, 60, 90, 120, 180];
  const selSeg = el('select', { id: 'cfg-seg' }, opcoesSeg.map((s) => el('option', { value: s, text: `${s} s por escolha`, selected: s === config.segundos })));
  const salvar = (mudanca) => estado.api.salvarConfig(ligaId, { ...config, ...mudanca }).catch(erro);
  selTimes.addEventListener('change', () => salvar({ times: Number(selTimes.value) }));
  selSeg.addEventListener('change', () => salvar({ segundos: Number(selSeg.value) }));
  return el('div', { class: 'config' },
    el('h3', { class: 'subtitulo', text: 'Configuração (organizador)' }),
    el('div', { class: 'linha-config' },
      el('label', { for: 'cfg-times', text: 'Times' }), selTimes,
      el('label', { for: 'cfg-seg', text: 'Relógio' }), selSeg),
    MODO_TESTE ? el('button', {
      class: 'botao pequeno', type: 'button', text: 'Usar configuração de teste (4 jogadores)',
      on: { click: () => salvar({ jogadores: 4, maxPorClube: 2, minimos: { GOL: 1, LAT: 0, ZAG: 1, MEI: 0, ATA: 0 } }) },
    }) : null,
    el('p', { class: 'mudo nota', text: 'Mudar a configuração apaga a ordem sorteada.' }));
}

function infoDados() {
  const d = estado.dados;
  if (!d) return el('p', { class: 'erro-texto', text: 'A lista de jogadores (data/atletas.json) ainda não foi baixada. Rode o workflow "Atualizar jogadores" no GitHub.' });
  return el('p', { class: 'mudo nota', text: `Jogadores: Cartola ${d.temporada} · ${d.atletas.length} jogadores de ${d.clubes.length} clubes · atualizado em ${fmtData.format(new Date(d.atualizadoEm))}.` });
}

// ---------- Conta ----------

async function entrar() {
  try {
    await estado.fb.entrar();
  } catch (e) {
    if (e?.code !== 'auth/popup-closed-by-user') erro(new Error('Não foi possível entrar com o Google.'));
  }
}

function atualizarConta() {
  const u = estado.usuario;
  $('#btn-entrar').hidden = Boolean(u) || !estado.fb;
  $('#usuario').hidden = !u;
  if (u) {
    $('#usuario-nome').textContent = u.displayName ?? u.email ?? '';
    $('#usuario-foto').src = u.photoURL ?? '';
    $('#usuario-foto').hidden = !u.photoURL;
  }
}

// ---------- Início ----------

async function carregarDados() {
  try {
    const resp = await fetch('data/atletas.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados = await resp.json();
    estado.dados = dados;
    estado.clubes = new Map(dados.clubes.map((c) => [c.id, c]));
    $('#fonte-dados').textContent = `Cartola FC ${dados.temporada}, atualizado em ${fmtData.format(new Date(dados.atualizadoEm))}`;
  } catch (e) {
    console.warn('Sem lista de jogadores:', e.message);
  }
}

async function iniciar() {
  ligarTema();
  await carregarDados();
  if (!firebaseConfig) {
    telaSemFirebase();
    return;
  }
  try {
    estado.fb = await iniciarFirebase(firebaseConfig);
  } catch (e) {
    console.error(e);
    tela(cartao('Não foi possível carregar o Firebase', el('p', { text: 'Verifique a conexão e recarregue a página.' })));
    return;
  }
  estado.api = criarApi(estado.fb);
  $('#btn-entrar').addEventListener('click', entrar);
  $('#btn-sair').addEventListener('click', () => estado.fb.sair());
  window.addEventListener('hashchange', rotear);
  estado.fb.aoMudarUsuario((u) => {
    estado.usuario = u;
    atualizarConta();
    rotear();
  });
  rotear();
}

iniciar();
