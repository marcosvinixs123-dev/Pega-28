import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const app = document.getElementById("app");
const $ = (id) => document.getElementById(id);
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOGO = `<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#16324f"/><circle cx="256" cy="256" r="170" fill="none" stroke="#f2c230" stroke-width="14" stroke-dasharray="30 22"/><path d="M256 150c-40 0-70 30-70 68 0 52 70 130 70 130s70-78 70-130c0-38-30-68-70-68z" fill="#e8483b"/><circle cx="256" cy="216" r="26" fill="#eef3ee"/></svg>`;
const COR = { cacador: "#e8483b", fugitivo: "#2a6fdb" };
const NOME_EQ = { cacador: "Caçador", fugitivo: "Fugitivo" };

let db, canal = null, gameId = null, meuId = null, S = null, off = 0, loopA = null, loopT = null;
let mapa = null, camadas = {}, pos = null, gpsErro = "", watchId = null, wake = null, telaAtual = "", ultimoHtml = "", capAberto = false, busy = false;

const agora = () => Date.now() + off;
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const metros = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

// ---------- base de telas ----------
function tela(html, nome = "") {
  if (nome && nome === telaAtual && html === ultimoHtml) return false;
  if (mapa) { mapa.remove(); mapa = null; camadas = {}; }
  app.innerHTML = html; telaAtual = nome; ultimoHtml = html;
  return true;
}

function telaInicial(erro = "") {
  tela(`
    <div class="logo">${LOGO}<h1>pega<span class="ponto">28</span></h1>
    <p class="suave">Esconde-esconde na vida real, com mapa e GPS. Grátis.</p></div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
    <div class="acoes"><button id="criar">Criar partida</button><button id="entrar" class="sec">Entrar na partida</button></div>
    <p class="aviso">Mantenha o app aberto e a tela ligada durante a partida.</p>`);
  $("criar").onclick = () => telaCriar();
  $("entrar").onclick = () => telaEntrar();
}

const CAMPOS = [
  ["total", "Duração da partida (min)", 30], ["vantagem", "Tempo para se esconder (min)", 3],
  ["ping", "Intervalo entre pings (min)", 2], ["raio", "Raio inicial da zona (m)", 500],
  ["encolhe_cada", "Zona diminui a cada (min)", 5], ["encolhe_pct", "Redução da zona (%)", 20],
  ["fora_revela", "Fora da zona: revelar após (s)", 30], ["fora_elimina", "Fora da zona: eliminar após (s)", 120],
  ["cacadores", "Caçadores (sorteio)", 1],
];

function telaCriar(erro = "") {
  tela(`
    <div class="topo"><button class="voltar" id="voltar" aria-label="Voltar">←</button><h2>Criar partida</h2></div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
    <label>Seu apelido<input id="apelido" maxlength="20" autocomplete="off" placeholder="Ex.: Mano"></label>
    <fieldset><legend>Regras</legend>
      ${CAMPOS.map(([k, t, v]) => `<label>${t}<input id="c_${k}" type="number" inputmode="numeric" min="1" value="${v}"></label>`).join("")}
    </fieldset>
    <p class="aviso">O centro da zona será o lugar onde o anfitrião estiver na hora de iniciar. Quem criar a sala deve estar no local do jogo.</p>
    <button id="ok">Criar e gerar código</button>`);
  $("voltar").onclick = () => telaInicial();
  $("ok").onclick = criarPartida;
}

function telaEntrar(erro = "", codigo = "", apelido = "") {
  tela(`
    <div class="topo"><button class="voltar" id="voltar" aria-label="Voltar">←</button><h2>Entrar na partida</h2></div>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ""}
    <label>Código da partida<input id="codigo" class="codigo" maxlength="6" autocomplete="off" autocapitalize="characters" value="${esc(codigo)}" placeholder="••••••"></label>
    <label>Seu apelido<input id="apelido" maxlength="20" autocomplete="off" value="${esc(apelido)}" placeholder="Ex.: Mano"></label>
    <button id="ok">Entrar</button>`);
  $("voltar").onclick = () => telaInicial();
  $("ok").onclick = entrarPartida;
}

function telaSala() {
  const host = S.host_id === meuId, ps = S.players;
  const nh = ps.filter((p) => p.team === "cacador").length, nf = ps.filter((p) => p.team === "fugitivo").length;
  const pronto = ps.every((p) => p.team) && nh >= 1 && nf >= 1;
  tela(`
    <div class="topo"><h2>Sala de espera</h2></div>
    <div class="codigo-grande"><span class="suave">Código da partida</span><strong>${esc(S.code)}</strong>
      <button class="sec" data-a="compartilhar">Compartilhar código</button></div>
    <h2 style="font-size:1.2rem">Jogadores (${ps.length}) · Caçadores ${nh} · Fugitivos ${nf}</h2>
    <ul class="lista">${ps.map((p) => `<li class="${p.team === "cacador" ? "c" : p.team === "fugitivo" ? "f" : ""}">
      <span class="nome">${esc(p.nickname)}${p.user_id === meuId ? " (você)" : ""}<span class="tag">${p.user_id === S.host_id ? "anfitrião" : ""}</span></span>
      ${host ? `<span class="eq"><button class="c ${p.team === "cacador" ? "on" : ""}" data-a="team" data-p="${p.id}" data-t="cacador">Caçador</button><button class="f ${p.team === "fugitivo" ? "on" : ""}" data-a="team" data-p="${p.id}" data-t="fugitivo">Fugitivo</button></span>`
        : `<span class="tag">${p.team ? NOME_EQ[p.team] : "sem equipe"}</span>`}</li>`).join("")}</ul>
    ${host ? `<button class="sec" data-a="sortear">Sortear equipes</button>
      <p class="${pronto ? "ok" : "aviso"}">${pronto ? "Tudo pronto. Vá para o local do jogo e toque em Iniciar." : "Defina a equipe de todos (pelo menos 1 caçador e 1 fugitivo)."}</p>
      <button data-a="iniciar" ${pronto ? "" : "disabled"}>Iniciar partida</button>`
      : `<p class="aviso">Aguardando o anfitrião definir as equipes e iniciar.</p>`}
    <button class="perigo" data-a="sair">Sair da sala</button>`, "sala");
}

function telaResultado() {
  const v = S.winner === "cacadores";
  tela(`
    <div class="vencedor ${v ? "c" : "f"}">${v ? "Os caçadores venceram!" : "Os fugitivos venceram!"}</div>
    <p class="suave">${v ? "Todos os fugitivos foram capturados ou eliminados." : "Pelo menos um fugitivo sobreviveu até o fim."}</p>
    <ul class="lista">${S.players.map((p) => `<li class="${p.team === "cacador" ? "c" : "f"} ${p.status !== "vivo" ? "fora" : ""}"><span>${esc(p.nickname)}</span><span class="tag">${NOME_EQ[p.team] || ""} · ${p.status}</span></li>`).join("")}</ul>
    <p class="aviso">As localizações desta partida já foram apagadas.</p>
    <button data-a="sair">Jogar novamente</button>`, "resultado");
}

// ---------- tela da partida ----------
function montarJogo() {
  tela(`
    <div class="hud"><div><span class="suave" id="fase"></span><strong id="rel">--:--</strong></div><div class="info" id="info"></div></div>
    <div id="mapa"></div><div id="avisos"></div><div id="botoes"></div>`, "jogo");
  mapa = L.map("mapa").setView([S.center.lat, S.center.lng], 16);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa);
  camadas.zona = L.circle([S.center.lat, S.center.lng], { radius: S.radius, color: "#f2c230", weight: 3, fillOpacity: 0.05 }).addTo(mapa);
  camadas.pts = L.layerGroup().addTo(mapa);
  mapa.fitBounds(camadas.zona.getBounds());
}

const nomeDe = (uid) => (S.players.find((p) => p.user_id === uid) || {}).nickname || "?";

function desenharMapa() {
  camadas.zona.setRadius(S.radius);
  camadas.pts.clearLayers();
  const por = {};
  S.visible.forEach((v) => { if (!por[v.user_id] || v.kind === "ao_vivo") por[v.user_id] = v; });
  Object.values(por).forEach((v) => {
    const eq = S.players.find((p) => p.user_id === v.user_id)?.team || "fugitivo", cor = COR[eq], ping = v.kind === "ping";
    const rot = nomeDe(v.user_id) + (ping ? ` (ping ${Math.round((agora() - Date.parse(v.at)) / 1000)}s)` : v.kind === "ao_vivo" ? " (ao vivo)" : "");
    L.circleMarker([v.lat, v.lng], { radius: ping ? 10 : 8, color: cor, fillColor: cor, fillOpacity: ping ? 0.15 : 0.9, weight: 3 })
      .bindTooltip(rot, { permanent: true, direction: "top" }).addTo(camadas.pts);
  });
  if (pos) L.circleMarker([pos.lat, pos.lng], { radius: 9, color: "#fff", weight: 3, fillColor: COR[S.me.team], fillOpacity: 1 })
    .bindTooltip("Você", { permanent: true, direction: "top" }).addTo(camadas.pts);
}

function pintarTempos() {
  const st = S.settings, a = agora(), t0 = Date.parse(S.started_at), hideEnd = t0 + st.vantagem * 60000, fim = Date.parse(S.ends_at);
  const esconde = a < hideEnd, eu = S.me, mim = eu.team === "fugitivo";
  const prox = (passo) => hideEnd + (esconde ? 1 : Math.floor((a - hideEnd) / passo) + 1) * passo;
  const livres = S.players.filter((p) => p.team === "fugitivo" && p.status === "vivo").length;
  $("fase").textContent = esconde ? "Fugitivos se escondendo" : "Partida em andamento";
  $("rel").textContent = fmt((esconde ? hideEnd : fim) - a);
  $("info").innerHTML = `Próximo ping <b>${fmt(prox(st.ping * 60000) - a)}</b><br>Zona diminui em <b>${fmt(prox(st.encolhe_cada * 60000) - a)}</b><br>Raio <b>${Math.round(S.radius)} m</b><br>Fugitivos livres <b>${livres}</b>`;
  const av = [];
  if (eu.status !== "vivo") av.push(["aviso", eu.status === "capturado" ? "Você foi capturado. Acompanhe pela tela." : "Você foi eliminado. Acompanhe pela tela."]);
  else {
    if (esconde) av.push(["aviso", mim ? "Esconda-se! Depois do tempo, os caçadores recebem pings da sua posição." : "Aguarde: os fugitivos estão se escondendo."]);
    if (mim && S.my_out_since) {
      const s = (a - Date.parse(S.my_out_since)) / 1000;
      av.push(["erro", s < st.fora_revela ? `Fora da zona! Volte em ${Math.ceil(st.fora_revela - s)} s ou sua posição será revelada.` : `Posição revelada aos caçadores! Eliminação em ${Math.max(0, Math.ceil(st.fora_elimina - s))} s.`]);
    } else if (pos && !esconde && metros(pos.lat, pos.lng, S.center.lat, S.center.lng) > S.radius) av.push(["aviso", "Você está fora da zona do jogo."]);
  }
  if (gpsErro) av.push(["erro", "Sem GPS: permita a localização no navegador. (" + gpsErro + ")"]);
  else if (!pos) av.push(["aviso", "Procurando sinal de GPS…"]);
  const h = av.map(([c, t]) => `<p class="${c}">${esc(t)}</p>`).join("");
  if ($("avisos").dataset.h !== h) { $("avisos").innerHTML = h; $("avisos").dataset.h = h; }
}

function pintarBotoes() {
  const eu = S.me, host = S.host_id === meuId; let h = "";
  S.captures.forEach((c) => {
    if (c.target_id === meuId) h += `<p class="erro">${esc(c.hunter_nick)} diz que capturou você.</p><div class="linha2"><button data-a="resp" data-id="${c.id}" data-ok="1">Confirmar</button><button class="sec" data-a="resp" data-id="${c.id}" data-ok="0">Negar</button></div>`;
    else if (host) h += `<p class="aviso">Validar: ${esc(c.hunter_nick)} capturou ${esc(c.target_nick)}?</p><div class="linha2"><button data-a="resp" data-id="${c.id}" data-ok="1">Sim</button><button class="sec" data-a="resp" data-id="${c.id}" data-ok="0">Não</button></div>`;
    else if (c.hunter_id === meuId) h += `<p class="aviso">Aguardando ${esc(c.target_nick)} confirmar a captura…</p>`;
  });
  if (eu.team === "cacador" && eu.status === "vivo") {
    const alvos = S.players.filter((p) => p.team === "fugitivo" && p.status === "vivo");
    h += capAberto ? `<p class="suave">Quem você capturou?</p>${alvos.map((p) => `<button class="fug" data-a="cap" data-u="${p.user_id}">${esc(p.nickname)}</button>`).join("")}<button class="sec" data-a="capfechar">Cancelar</button>`
      : `<button class="cac" data-a="capabrir">Capturei um fugitivo</button>`;
  }
  h += `<button class="sec" data-a="centrar">Centralizar mapa</button>`;
  if ($("botoes").dataset.h !== h) { $("botoes").innerHTML = h; $("botoes").dataset.h = h; }
}

function desenhar() {
  if (S.status === "lobby") { pararGps(); return telaSala(); }
  if (S.status === "finished") { pararGps(); return telaResultado(); }
  iniciarGps();
  if (telaAtual !== "jogo") montarJogo();
  desenharMapa(); pintarTempos(); pintarBotoes();
}

// ---------- GPS ----------
function iniciarGps() {
  if (watchId !== null) return;
  if (!navigator.geolocation) { gpsErro = "este navegador não tem GPS"; return; }
  watchId = navigator.geolocation.watchPosition(
    (p) => { pos = { lat: p.coords.latitude, lng: p.coords.longitude }; gpsErro = ""; },
    (e) => { gpsErro = e.message || "erro"; },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  try { navigator.wakeLock?.request("screen").then((w) => (wake = w)).catch(() => {}); } catch {}
}
function pararGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; try { wake?.release(); } catch {} wake = null;
}

// ---------- servidor ----------
async function atualizar() {
  if (!gameId || busy) return; busy = true;
  try {
    if (pos && S && S.status === "running" && S.me.status === "vivo") await db.rpc("send_position", { p_gid: gameId, p_lat: pos.lat, p_lng: pos.lng });
    const r = await db.rpc("snapshot", { p_gid: gameId });
    if (r.error) {
      const m = r.error.message;
      if (!S || /não está/.test(m)) { sairLocal(); telaInicial("Erro ao abrir a sala: " + m); }
      return;
    }
    S = r.data; off = Date.parse(S.now) - Date.now(); desenhar();
  } finally { busy = false; }
}

async function abrirSala(id) {
  gameId = id; localStorage.setItem("pega28_jogo", id); S = null;
  if (canal) db.removeChannel(canal);
  canal = db.channel("jogo-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${id}` }, atualizar)
    .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${id}` }, atualizar)
    .subscribe();
  clearInterval(loopA); clearInterval(loopT);
  loopA = setInterval(atualizar, 3000);
  loopT = setInterval(() => { if (S && telaAtual === "jogo") pintarTempos(); }, 1000);
  await atualizar();
}

function sairLocal() {
  if (canal) db.removeChannel(canal);
  canal = null; clearInterval(loopA); clearInterval(loopT); pararGps();
  gameId = null; S = null; pos = null; capAberto = false;
  localStorage.removeItem("pega28_jogo"); telaAtual = ""; telaInicial();
}

async function criarPartida() {
  const apelido = $("apelido").value.trim();
  if (!apelido) return telaCriar("Digite um apelido.");
  const settings = Object.fromEntries(CAMPOS.map(([k]) => [k, Math.max(1, parseInt($("c_" + k).value, 10) || 1)]));
  settings.encolhe_pct = Math.min(settings.encolhe_pct, 90);
  let g = null;
  for (let i = 0; i < 6 && !g; i++) {
    const code = Array.from({ length: 6 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join("");
    const r = await db.from("games").insert({ code, settings }).select().single();
    if (!r.error) g = r.data; else if (r.error.code !== "23505") return telaCriar("Erro ao criar: " + r.error.message);
  }
  if (!g) return telaCriar("Não consegui gerar um código. Tente de novo.");
  const p = await db.from("players").insert({ game_id: g.id, nickname: apelido });
  if (p.error) return telaCriar("Erro ao entrar na sala: " + p.error.message);
  await abrirSala(g.id);
}

async function entrarPartida() {
  const codigo = $("codigo").value.trim().toUpperCase(), apelido = $("apelido").value.trim();
  if (codigo.length !== 6) return telaEntrar("O código tem 6 caracteres.", codigo, apelido);
  if (!apelido) return telaEntrar("Digite um apelido.", codigo, apelido);
  const r = await db.rpc("join_game", { p_code: codigo, p_nick: apelido });
  if (r.error) return telaEntrar(r.error.message, codigo, apelido);
  await abrirSala(r.data);
}

// ---------- cliques das telas novas ----------
const ACOES = {
  async compartilhar() {
    const t = `Entra no pega28! Código: ${S.code}\n${location.origin}${location.pathname}`;
    try { navigator.share ? await navigator.share({ text: t }) : (await navigator.clipboard.writeText(t), alert("Copiado!")); } catch {}
  },
  async team(d) { const r = await db.rpc("set_team", { p_pid: d.p, p_team: d.t }); if (r.error) alert(r.error.message); atualizar(); },
  async sortear() { const r = await db.rpc("random_teams", { p_gid: gameId }); if (r.error) alert(r.error.message); atualizar(); },
  iniciar() {
    if (!navigator.geolocation) return alert("Este navegador não tem GPS.");
    navigator.geolocation.getCurrentPosition(async (p) => {
      const r = await db.rpc("start_game", { p_gid: gameId, p_lat: p.coords.latitude, p_lng: p.coords.longitude });
      if (r.error) alert(r.error.message);
      atualizar();
    }, () => alert("Ative o GPS e permita a localização para iniciar."), { enableHighAccuracy: true, timeout: 15000 });
  },
  async sair() { if (S && S.status === "lobby") await db.from("players").delete().eq("game_id", gameId).eq("user_id", meuId); sairLocal(); },
  capabrir() { capAberto = true; pintarBotoes(); }, capfechar() { capAberto = false; pintarBotoes(); },
  async cap(d) { capAberto = false; const r = await db.rpc("request_capture", { p_gid: gameId, p_target: d.u }); if (r.error) alert(r.error.message); atualizar(); },
  async resp(d) { const r = await db.rpc("answer_capture", { p_id: d.id, p_accept: d.ok === "1" }); if (r.error) alert(r.error.message); atualizar(); },
  centrar() { if (mapa) mapa.fitBounds(camadas.zona.getBounds()); },
};
app.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b && ACOES[b.dataset.a]) ACOES[b.dataset.a](b.dataset); });

// ---------- início ----------
async function iniciar() {
  if (SUPABASE_URL.startsWith("COLE_") || SUPABASE_ANON_KEY.startsWith("COLE_")) return tela(`<h2>Falta configurar</h2><p class="erro">Abra o arquivo config.js e cole a URL e a chave do seu Supabase.</p>`);
  db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let { data: { session } } = await db.auth.getSession();
  if (!session) {
    const r = await db.auth.signInAnonymously();
    if (r.error) return tela(`<h2>Erro de conexão</h2><p class="erro">${esc(r.error.message)}</p><p class="suave">Confira se "Allow anonymous sign-ins" está ligado no Supabase.</p>`);
    session = r.data.session;
  }
  meuId = session.user.id;
  const salvo = localStorage.getItem("pega28_jogo");
  if (salvo) {
    const r = await db.rpc("snapshot", { p_gid: salvo });
    if (!r.error) return abrirSala(salvo);
    localStorage.removeItem("pega28_jogo");
  }
  telaInicial();
}
iniciar();
