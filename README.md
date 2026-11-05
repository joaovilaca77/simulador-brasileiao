# Liga Draft Cartola

Site para fazer, ao vivo, o **draft da liga de Cartola**. Cada técnico escolhe na sua vez os jogadores do Cartola FC que vão formar o elenco da temporada.

Esta é a **etapa 1 (o draft)**. A liga em si fica para a etapa 2: confrontos, pontuação e mercado.

## Regras da liga

- **20 times**, cada um com **23 jogadores**, no máximo **4 do mesmo clube**. Não há técnico.
- **Composição mínima:** 2 GOL, 4 LAT, 4 ZAG, 4 MEI e 4 ATA (18 vagas). As outras **5 vagas são livres**.
- **Duelos em pontos corridos**, turno e returno: 3 pontos pela vitória, 1 pelo empate e 0 pela derrota. A soma dos pontos do Cartola é o critério de desempate. A cada rodada, cada time escala 11 dos seus 23. *(etapa 2)*
- **Mercado de transferências** aberto durante todo o campeonato e **segundo draft no returno**, só com os jogadores não escolhidos. *(etapa 2)*

## Como funciona o draft

1. **Criar a liga:** o organizador entra com a conta Google, escolhe o nome e a temporada e diz se também vai ter um time.
2. **Convidar:** o organizador manda o link de convite. Cada técnico abre o link, entra com Google e dá nome ao time. Quem não for usar o app pode virar um **time vago**, e o organizador escolhe por ele.
3. **Sortear:** com os 20 times inscritos, o organizador sorteia a ordem. Todos veem o sorteio ao mesmo tempo.
4. **Iniciar:** a ordem é em **serpentina** (1→20 na 1ª rodada, 20→1 na 2ª…), num total de 460 escolhas.
5. **Na sua vez:**
   - **relógio de 90 s** (ajustável de 30 a 180 s);
   - o app só deixa escolher quem cabe no elenco e explica o motivo quando não cabe (limite de clube, vagas que precisam ficar para os mínimos);
   - cada escolha pede confirmação (dois cliques).
6. **Fila:** marque jogadores com ☆ e ordene-os. Se o seu tempo acabar, sai o primeiro da fila que couber; sem fila, o de maior média, desempatando pelo preço. Se o dono da vez estiver offline, outro participante faz a escolha automática 3 s depois do prazo.
7. **Organizador:** pausa e retoma, desfaz a última escolha e pode escolher pelos outros times.
8. **Fim:** o app mostra o elenco de cada time e o organizador baixa a planilha (CSV com `;`, que abre direto no Excel).

## Jogadores (Cartola FC)

`data/atletas.json` e os escudos em `img/escudos/` são gerados por `scripts/atualizar-atletas.mjs`, que lê a API pública do Cartola (`api.cartola.globo.com`):
- os técnicos ficam de fora;
- o script só grava se vierem os 20 clubes e pelo menos 400 jogadores.

**Atualização automática:** o workflow **Atualizar jogadores** roda todo dia e também sob demanda (aba **Actions** → *Atualizar jogadores* → *Run workflow*). Ele commita a lista nova e o GitHub Pages republica o site.

> **Próxima temporada:** o Cartola só abre a temporada nova perto do início do Brasileirão (normalmente entre janeiro e fevereiro). Até lá a lista é a da temporada atual, e o site mostra um aviso quando a temporada da liga é diferente. Faça o draft depois que o Cartola abrir o mercado da nova temporada, para ter os elencos e os clubes certos.

Durante o draft, cada escolha guarda um retrato do jogador (nome, posição e clube). Uma atualização da lista no meio do draft não muda o que já foi escolhido.

Também dá para rodar no seu computador (Node 20+): `npm run atletas`.

## Configurar o Firebase (uma vez, pelo organizador)

O login e a sincronização ao vivo usam o Firebase. O plano gratuito (Spark) basta.

1. Em https://console.firebase.google.com, crie um projeto.
2. **Authentication** → *Método de login* → ative **Google**.
3. **Authentication** → *Configurações* → *Domínios autorizados* → adicione `joaovilaca77.github.io`.
4. **Firestore Database** → *Criar banco de dados* (modo produção; região `southamerica-east1`, se quiser).
5. **Firestore** → aba **Regras** → cole o conteúdo de [`firestore.rules`](firestore.rules) e publique. Faça isso de novo sempre que esse arquivo mudar.
6. **Configurações do projeto** → *Seus apps* → **App da Web** → copie o `firebaseConfig` para [`js/firebase-config.js`](js/firebase-config.js).

Os valores do `firebaseConfig` não são segredo. A proteção está nas regras:
- só o dono da vez escolhe;
- outro participante só escolhe depois do prazo;
- cada jogador só pode ser escolhido uma vez;
- a fila é privada;
- só o organizador configura, sorteia, pausa e desfaz.

### Estrutura no Firestore

```
ligas/{liga}                         nome, temporada, organizador, convite
ligas/{liga}/times/{uid}             time de cada técnico (ou time vago)
ligas/{liga}/filas/{uid}             fila de preferências (privada)
ligas/{liga}/drafts/inicial          ordem, vez atual, relógio, configuração
ligas/{liga}/drafts/inicial/escolhas/{n}
ligas/{liga}/drafts/inicial/ocupados/{atleta}
usuarios/{uid}/ligas/{liga}          lista "Minhas ligas"
```

O draft do returno vai usar `drafts/returno`, com a mesma estrutura.

## Desenvolvimento

```bash
npm run dev            # serve o site em http://localhost:3000
npm test               # regras do draft, coleta do Cartola e carimbo de versão
npm run test:regras    # regras do Firestore no emulador (precisa de npm install e Java)
```

- **Emuladores:** `npx firebase-tools emulators:start --project demo-liga --only auth,firestore`. Depois abra o site com `?emulador=1`. Nesse modo o organizador tem um botão de configuração de teste (4 jogadores, relógio de 10 s).
- **Carimbo de versão:** depois de mudar o CSS ou algum arquivo em `js/`, rode `npm run versionar` antes do commit. O script carimba os endereços com `?v=<código>`, para o navegador não misturar arquivos novos com antigos do cache.

### Estrutura

```
index.html, css/style.css, fonts/, img/
js/draft.js           regras do draft (serpentina, validação, escolha automática, CSV)
js/liga.js            Firestore: ligas, times, escolhas, fila, ações do organizador
js/sala.js            sala do draft (relógio, jogadores, elenco, fila, quadro)
js/app.js             rotas, início, convite e saguão
js/ui.js              utilitários de interface e tema claro/escuro
js/firebase.js        carrega o SDK do Firebase pelo CDN
scripts/              coleta do Cartola e carimbo de versão
tests/                testes (node:test) e regras do Firestore (tests/regras)
```

## Identidade visual

O site usa o emblema e as cores do Brasileirão:
- verde-limão `#c7ff00` e grafite `#131428`;
- fontes Barlow e Barlow Condensed (SIL OFL, em `fonts/`);
- tema claro e escuro.

> Projeto de amigos, sem vínculo com a Globo, o Cartola FC, a CBF ou os clubes. Cartola FC é marca da Globo; Brasileirão e seu logotipo são marcas da CBF; os escudos são marcas dos respectivos clubes.
