// Client REST minimal pour Cloud Firestore et Firebase Auth.
//
// Volontairement sans le SDK officiel : le SDK JS de Firebase se charge
// normalement depuis www.gstatic.com, injoignable depuis certains réseaux
// (dont celui utilisé pour construire ce site). L'API REST, elle, passe
// partout où passe une simple requête HTTPS. Ce fichier ne dépend de rien
// d'autre que la configuration posée dans window.MALYSIA_FIREBASE_CONFIG
// (voir firebase-config.example.js).
//
// Portée volontairement réduite aux opérations dont ce site a besoin :
// créer un document, en lire un, en lister, en corriger un champ, et se
// connecter avec un compte e-mail / mot de passe. Ce n'est pas un SDK
// général, juste ce qu'il faut à Malysia Car Pro.

const cfg = () => window.MALYSIA_FIREBASE_CONFIG || null;

function baseUrl() {
  const c = cfg();
  if (!c || !c.projectId) return null;
  return `https://firestore.googleapis.com/v1/projects/${c.projectId}/databases/(default)/documents`;
}

// ---- conversion entre objets JS ordinaires et le format typé de Firestore

function versValeurFirestore(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(versValeurFirestore) } };
  }
  if (typeof v === "object") {
    return { mapValue: { fields: versChampsFirestore(v) } };
  }
  return { stringValue: String(v) };
}

function versChampsFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = versValeurFirestore(v);
  }
  return fields;
}

function depuisValeurFirestore(val) {
  if (!val) return null;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return parseInt(val.integerValue, 10);
  if ("doubleValue" in val) return val.doubleValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("arrayValue" in val) return (val.arrayValue.values || []).map(depuisValeurFirestore);
  if ("mapValue" in val) return depuisChampsFirestore(val.mapValue.fields || {});
  return null;
}

function depuisChampsFirestore(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = depuisValeurFirestore(v);
  return obj;
}

function depuisDocument(doc) {
  if (!doc || !doc.name) return null;
  return {
    id: doc.name.split("/").pop(),
    ...depuisChampsFirestore(doc.fields || {}),
  };
}

// ---- Firestore : lecture, écriture

/** Crée un document dans `collection`, sous l'identifiant `id` s'il est donné. Retourne {id, ...champs} ou lève une erreur (avec `status`). */
export async function creerDocument(collection, donnees, { idToken, id } = {}) {
  const url = `${baseUrl()}/${collection}` + (id ? `?documentId=${encodeURIComponent(id)}` : "");
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields: versChampsFirestore(donnees) }),
  });
  if (!res.ok) {
    const err = new Error(`Firestore ${res.status} : ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return depuisDocument(await res.json());
}

/** Lit un document par identifiant. Retourne null s'il n'existe pas. */
export async function lireDocument(collection, id, { idToken } = {}) {
  const url = `${baseUrl()}/${collection}/${encodeURIComponent(id)}`;
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore ${res.status} : ${await res.text()}`);
  return depuisDocument(await res.json());
}

/** Liste les documents d'une collection, page par page, jusqu'à `max` documents. */
export async function listerDocuments(collection, { idToken, max = 2000 } = {}) {
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const documents = [];
  let jetonPage = "";
  do {
    const url = `${baseUrl()}/${collection}?pageSize=300` + (jetonPage ? `&pageToken=${encodeURIComponent(jetonPage)}` : "");
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = new Error(`Firestore ${res.status} : ${await res.text()}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    documents.push(...(data.documents || []).map(depuisDocument));
    jetonPage = data.nextPageToken || "";
  } while (jetonPage && documents.length < max);
  return documents;
}

/** Met à jour uniquement les champs donnés (les autres restent intacts). */
export async function corrigerDocument(collection, id, donnees, { idToken } = {}) {
  const champs = Object.keys(donnees).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const url = `${baseUrl()}/${collection}/${encodeURIComponent(id)}?${champs}`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: versChampsFirestore(donnees) }),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status} : ${await res.text()}`);
  return depuisDocument(await res.json());
}

/** Supprime un document. */
export async function supprimerDocument(collection, id, { idToken } = {}) {
  const url = `${baseUrl()}/${collection}/${encodeURIComponent(id)}`;
  const headers = {};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Firestore ${res.status} : ${await res.text()}`);
}

// ---- Authentification (compte e-mail / mot de passe du back-office)

/** Connecte un membre de l'équipe. Retourne {idToken, email, ...} ou lève une erreur. */
export async function connecter(email, motDePasse) {
  const c = cfg();
  if (!c || !c.apiKey) throw new Error("Configuration Firebase manquante.");
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${c.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: motDePasse, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    const code = data && data.error && data.error.message;
    const messages = {
      EMAIL_NOT_FOUND: "Aucun compte avec cet e-mail.",
      INVALID_PASSWORD: "Mot de passe incorrect.",
      INVALID_LOGIN_CREDENTIALS: "E-mail ou mot de passe incorrect.",
      USER_DISABLED: "Ce compte est désactivé.",
    };
    throw new Error(messages[code] || "Connexion refusée.");
  }
  return data; // { idToken, email, refreshToken, expiresIn, localId, ... }
}

export function estConfigure() {
  const c = cfg();
  return !!(c && c.apiKey && c.projectId && c.apiKey !== "REMPLACER");
}
