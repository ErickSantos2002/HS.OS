// Puxa o status do perfil do HS.OS e aplica no WA (spec 2026-10-15-escritoriohs-b).
//
// Carregado pela propriedade `script` do hs.tmj. O WA v1.33.11 o roda num
// iframe sandbox (origem `null`) com o `iframe_api.js` antes, que injeta `WA`.
// Por isso a chamada ao HS.OS é GET simples, sem cabeçalho próprio, e a rota
// responde com `Access-Control-Allow-Origin: *`.
//
// ⚠️ `WA.player.userRoomToken` LANÇA quando o token é `undefined` (é o que o
// play repassa sem Admin API). Lido dentro de try: sem token, o script desiste.
//
// Só aplica quando o valor muda, e no primeiro carregamento não aplica ONLINE:
// assim não desfaz o status que a pessoa escolheu dentro do WA.
const API = "https://hsosapi.healthsafetytech.com/escritorio/meu-status";
const INTERVALO = 60000;
let ultimo = null;
let desistiu = false;

function tokenDaSala() {
  try {
    return WA.player.userRoomToken;
  } catch (_) {
    return undefined;
  }
}

async function sincronizar() {
  if (desistiu) return;
  const t = tokenDaSala();
  if (!t) { desistiu = true; return; }
  try {
    const r = await fetch(`${API}?t=${encodeURIComponent(t)}`);
    if (r.status === 401) { desistiu = true; return; }   // token vencido: até recarregar
    if (!r.ok) return;
    const { wa_status } = await r.json();
    if (ultimo === null && wa_status === "ONLINE") { ultimo = wa_status; return; }
    if (wa_status !== ultimo) { WA.player.setStatus(wa_status); ultimo = wa_status; }
  } catch (_) { /* rede: tenta no próximo ciclo */ }
}

WA.onInit().then(() => {
  sincronizar();
  setInterval(sincronizar, INTERVALO);
});
