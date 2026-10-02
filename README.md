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

## Como atualizar os dados

Os jogos ficam em `data/brasileirao.json` e os escudos em `img/escudos/`. Quem gera esses arquivos é `scripts/atualizar-dados.mjs`. O site nunca chama as APIs direto, porque elas não liberam acesso de outros domínios (CORS).

### 1. Pelo GitHub (recomendado)

O workflow **Atualizar dados** roda sozinho a cada 3 horas na branch padrão. Para rodar agora:

1. Abra a aba **Actions** do repositório.
2. Clique em **Atualizar dados** → **Run workflow** → **Run workflow**.
3. Em cerca de 1 minuto, o bot faz um commit com os dados novos e o GitHub Pages republica o site.

Opções do *Run workflow*: fonte (`auto`, `sofascore` ou `football-data`), ano da temporada e "baixar de novo todos os escudos".

### 2. Se o Sofascore bloquear o GitHub: football-data.org

O Sofascore às vezes recusa servidores (HTTP 403 no log do workflow). Nesse caso, use o [football-data.org](https://www.football-data.org), uma API oficial com plano gratuito que inclui a Série A:

1. Crie uma conta grátis em https://www.football-data.org/client/register. A chave chega por e-mail.
2. No GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, com o nome `FOOTBALL_DATA_TOKEN` e a chave como valor.
3. Rode o workflow de novo.

Enquanto o site ainda estiver com os dados de exemplo, o modo `auto` tenta o Sofascore e, se falhar, o football-data. Depois da primeira coleta, ele **continua na mesma fonte**. Para trocar de fonte, escolha-a no *Run workflow* ou crie a variável de repositório `FONTE_DADOS` (*Settings* → *Secrets and variables* → *Actions* → aba *Variables*) com `sofascore` ou `football-data`.

> Trocar de fonte muda os IDs dos jogos: os palpites já feitos deixam de corresponder aos jogos. Prefira escolher a fonte antes de começar a palpitar.

### 3. No seu computador

Com Node 20 ou mais recente:

```bash
npm run dados                                   # fonte automática
node scripts/atualizar-dados.mjs --fonte sofascore --temporada 2026
FOOTBALL_DATA_TOKEN=sua-chave node scripts/atualizar-dados.mjs --fonte football-data
git add data img && git commit -m "Atualiza dados" && git push
```

O script só grava se vierem os 380 jogos e se algo tiver mudado. Se a coleta falhar, o arquivo anterior fica intacto. Escudos que já existem não são baixados de novo (use `--escudos` para forçar), e um escudo que falhar é trocado pelas cores do time.

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

*Settings* → *Pages* → *Deploy from a branch* → a branch padrão do repositório, pasta `/ (root)`. O site fica em `https://seu-usuario.github.io/simulador-brasileiao/`. Lembre de autorizar esse domínio no Firebase (passo 3).

## Regras da classificação

- **Desempate:** pontos → vitórias → saldo de gols → gols pró → confronto direto (quando só dois times estão empatados) → ordem alfabética, no lugar de cartões e sorteio.
- **Zonas:** ficam em `ZONAS`, em [`js/tabela.js`](js/tabela.js), e o padrão é 1–4 Libertadores, 5–6 pré-Libertadores, 7–12 Sul-Americana e 17–20 rebaixamento. As vagas reais mudam conforme os campeões das copas; ajuste ali se precisar.

## Identidade visual

O visual é inspirado nas transmissões do Brasileirão:
- azul-marinho, verde e amarelo;
- fontes **Barlow** e **Barlow Condensed**, hospedadas em `fonts/` (licença SIL OFL, em `fonts/OFL.txt`);
- ícone de troféu próprio.

O site **não usa o logotipo oficial**, que é marca registrada da CBF e do patrocinador. As cores ficam como variáveis no topo de `css/style.css`. As cores das séries do gráfico seguem uma paleta validada para daltonismo; se mudar a ordem, valide de novo.

## Estrutura

```
index.html, css/style.css, fonts/
js/tabela.js          classificação, desempate, zonas, trava (funções puras)
js/projecao.js        rodada atual, snapshot da projeção, mesclagem de palpites
js/armazenamento.js   LocalStore (navegador) e FirebaseStore (Firestore)
js/firebase.js        carrega o SDK do Firebase pelo CDN
js/evolucao.js        gráfico e tabela da aba Evolução
js/app.js             interface
scripts/              coleta de dados e gerador do exemplo
scripts/fontes/       Sofascore e football-data.org
img/escudos/          escudos baixados pelo workflow
tests/                testes com node:test
```

## Limitações e próximos passos

- A trava dos palpites é aplicada no site. Como ainda não há pontuação nem ranking, as regras do Firestore não conferem o horário dos jogos. Para validar no servidor, seria preciso espelhar os horários em uma coleção `jogos` (gravada pelo workflow com uma conta de serviço) e comparar com `request.time` nas regras.
- A API do Sofascore não é oficial: os campos ou o acesso podem mudar sem aviso. O football-data.org é a alternativa estável.
- Escudos são marcas dos respectivos clubes.
