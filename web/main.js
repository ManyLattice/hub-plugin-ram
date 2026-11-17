// Memory by agent: the plugin process (main.py) takes ps, the page draws the "Memory" view and a badge at the session. A
// session in the view can free its memory: "Restart" (the process anew with the same conversation — with MCP and
// children), "Compact" (/compact) and, for executors and workers, "Put to sleep". The actions go from the owner through
// the hub page (hub.post) when the session is free; for a busy one the core does it after the turn.
const POLL_MS = 5000;
// the page language (hub.lang, Plugin API 1.25): Russian for ru, English otherwise (and on cores without hub.lang)
const RU = () => hub?.lang === "ru";
const tr = (en, ru) => (RU() ? ru : en);

let hub = null, data = null, timer = null, asking = null;
const listeners = new Set();
const opened = new Set();   // opened rows: the redraw every 5 s does not close them
const said = new Map();     // session -> what the hub answered to an action (shown until it changes)

const port = () => Number(location.port || 80) + 10;
const mb = (kb) => (kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} ${tr("GB", "ГБ")}` : `${Math.round(kb / 1024)} ${tr("MB", "МБ")}`);

async function poll() {
  try {
    const r = await fetch(`http://${location.hostname}:${port()}/`);
    data = await r.json();
  } catch { data = null; }
  listeners.forEach((f) => f());
}
function start() { if (!timer) { poll(); timer = setInterval(poll, POLL_MS); } }

const RESTING = ["asleep", "closed", "failed", "removed"];
const ACTIONS = () => [
  { id: "reload", label: tr("Restart", "Перезапустить"), yes: tr("Yes, restart", "Да, перезапустить"),
    path: "/api/session/reload",
    ask: tr("Restart the process? The conversation stays, MCP servers and background commands start anew.",
      "Перезапустить процесс? Разговор сохранится, MCP-серверы и фоновые команды запустятся заново.") },
  { id: "compact", label: tr("Compact", "Сжать"), yes: tr("Yes, compact", "Да, сжать"), path: "/api/session/compact",
    ask: tr("Compact the conversation (/compact)? The session forgets the details, a short summary stays.",
      "Сжать разговор (/compact)? Сессия забудет подробности, останется краткий пересказ.") },
  { id: "sleep", label: tr("Put to sleep", "Усыпить"), yes: tr("Yes, put to sleep", "Да, усыпить"),
    path: "/api/session/close", danger: true,
    ask: tr("Put it to sleep? It hands in its work and falls asleep, its memory is freed completely. Wake it with a message or in the list.",
      "Усыпить? Она сдаст дела и уснёт, память освободится целиком. Разбудить — сообщением или в списке.") },
];

// buttons at a session: confirmation in place, with a second press; a busy one — after the turn (the core waits by itself)
function actions(name) {
  const el = hub.el;
  const s = (hub.snapshot()?.sessions || []).find((x) => x.name === name);
  const bar = el("div", "ram-acts");
  if (!s || RESTING.includes(s.state)) return bar;
  const busy = ["busy", "dialog", "starting"].includes(s.state);
  for (const a of ACTIONS()) {
    if (a.id === "sleep" && (s.kind === "hub" || s.role === "agent")) continue;   // the hub and agents stay on duty
    const key = `${name}:${a.id}`;
    const b = el("button", `btn small${a.danger ? " danger" : " quiet"}`, asking === key ? a.yes : a.label);
    b.type = "button";
    b.title = asking === key ? a.ask : `${a.label}${busy ? tr(" — after the turn: the session is busy now", " — после хода: сейчас сессия занята") : ""}`;
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      if (asking !== key) { asking = key; listeners.forEach((f) => f()); return; }
      asking = null;
      const r = await hub.post(a.path, { session: name });
      said.set(name, r.error || (busy ? tr(`${a.label}: after the current turn`, `${a.label}: после текущего хода`) : tr(`${a.label}: accepted`, `${a.label}: принято`)));
      listeners.forEach((f) => f());
    });
    bar.append(b);
  }
  if (asking?.startsWith(`${name}:`)) {
    const no = el("button", "btn small quiet", tr("Cancel", "Отмена"));
    no.type = "button";
    no.addEventListener("click", (e) => { e.preventDefault(); asking = null; listeners.forEach((f) => f()); });
    const a = ACTIONS().find((x) => asking === `${name}:${x.id}`);
    bar.append(no, el("span", "ram-note", a?.ask || ""));
  } else if (busy) bar.append(el("span", "ram-note", tr("busy — it will be done after the turn", "занята — сделается после хода")));
  if (said.has(name)) bar.append(el("span", "ram-note", said.get(name)));
  return bar;
}

function block(title, entries, max, total, sessions) {
  const el = hub.el;
  const box = el("div", "ram-block");
  box.append(el("h3", "ram-title", `${title} · ${mb(total)}`));
  for (const [name, v] of entries) {
    const row = el("details", "ram-row");
    const key = `${title}:${name}`;
    row.open = opened.has(key);
    row.addEventListener("toggle", () => (row.open ? opened.add(key) : opened.delete(key)));
    const head = el("summary", "ram-head");
    const bar = el("span", "ram-bar");
    bar.style.width = `${Math.max(2, (v.kb / max) * 100)}%`;
    head.append(el("span", "ram-name", name), el("span", "ram-val", mb(v.kb)), el("span", "ram-track"));
    head.lastChild.append(bar);
    row.append(head);
    if (sessions) row.append(actions(name));
    for (const [lab, kb] of v.procs) row.append(el("div", "ram-proc", `${lab}  ${mb(kb)}`));
    box.append(row);
  }
  return box;
}

function render(root) {
  const el = hub.el;
  if (!data || !data.groups) {
    root.replaceChildren(el("p", null, tr("The plugin process does not answer: check that the ext is running (hub restart ext:ram).",
      "Процесс плагина не отвечает: проверьте, что ext запущен (hub restart ext:ram).")));
    return;
  }
  const g = data.groups, sum = (o) => Object.values(o).reduce((a, v) => a + v.kb, 0);
  const sort = (o) => Object.entries(o).sort((a, b) => b[1].kb - a[1].kb);
  const all = [...Object.values(g.sessions), ...Object.values(g.browsers), ...Object.values(g.hub)];
  const max = Math.max(1, ...all.map((v) => v.kb));
  root.replaceChildren(
    el("p", "ram-sum", tr(`Total ${mb(sum(g.sessions) + sum(g.browsers) + sum(g.hub))} (RSS: shared pages count in each process). Updated every ${Math.round(POLL_MS / 1000)} s.`,
      `Всего ${mb(sum(g.sessions) + sum(g.browsers) + sum(g.hub))} (RSS: общие страницы считаются у каждого процесса). Обновляется раз в ${Math.round(POLL_MS / 1000)} с.`)),
    el("p", "ram-sum", tr("Open a session to free its memory: restart it, compact the conversation or put it to sleep.",
      "Раскройте сессию, чтобы освободить её память: перезапустить, сжать разговор или усыпить.")),
    block(tr("Sessions", "Сессии"), sort(g.sessions), max, sum(g.sessions), true),
    block(tr("Browser", "Браузер"), sort(g.browsers), max, sum(g.browsers)),
    block(tr("Hub and plugins", "Хаб и плагины"), sort(g.hub), max, sum(g.hub)),
  );
}

const BADGE_KB = 250 * 1024;   // the badge in the list — from 250 MB
const short = (kb) => (kb >= 1024 * 1024 ? (RU() ? `${(kb / 1048576).toFixed(1).replace(".", ",")}Г` : `${(kb / 1048576).toFixed(1)}G`)
  : `${Math.round(kb / 1024)}${tr("M", "М")}`);

export default function register(h) {
  hub = h;
  hub.addStyle("web/ram.css");
  start();
  hub.addView({
    id: "ram", title: tr("Memory", "Память"), subtitle: tr("who eats how much", "кто сколько ест"), icon: "icon.svg",
    render(root) { root.classList.add("ram"); render(root); },
    show(root) { const f = () => render(root); listeners.add(f); root._ramf = f; render(root); },
    hide(root) { listeners.delete(root._ramf); },
  });
  // the badge in the session list — short and only at heavy ones: the list row is narrow, the session name matters more ("hu… 330 MB")
  const badge = (root) => {
    const w = data?.groups?.sessions?.[root._name];
    const heavy = w && w.kb >= BADGE_KB;
    root.textContent = heavy ? short(w.kb) : "";
    root.title = w ? tr(`Memory: ${mb(w.kb)}`, `Память: ${mb(w.kb)}`) : "";
    root.hidden = !heavy;
  };
  hub.addSlot("sidebar.session", {
    id: "ram-badge", order: 90,
    render(root, snap, ctx) {
      root.className = "ram-badge";
      root._name = ctx.session.name;
      if (!root._ram) { root._ram = true; listeners.add(() => badge(root)); }
      badge(root);
    },
  });
}
