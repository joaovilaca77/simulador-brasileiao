// Sala do draft: relógio, jogadores disponíveis, elenco, fila, quadro e
// controles do organizador. Atualiza a cada mudança no Firestore.

import { el, escudo, foto, tagPosicao, iconeStatus, fmtPreco, fmtMedia, normalizarTexto, toast, esconderToast, baixarArquivo } from './ui.js?v=daefe94a8f';
import {
  POSICOES, timeDaEscolha, rodadaDaEscolha, totalEscolhas, proximasEscolhas,
  validarEscolha, escolhaAutomatica, resumoElenco, compararAtletas, gerarCSV,
} from './draft.js?v=daefe94a8f';

const LIMITE_LISTA = 150;
const PLURAIS = { GOL: 'Goleiros', LAT: 'Laterais', ZAG: 'Zagueiros', MEI: 'Meias', ATA: 'Atacantes' };
const AVISO_VEZ = 'É a sua vez de escolher!';
const FOLGA_AUTO_MS = 3000;
const REPETIR_AUTO_MS = 2000;

const ORDENACOES = {
  media: ['Média', compararAtletas],
  preco: ['Preço', (a, b) => b.preco - a.preco || compararAtletas(a, b)],
  jogos: ['Jogos', (a, b) => b.jogos - a.jogos || compararAtletas(a, b)],
  nome: ['Nome', (a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR')],
};

function bip() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.frequency.value = 880;
    ganho.gain.setValueAtTime(0.15, ctx.currentTime);
    ganho.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(ganho).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // sem áudio: segue só o aviso visual
  }
}

export function montarSala(container, { api, ligaId, usuario, atletas, clubes }) {
  const porId = new Map(atletas.map((a) => [a.id, a]));
  const nomeClube = (id) => clubes.get(id)?.nome ?? `clube ${id}`;
  const jitter = Math.random() * 1500;

  let est = null;
  let fila = [];
  let offset = 0; // relógio local - relógio do servidor
  let ultimoN = null;
  let ultimoStatus = null;
  let confirmando = null;
  let timerConfirmar = null;
  let conduzir = false;
  let elencoVisto = null;
  const tentativas = new Map();
  const filtros = { busca: '', pos: '', clube: '', ordem: 'media', soValidos: false };

  // ---------- Estrutura ----------

  const ui = {
    status: el('p', { class: 'sala-status' }),
    relogio: el('div', { class: 'relogio', role: 'timer', 'aria-live': 'off' }),
    vez: el('div', { class: 'sala-vez' }),
    proximos: el('ol', { class: 'sala-proximos', 'aria-label': 'Próximas escolhas' }),
    controles: el('div', { class: 'sala-controles' }),
    lista: el('div', { class: 'lista-jogadores', role: 'list' }),
    contagem: el('p', { class: 'mudo nota' }),
    elenco: el('div', { class: 'meu-elenco' }),
    fila: el('ol', { class: 'fila' }),
    feed: el('ol', { class: 'feed' }),
    quadro: el('div', { class: 'quadro-wrap' }),
    elencos: el('div', { class: 'elencos' }),
  };

  const busca = el('input', {
    type: 'search', placeholder: 'Buscar jogador', 'aria-label': 'Buscar jogador',
    on: { input: (e) => { filtros.busca = e.target.value; renderJogadores(); } },
  });
  const chipsPos = el('div', { class: 'chips', role: 'group', 'aria-label': 'Posição' },
    ['', ...POSICOES].map((p) => el('button', {
      type: 'button', text: p || 'Todas', 'aria-pressed': String(p === ''), dataset: { pos: p },
      on: { click: () => { filtros.pos = p; chipsPos.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pos === p))); renderJogadores(); } },
    })));
  const selClube = el('select', { 'aria-label': 'Clube', on: { change: (e) => { filtros.clube = e.target.value; renderJogadores(); } } },
    el('option', { value: '', text: 'Todos os clubes' }),
    [...clubes.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((c) => el('option', { value: String(c.id), text: c.nome })));
  const selOrdem = el('select', { 'aria-label': 'Ordenar por', on: { change: (e) => { filtros.ordem = e.target.value; renderJogadores(); } } },
    Object.entries(ORDENACOES).map(([k, [nome]]) => el('option', { value: k, text: `Ordenar: ${nome}` })));
  const chkValidos = el('label', { class: 'check' },
    el('input', { type: 'checkbox', on: { change: (e) => { filtros.soValidos = e.target.checked; renderJogadores(); } } }),
    ' Só os que cabem no elenco');
  const selElenco = el('select', { 'aria-label': 'Ver elenco de', on: { change: (e) => { elencoVisto = e.target.value; renderElenco(); } } });

  const abas = el('div', { class: 'sala-abas', role: 'tablist', 'aria-label': 'Seções da sala' },
    [['jogadores', 'Jogadores'], ['elenco', 'Elenco'], ['quadro', 'Quadro']].map(([id, nome]) => el('button', {
      type: 'button', role: 'tab', text: nome, 'aria-selected': String(id === 'jogadores'), dataset: { aba: id },
      on: { click: () => trocarAba(id) },
    })));

  const raiz = el('section', { class: 'sala', dataset: { aba: 'jogadores' } },
    el('div', { class: 'cartao sala-barra' },
      el('div', { class: 'sala-barra-info' }, ui.status, ui.vez, ui.proximos),
      ui.relogio,
      ui.controles),
    abas,
    el('div', { class: 'sala-grade' },
      el('div', { class: 'cartao painel-jogadores', dataset: { painel: 'jogadores' } },
        el('h2', { class: 'titulo-cartao', text: 'Jogadores disponíveis' }),
        el('div', { class: 'filtros' }, busca, selClube, selOrdem),
        chipsPos, chkValidos, ui.lista, ui.contagem),
      el('div', { class: 'coluna-direita' },
        el('div', { class: 'cartao painel-elenco', dataset: { painel: 'elenco' } },
          el('div', { class: 'cabecalho-cartao' }, el('h2', { class: 'titulo-cartao', text: 'Elenco' }), selElenco),
          ui.elenco,
          el('div', { class: 'bloco-fila' },
            el('h3', { class: 'subtitulo', text: 'Minha fila' }),
            el('p', { class: 'mudo nota', text: 'Se o seu tempo acabar, o app escolhe o primeiro da fila que ainda couber no elenco.' }),
            ui.fila)),
        el('div', { class: 'cartao painel-feed', dataset: { painel: 'elenco' } },
          el('h2', { class: 'titulo-cartao', text: 'Últimas escolhas' }), ui.feed))),
    el('div', { class: 'cartao painel-quadro', dataset: { painel: 'quadro' } },
      el('h2', { class: 'titulo-cartao', text: 'Quadro do draft' }), ui.quadro),
    el('div', { class: 'cartao painel-elencos', hidden: true },
      el('div', { class: 'cabecalho-cartao' },
        el('h2', { class: 'titulo-cartao', text: 'Elencos' }),
        el('button', { class: 'botao', type: 'button', text: 'Baixar planilha (CSV)', on: { click: exportarCSV } })),
      ui.elencos));

  container.replaceChildren(raiz);

  function trocarAba(id) {
    raiz.dataset.aba = id;
    abas.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === id)));
  }

  // ---------- Derivados ----------

  function derivados() {
    const { draft, times, escolhas, liga } = est;
    const ordem = draft.ordem;
    const total = totalEscolhas(ordem, draft.config);
    const n = draft.n;
    const timesPorId = new Map(times.map((t) => [t.id, t]));
    const ocupados = new Set(escolhas.map((e) => e.atletaId));
    const porTime = new Map(ordem.map((id) => [id, []]));
    for (const e of escolhas) porTime.get(e.timeId)?.push(e);
    const meuTimeId = timesPorId.has(usuario.uid) ? usuario.uid : null;
    const organizador = liga.organizadorUid === usuario.uid;
    const timeVez = n < total ? timeDaEscolha(n, ordem) : null;
    const reservaNaVez = timeVez && timesPorId.get(timeVez)?.reserva;
    // Por quem eu escolho agora: o meu time na minha vez; o organizador também
    // conduz times vagos e, se ativar, qualquer time.
    let alvo = null;
    if (draft.status === 'andamento' && timeVez) {
      if (timeVez === meuTimeId) alvo = timeVez;
      else if (organizador && (reservaNaVez || conduzir)) alvo = timeVez;
    }
    return { ordem, total, n, timesPorId, ocupados, porTime, meuTimeId, organizador, timeVez, alvo };
  }

  const nomeTime = (id) => est.times.find((t) => t.id === id)?.nome ?? 'Time removido';

  // ---------- Relógio e escolha automática ----------

  function restanteMs() {
    const d = est.draft;
    if (d.status === 'pausado') return (d.prazoRestante ?? d.config.segundos) * 1000;
    if (d.status !== 'andamento' || !d.inicioEscolha) return null;
    return d.inicioEscolha.toMillis() + d.prazoSegundos * 1000 - (Date.now() - offset);
  }

  function tique() {
    if (!est) return;
    const d = est.draft;
    const r = restanteMs();
    if (d.status === 'encerrado') {
      ui.relogio.textContent = 'FIM';
      ui.relogio.className = 'relogio fim';
      return;
    }
    const seg = Math.max(0, Math.ceil((r ?? 0) / 1000));
    ui.relogio.textContent = d.status === 'pausado' ? `⏸ ${seg}s` : `${seg}s`;
    ui.relogio.className = `relogio${d.status === 'pausado' ? ' pausado' : seg <= 10 ? ' urgente' : ''}`;
    if (d.status === 'andamento' && r !== null && r <= 0) tentarAutomatica(-r);
  }

  async function tentarAutomatica(atraso) {
    const { n, total, timeVez, meuTimeId, organizador, timesPorId, porTime, ocupados } = derivados();
    if (n >= total || !timeVez) return;
    const souDono = timeVez === meuTimeId;
    const vaga = timesPorId.get(timeVez)?.reserva;
    const pode = souDono || (organizador && vaga) || ((meuTimeId || organizador) && atraso > FOLGA_AUTO_MS + jitter);
    if (!pode) return;
    const ultima = tentativas.get(n) ?? 0;
    if (Date.now() - ultima < REPETIR_AUTO_MS) return;
    tentativas.set(n, Date.now());
    const escolha = escolhaAutomatica(porTime.get(timeVez) ?? [], souDono ? fila : [], atletas, est.draft.config, { ocupados });
    if (!escolha) return;
    try {
      await api.escolher({ ligaId, nEsperado: n, atleta: escolha.atleta, automatica: true, uid: usuario.uid });
    } catch (e) {
      // Outro participante pode ter escolhido antes, ou o prazo ainda não
      // estourou no relógio do servidor: tenta de novo no próximo tique.
      console.debug('Escolha automática não gravada:', e.message);
    }
  }

  const relogio = setInterval(tique, 250);

  // ---------- Ações ----------

  async function escolher(atleta) {
    const { n, alvo } = derivados();
    if (!alvo) return;
    if (confirmando !== atleta.id) {
      confirmando = atleta.id;
      clearTimeout(timerConfirmar);
      timerConfirmar = setTimeout(() => { confirmando = null; renderJogadores(); }, 4000);
      renderJogadores();
      return;
    }
    confirmando = null;
    try {
      await api.escolher({ ligaId, nEsperado: n, atleta, automatica: false, uid: usuario.uid });
      toast(`${atleta.apelido} escolhido para ${nomeTime(alvo)}.`);
    } catch (e) {
      toast(e.message || 'Não foi possível escolher.', 'erro');
    }
  }

  function salvarFila(nova) {
    fila = nova;
    renderFila();
    renderJogadores();
    api.salvarFila(ligaId, usuario.uid, nova).catch(() => toast('Não foi possível salvar a fila.', 'erro'));
  }

  function alternarFila(atleta) {
    salvarFila(fila.includes(atleta.id) ? fila.filter((id) => id !== atleta.id) : [...fila, atleta.id]);
  }

  function moverFila(id, delta) {
    const i = fila.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= fila.length) return;
    const nova = [...fila];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    salvarFila(nova);
  }

  function exportarCSV() {
    const csv = gerarCSV(est.escolhas, { nomeTime, nomeClube, totalTimes: est.draft.ordem.length });
    baixarArquivo(`draft-${normalizarTexto(est.liga.nome).replace(/[^a-z0-9]+/g, '-')}.csv`, csv, 'text/csv;charset=utf-8');
  }

  // ---------- Desenho ----------

  function renderBarra() {
    const d = est.draft;
    const { n, total, ordem, timeVez, meuTimeId, organizador } = derivados();
    const rodada = Math.min(rodadaDaEscolha(Math.min(n, total - 1), ordem.length), d.config.jogadores);
    ui.status.textContent = d.status === 'encerrado'
      ? `Draft encerrado · ${total} escolhas`
      : `Escolha ${n + 1} de ${total} · Rodada ${rodada} de ${d.config.jogadores}${d.status === 'pausado' ? ' · PAUSADO' : ''}`;

    ui.vez.replaceChildren();
    if (timeVez) {
      const minha = timeVez === meuTimeId;
      ui.vez.append(el('span', { class: 'mudo', text: 'Vez de ' }), el('strong', { text: nomeTime(timeVez) }));
      if (minha) ui.vez.append(el('span', { class: 'sua-vez', text: 'É A SUA VEZ' }));
      raiz.classList.toggle('minha-vez', minha && d.status === 'andamento');
    } else {
      raiz.classList.remove('minha-vez');
    }

    ui.proximos.replaceChildren(...proximasEscolhas(n + 1, ordem, d.config, 3)
      .map((p) => el('li', { class: p.timeId === meuTimeId ? 'meu' : '' }, el('span', { class: 'mudo', text: `${p.n + 1}. ` }), nomeTime(p.timeId))));

    ui.controles.replaceChildren();
    if (organizador && d.status !== 'encerrado') {
      ui.controles.append(d.status === 'pausado'
        ? el('button', { class: 'botao primario', type: 'button', text: 'Retomar', on: { click: () => api.retomar(ligaId, d).catch(erro) } })
        : el('button', { class: 'botao', type: 'button', text: 'Pausar', on: { click: () => api.pausar(ligaId, (restanteMs() ?? 0) / 1000).catch(erro) } }));
    }
    if (organizador && est.escolhas.length) {
      ui.controles.append(el('button', {
        class: 'botao', type: 'button', text: 'Desfazer última',
        on: {
          click: () => {
            const ultima = est.escolhas.at(-1);
            if (confirm(`Desfazer a escolha ${ultima.n + 1} (${ultima.apelido}, ${nomeTime(ultima.timeId)})?`)) api.desfazer(ligaId, d, ultima).catch(erro);
          },
        },
      }));
    }
    if (organizador && d.status !== 'encerrado') {
      ui.controles.append(el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: conduzir, on: { change: (e) => { conduzir = e.target.checked; renderTudo(); } } }),
        ' Escolher pelos outros'));
    }
  }

  function erro(e) {
    toast(e.message || 'Não foi possível concluir.', 'erro');
  }

  function renderJogadores() {
    const { alvo, ocupados, porTime, meuTimeId } = derivados();
    const config = est.draft.config;
    const elencoAlvo = porTime.get(alvo ?? meuTimeId) ?? [];
    const termo = normalizarTexto(filtros.busca.trim());
    let lista = atletas.filter((a) => !ocupados.has(a.id)
      && (!filtros.pos || a.posicao === filtros.pos)
      && (!filtros.clube || String(a.clubeId) === filtros.clube)
      && (!termo || normalizarTexto(`${a.apelido} ${a.nome}`).includes(termo)));
    const validade = new Map(lista.map((a) => [a.id, validarEscolha(elencoAlvo, a, config, { ocupados, nomeClube })]));
    if (filtros.soValidos) lista = lista.filter((a) => validade.get(a.id).ok);
    lista.sort(ORDENACOES[filtros.ordem][1]);

    ui.contagem.textContent = lista.length > LIMITE_LISTA
      ? `Mostrando ${LIMITE_LISTA} de ${lista.length}. Use a busca ou os filtros para achar os demais.`
      : `${lista.length} jogador${lista.length === 1 ? '' : 'es'}.`;

    ui.lista.replaceChildren(...lista.slice(0, LIMITE_LISTA).map((a) => {
      const v = validade.get(a.id);
      const clube = clubes.get(a.clubeId);
      const naFila = fila.includes(a.id);
      const botao = el('button', {
        class: `botao ${confirmando === a.id ? 'confirmar' : 'primario'} pequeno`, type: 'button',
        text: confirmando === a.id ? 'Confirmar' : 'Escolher',
        disabled: !alvo || !v.ok,
        title: !alvo ? 'Aguarde a sua vez' : v.ok ? `Escolher ${a.apelido}` : v.motivo,
        on: { click: () => escolher(a) },
      });
      return el('div', { class: `jogador${v.ok ? '' : ' invalido'}`, role: 'listitem' },
        foto(a),
        el('div', { class: 'jogador-info' },
          el('span', { class: 'jogador-nome' }, el('strong', { text: a.apelido }), iconeStatus(a.status)),
          el('span', { class: 'jogador-meta' }, tagPosicao(a.posicao), escudo(clube, 18), el('span', { text: clube?.sigla ?? '' }),
            v.ok ? null : el('span', { class: 'motivo', text: v.motivo }))),
        el('div', { class: 'jogador-num' }, el('strong', { text: fmtMedia(a.media) }), el('span', { class: 'mudo', text: 'média' })),
        el('div', { class: 'jogador-num opc' }, el('strong', { text: fmtPreco(a.preco) }), el('span', { class: 'mudo', text: `${a.jogos} jogos` })),
        el('div', { class: 'jogador-acoes' },
          meuTimeId ? el('button', {
            class: `botao pequeno icone-fila${naFila ? ' ativo' : ''}`, type: 'button', text: naFila ? '★' : '☆',
            'aria-label': naFila ? `Tirar ${a.apelido} da fila` : `Pôr ${a.apelido} na fila`, 'aria-pressed': String(naFila),
            on: { click: () => alternarFila(a) },
          }) : null,
          botao));
    }));
  }

  function renderElenco() {
    const { porTime, meuTimeId, timeVez, ordem } = derivados();
    const config = est.draft.config;
    if (!elencoVisto || !ordem.includes(elencoVisto)) elencoVisto = meuTimeId ?? timeVez ?? ordem[0];
    selElenco.replaceChildren(...ordem.map((id) => el('option', { value: id, text: `${nomeTime(id)}${id === meuTimeId ? ' (meu)' : ''}`, selected: id === elencoVisto })));
    const escolhas = porTime.get(elencoVisto) ?? [];
    const r = resumoElenco(escolhas, config);

    const contadores = el('ul', { class: 'contadores' },
      POSICOES.map((p) => el('li', { class: r.porPosicao[p] >= config.minimos[p] ? 'ok' : '' },
        tagPosicao(p), el('strong', { text: `${r.porPosicao[p]}/${config.minimos[p]}` }))),
      el('li', { class: 'livres' }, el('span', { text: 'Livres' }), el('strong', { text: String(Math.max(0, r.livres)) })));

    const clubesCheios = [...r.porClube.entries()].filter(([, q]) => q >= config.maxPorClube - 1)
      .map(([id, q]) => el('span', { class: `chip-clube${q >= config.maxPorClube ? ' cheio' : ''}` }, escudo(clubes.get(id), 16), `${clubes.get(id)?.sigla ?? id} ${q}/${config.maxPorClube}`));

    const grupos = POSICOES.map((p) => {
      const daPos = escolhas.filter((e) => e.posicao === p);
      return el('div', { class: 'grupo-pos' },
        el('h4', { text: PLURAIS[p] }),
        daPos.length
          ? el('ul', {}, daPos.map((e) => el('li', {}, escudo(clubes.get(e.clubeId), 16), el('span', { text: e.apelido }), el('span', { class: 'mudo', text: `#${e.n + 1}` }))))
          : el('p', { class: 'mudo vazio-pos', text: '—' }));
    });

    ui.elenco.replaceChildren(...[
      el('p', { class: 'mudo nota', text: `${r.total} de ${config.jogadores} jogadores` }),
      contadores,
      clubesCheios.length ? el('div', { class: 'clubes-cheios' }, clubesCheios) : null,
      el('div', { class: 'grupos' }, grupos),
    ].filter(Boolean));
  }

  function renderFila() {
    const { ocupados, meuTimeId } = derivados();
    if (!meuTimeId) {
      ui.fila.replaceChildren(el('li', { class: 'mudo', text: 'Só quem tem time monta fila.' }));
      return;
    }
    const itens = fila.filter((id) => porId.has(id) && !ocupados.has(id));
    if (!itens.length) {
      ui.fila.replaceChildren(el('li', { class: 'mudo', text: 'Vazia. Use ☆ na lista para adicionar.' }));
      return;
    }
    ui.fila.replaceChildren(...itens.map((id, i) => {
      const a = porId.get(id);
      return el('li', {},
        el('span', { class: 'fila-pos', text: `${i + 1}.` }), tagPosicao(a.posicao), el('span', { class: 'fila-nome', text: a.apelido }),
        el('button', { class: 'botao link', type: 'button', text: '↑', 'aria-label': `Subir ${a.apelido}`, disabled: i === 0, on: { click: () => moverFila(id, -1) } }),
        el('button', { class: 'botao link', type: 'button', text: '↓', 'aria-label': `Descer ${a.apelido}`, disabled: i === itens.length - 1, on: { click: () => moverFila(id, 1) } }),
        el('button', { class: 'botao link', type: 'button', text: '✕', 'aria-label': `Tirar ${a.apelido} da fila`, on: { click: () => alternarFila(a) } }));
    }));
  }

  function renderFeed() {
    ui.feed.replaceChildren(...est.escolhas.slice(-8).reverse().map((e) => el('li', {},
      el('span', { class: 'mudo', text: `#${e.n + 1}` }),
      el('strong', { text: nomeTime(e.timeId) }),
      el('span', { text: '→' }),
      tagPosicao(e.posicao),
      el('span', { text: e.apelido }),
      escudo(clubes.get(e.clubeId), 16),
      e.automatica ? el('span', { class: 'tag-auto', text: 'auto', title: 'Escolha automática' }) : null)));
    if (!est.escolhas.length) ui.feed.append(el('li', { class: 'mudo', text: 'Nenhuma escolha ainda.' }));
  }

  function renderQuadro() {
    const { ordem, n, meuTimeId } = derivados();
    const config = est.draft.config;
    const T = ordem.length;
    const porN = new Map(est.escolhas.map((e) => [e.n, e]));
    const thead = el('thead', {}, el('tr', {}, el('th', { text: 'R' }),
      ordem.map((id) => el('th', { class: id === meuTimeId ? 'meu' : '', text: nomeTime(id) }))));
    const linhas = [];
    for (let r = 0; r < config.jogadores; r += 1) {
      const celulas = [el('th', { text: String(r + 1) })];
      for (let j = 0; j < T; j += 1) {
        const k = r * T + (r % 2 === 0 ? j : T - 1 - j);
        const e = porN.get(k);
        const td = el('td', { class: `${k === n && est.draft.status !== 'encerrado' ? 'atual' : ''}${e ? ` pos-${e.posicao}` : ''}`, title: `Escolha ${k + 1}` });
        if (e) td.append(el('span', { class: 'q-nome', text: e.apelido }), el('span', { class: 'q-meta', text: `${e.posicao} · ${clubes.get(e.clubeId)?.sigla ?? ''}` }));
        else td.append(el('span', { class: 'q-vazio', text: String(k + 1) }));
        celulas.push(td);
      }
      linhas.push(el('tr', {}, celulas));
    }
    ui.quadro.replaceChildren(el('table', { class: 'quadro' }, thead, el('tbody', {}, linhas)));
  }

  function renderElencos() {
    const painel = raiz.querySelector('.painel-elencos');
    const encerrado = est.draft.status === 'encerrado';
    painel.hidden = !encerrado;
    raiz.classList.toggle('encerrado', encerrado);
    if (!encerrado) return;
    const { porTime, ordem } = derivados();
    ui.elencos.replaceChildren(...ordem.map((id) => {
      const escolhas = porTime.get(id) ?? [];
      return el('article', { class: 'elenco-final' },
        el('h3', { text: nomeTime(id) }),
        POSICOES.map((p) => el('p', {}, tagPosicao(p), ' ', escolhas.filter((e) => e.posicao === p).map((e) => e.apelido).join(', ') || '—')));
    }));
  }

  function renderTudo() {
    renderBarra();
    renderJogadores();
    renderElenco();
    renderFila();
    renderFeed();
    renderQuadro();
    renderElencos();
    tique();
  }

  // ---------- Entradas ----------

  let pararFila = null;

  function atualizar(novo) {
    est = novo;
    const d = est.draft;
    const { timeVez, meuTimeId } = derivados();
    // Mudança nova da vez: estima a diferença entre o relógio local e o do servidor.
    if ((ultimoN !== null && d.n !== ultimoN) || (ultimoStatus && ultimoStatus !== d.status)) {
      if (!d.pendente && d.inicioEscolha) offset = Date.now() - d.inicioEscolha.toMillis();
      if (d.status === 'andamento' && timeVez && timeVez === meuTimeId) {
        bip();
        toast(AVISO_VEZ);
      } else {
        esconderToast(AVISO_VEZ);
      }
    }
    ultimoN = d.n;
    ultimoStatus = d.status;
    document.title = d.status === 'andamento' && timeVez && timeVez === meuTimeId ? '⏰ Sua vez · Liga Draft' : `${est.liga.nome} · Liga Draft`;
    if (meuTimeId && !pararFila) pararFila = api.ouvirFila(ligaId, usuario.uid, (f) => { fila = f; renderFila(); renderJogadores(); });
    renderTudo();
  }

  function destruir() {
    clearInterval(relogio);
    clearTimeout(timerConfirmar);
    pararFila?.();
    document.title = 'Liga Draft Cartola';
  }

  return { atualizar, destruir };
}
