// Nomes e siglas como o torcedor conhece, independentemente da fonte.
// As APIs usam nomes oficiais ou estrangeiros ("Mineiro", "Clube do Remo")
// e siglas que se repetem (Corinthians e Coritiba como "COR").

const PADRAO = [
  [['atletico mineiro', 'atletico-mg', 'mineiro', 'ca mineiro'], 'Atlético-MG', 'CAM'],
  [['athletico paranaense', 'athletico-pr', 'atletico paranaense', 'paranaense'], 'Athletico-PR', 'CAP'],
  [['bahia', 'ec bahia'], 'Bahia', 'BAH'],
  [['botafogo'], 'Botafogo', 'BOT'],
  [['bragantino', 'red bull bragantino', 'rb bragantino'], 'Bragantino', 'RBB'],
  [['chapecoense'], 'Chapecoense', 'CHA'],
  [['corinthians'], 'Corinthians', 'COR'],
  [['coritiba'], 'Coritiba', 'CFC'],
  [['cruzeiro'], 'Cruzeiro', 'CRU'],
  [['flamengo'], 'Flamengo', 'FLA'],
  [['fluminense'], 'Fluminense', 'FLU'],
  [['gremio'], 'Grêmio', 'GRE'],
  [['internacional'], 'Internacional', 'INT'],
  [['mirassol'], 'Mirassol', 'MIR'],
  [['palmeiras'], 'Palmeiras', 'PAL'],
  [['clube do remo', 'remo'], 'Remo', 'REM'],
  [['santos'], 'Santos', 'SAN'],
  [['sao paulo'], 'São Paulo', 'SAO'],
  [['vasco da gama', 'vasco'], 'Vasco', 'VAS'],
  [['vitoria', 'ec vitoria'], 'Vitória', 'VIT'],
];

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const INDICE = new Map(PADRAO.flatMap(([chaves, nome, sigla]) => chaves.map((c) => [c, { nome, sigla }])));

export function padronizarTime(time) {
  const ajuste = INDICE.get(normalizar(time.nome));
  return ajuste ? { ...time, ...ajuste } : time;
}
