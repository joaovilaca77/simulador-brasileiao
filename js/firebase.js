// Carrega o SDK do Firebase pelo CDN (sem build) e prepara Auth e Firestore.

const VERSAO_SDK = '12.19.0';
const CDN = `https://www.gstatic.com/firebasejs/${VERSAO_SDK}`;

// `?emulador=1` na URL conecta aos emuladores locais (firebase emulators:start).
function usarEmuladores() {
  try {
    return new URLSearchParams(location.search).has('emulador');
  } catch {
    return false;
  }
}

export async function iniciarFirebase(config) {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);

  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = fsMod.getFirestore(app);

  if (usarEmuladores()) {
    authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }

  const provedor = new authMod.GoogleAuthProvider();

  return {
    db,
    fs: fsMod,
    entrar: () => authMod.signInWithPopup(auth, provedor),
    sair: () => authMod.signOut(auth),
    aoMudarUsuario: (cb) => authMod.onAuthStateChanged(auth, cb),
  };
}
