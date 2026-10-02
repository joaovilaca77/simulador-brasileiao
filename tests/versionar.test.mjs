import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularVersao, carimbarHTML, carimbarJS, versionar } from '../scripts/versionar.mjs';

test('carimba CSS e JS no HTML, trocando carimbos antigos', () => {
  const html = '<link rel="stylesheet" href="css/style.css?v=abc123"><script type="module" src="js/app.js"></script><img src="img/x.png">';
  assert.equal(carimbarHTML(html, 'f00'),
    '<link rel="stylesheet" href="css/style.css?v=f00"><script type="module" src="js/app.js?v=f00"></script><img src="img/x.png">');
});

test('carimba só imports relativos nos módulos', () => {
  const js = "import { a } from './tabela.js';\nimport b from './projecao.js?v=1a';\nconst m = import(`${CDN}/firebase-app.js`);";
  assert.equal(carimbarJS(js, 'f00'),
    "import { a } from './tabela.js?v=f00';\nimport b from './projecao.js?v=f00';\nconst m = import(`${CDN}/firebase-app.js`);");
});

test('a versão ignora os carimbos e muda com o conteúdo', () => {
  assert.equal(calcularVersao(["from './a.js?v=111'"]), calcularVersao(["from './a.js?v=222'"]));
  assert.notEqual(calcularVersao(['a{color:red}']), calcularVersao(['a{color:blue}']));
});

test('os arquivos do site estão com o carimbo em dia (rode npm run versionar)', async () => {
  const { desatualizados } = await versionar({ verificar: true });
  assert.deepEqual(desatualizados, []);
});
