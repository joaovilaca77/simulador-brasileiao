# Simulador do Brasileirão

Site estático para palpitar os jogos restantes do Brasileirão Série A e ver a classificação se recalcular na hora. Com login Google (Firebase), cada pessoa guarda os próprios palpites na nuvem, e a **tabela final projetada** de cada rodada fica registrada para acompanhar como a sua previsão mudou ao longo do campeonato.

- **Palpites:** digite o placar dos jogos que ainda não começaram. A tabela mostra cores de zona e setas ▲▼ comparando com a tabela real.
- **Trava:** o palpite de um jogo fica bloqueado quando a bola rola.
- **Evolução:** gráfico com a posição projetada de até 4 times por rodada, mais a tabela completa.
- **Sem login:** funciona no modo visitante, com os palpites guardados só no navegador. Ao entrar com Google, eles são mesclados com os da nuvem.

HTML, CSS e JavaScript puros, sem build e sem dependências.

## Rodar localmente

Os módulos ES não funcionam abrindo o arquivo direto (`file://`). Sirva a pasta:

```bash
npm run dev            # npx serve na porta 3000
# ou: python3 -m http.server 3000
```

Depois, abra http://localhost:3000.

Testes (Node 20+): `npm test`.

## Dados dos jogos (Sofascore)

O arquivo `data/brasileirao.json` é gerado por `scripts/atualizar-dados.mjs`, que lê a API **não oficial** do Sofascore (torneio 325, as 38 rodadas). O site nunca chama o Sofascore direto, porque a API não libera acesso de outros domínios (CORS).

```bash
npm run dados                          # temporada do ano atual
node scripts/atualizar-dados.mjs --temporada 2026
```

O script só grava se vierem os 380 jogos e se algo tiver mudado. Se a coleta falhar, o arquivo anterior fica intacto.

**Atualização automática:** o workflow `.github/workflows/atualizar-dados.yml` roda a cada 3 horas e também pode ser disparado à mão (aba *Actions* → *Atualizar dados* → *Run workflow*). Quando os dados mudam, ele faz o commit do JSON. Observações:
- Workflows agendados só rodam na branch padrão (`main`).
- O Sofascore às vezes bloqueia IPs de servidores. Se o workflow falhar com HTTP 403, rode `npm run dados` no seu computador e faça o commit do JSON.

O repositório vem com **dados de exemplo** (resultados fictícios, `"fonte": "exemplo"`), e o site mostra um aviso enquanto eles estiverem ativos. Para regerar o exemplo: `npm run exemplo`.

## Configurar o Firebase

1. Em https://console.firebase.google.com, crie um projeto (o plano gratuito Spark basta).
2. **Authentication** → *Primeiros passos* → *Método de login* → ative **Google**.
3. **Authentication** → *Configurações* → *Domínios autorizados* → adicione o domínio do site, por exemplo `seu-usuario.github.io`. `localhost` já vem liberado.
4. **Firestore Database** → *Criar banco de dados* (modo produção, região `southamerica-east1`, se quiser).
5. **Firestore** → aba *Regras* → cole o conteúdo de [`firestore.rules`](firestore.rules) e publique. Alternativa pela CLI: `npx firebase-tools deploy --only firestore:rules --project SEU_PROJETO`.
6. **Configurações do projeto** → *Seus apps* → adicione um **App da Web** e copie o objeto `firebaseConfig` para [`js/firebase-config.js`](js/firebase-config.js).

Esses valores não são segredo: quem protege os dados são as regras, que só deixam cada usuário ler e gravar em `usuarios/{seu uid}/**`.

### Estrutura no Firestore

```
usuarios/{uid}                                            { nome, foto, atualizadoEm }
usuarios/{uid}/temporadas/{ano}                           { palpites: { [jogoId]: { m, v, salvoEm } }, atualizadoEm }
usuarios/{uid}/temporadas/{ano}/projecoes/{rodada}        { rodada, salvoEm, jogosPendentes, jogosPalpitados, classificacao }
```

A "rodada atual" é a primeira com jogos pendentes. A projeção dela é regravada a cada palpite. Quando a rodada vira, a anterior congela e passa a fazer parte do histórico.

### Testar com os emuladores

```bash
npx firebase-tools emulators:start --project demo-simulador --only auth,firestore
```

Abra o site com `?emulador=1` (por exemplo, http://localhost:3000/?emulador=1) e preencha `js/firebase-config.js` com qualquer `projectId` começando por `demo-`.

## Publicar no GitHub Pages

*Settings* → *Pages* → *Deploy from a branch* → `main`, pasta `/ (root)`. O site fica em `https://seu-usuario.github.io/simulador-brasileiao/`. Lembre de autorizar esse domínio no Firebase (passo 3).

## Regras da classificação

- **Desempate:** pontos → vitórias → saldo de gols → gols pró → confronto direto (quando só dois times estão empatados) → ordem alfabética, no lugar de cartões e sorteio.
- **Zonas:** ficam em `ZONAS`, em [`js/tabela.js`](js/tabela.js), e o padrão é 1–4 Libertadores, 5–6 pré-Libertadores, 7–12 Sul-Americana e 17–20 rebaixamento. As vagas reais mudam conforme os campeões das copas; ajuste ali se precisar.

## Estrutura

```
index.html, css/style.css
js/tabela.js          classificação, desempate, zonas, trava (funções puras)
js/projecao.js        rodada atual, snapshot da projeção, mesclagem de palpites
js/armazenamento.js   LocalStore (navegador) e FirebaseStore (Firestore)
js/firebase.js        carrega o SDK do Firebase pelo CDN
js/evolucao.js        gráfico e tabela da aba Evolução
js/app.js             interface
scripts/              coleta no Sofascore e gerador do exemplo
tests/                testes com node:test
```

## Limitações e próximos passos

- A trava dos palpites é aplicada no site. Como ainda não há pontuação nem ranking, as regras do Firestore não conferem o horário dos jogos. Para validar no servidor, seria preciso espelhar os horários em uma coleção `jogos` (gravada pelo workflow com uma conta de serviço) e comparar com `request.time` nas regras.
- A API do Sofascore não é oficial: os campos ou o acesso podem mudar sem aviso.
