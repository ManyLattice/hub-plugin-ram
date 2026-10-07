// Память по агентам: процесс плагина (main.py) снимает ps, страница рисует вид «Память» и метку у сессии. У сессии в
// виде — освободить память: «Перезапустить» (процесс заново с тем же разговором — с MCP и детьми), «Сжать» (/compact)
// и у исполнителей и работяг — «Усыпить». Действия идут от владельца через страницу хаба (hub.post), когда сессия
// свободна; занятой ядро сделает это после хода.
const POLL_MS = 5000;

let hub = null, data = null, timer = null, asking = null;
const listeners = new Set();
const opened = new Set();   // раскрытые строки: перерисовка раз в 5 с их не закрывает
const said = new Map();     // сессия -> что ответил хаб на действие (показать, пока не сменится)

const port = () => Number(location.port || 80) + 10;
const mb = (kb) => (kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} ГБ` : `${Math.round(kb / 1024)} МБ`);

async function poll() {
  try {
    const r = await fetch(`http://${location.hostname}:${port()}/`);
    data = await r.json();
  } catch { data = null; }
  listeners.forEach((f) => f());
}
function start() { if (!timer) { poll(); timer = setInterval(poll, POLL_MS); } }

const RESTING = ["asleep", "closed", "failed", "removed"];
const ACTIONS = [
  { id: "reload", label: "Перезапустить", path: "/api/session/reload",
    ask: "Перезапустить процесс? Разговор сохранится, MCP-серверы и фоновые команды запустятся заново." },
  { id: "compact", label: "Сжать", path: "/api/session/compact",
    ask: "Сжать разговор (/compact)? Сессия забудет подробности, останется краткий пересказ." },
  { id: "sleep", label: "Усыпить", path: "/api/session/close", danger: true,
    ask: "Усыпить? Она сдаст дела и уснёт, память освободится целиком. Разбудить — сообщением или в списке." },
];

// кнопки у сессии: подтверждение — на месте, вторым нажатием; занятая — после хода (ядро дождётся само)
function actions(name) {
  const el = hub.el;
  const s = (hub.snapshot()?.sessions || []).find((x) => x.name === name);
  const bar = el("div", "ram-acts");
  if (!s || RESTING.includes(s.state)) return bar;
  const busy = ["busy", "dialog", "starting"].includes(s.state);
  for (const a of ACTIONS) {
    if (a.id === "sleep" && (s.kind === "hub" || s.role === "agent")) continue;   // хаб и агенты на посту
    const key = `${name}:${a.id}`;
    const b = el("button", `btn small${a.danger ? " danger" : " quiet"}`, asking === key ? `Да, ${a.label.toLowerCase()}` : a.label);
    b.type = "button";
    b.title = asking === key ? a.ask : `${a.label}${busy ? " — после хода: сейчас сессия занята" : ""}`;
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      if (asking !== key) { asking = key; listeners.forEach((f) => f()); return; }
      asking = null;
      const r = await hub.post(a.path, { session: name });
      said.set(name, r.error || (busy ? `${a.label}: после текущего хода` : `${a.label}: принято`));
      listeners.forEach((f) => f());
    });
    bar.append(b);
  }
  if (asking?.startsWith(`${name}:`)) {
    const no = el("button", "btn small quiet", "Отмена");
    no.type = "button";
    no.addEventListener("click", (e) => { e.preventDefault(); asking = null; listeners.forEach((f) => f()); });
    const a = ACTIONS.find((x) => asking === `${name}:${x.id}`);
    bar.append(no, el("span", "ram-note", a?.ask || ""));
  } else if (busy) bar.append(el("span", "ram-note", "занята — сделается после хода"));
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
    root.replaceChildren(el("p", null, "Процесс плагина не отвечает: проверьте, что ext запущен (hub restart ext:ram)."));
    return;
  }
  const g = data.groups, sum = (o) => Object.values(o).reduce((a, v) => a + v.kb, 0);
  const sort = (o) => Object.entries(o).sort((a, b) => b[1].kb - a[1].kb);
  const all = [...Object.values(g.sessions), ...Object.values(g.browsers), ...Object.values(g.hub)];
  const max = Math.max(1, ...all.map((v) => v.kb));
  root.replaceChildren(
    el("p", "ram-sum", `Всего ${mb(sum(g.sessions) + sum(g.browsers) + sum(g.hub))} (RSS: общие страницы считаются у каждого процесса). Обновляется раз в ${Math.round(POLL_MS / 1000)} с.`),
    el("p", "ram-sum", "Раскройте сессию, чтобы освободить её память: перезапустить, сжать разговор или усыпить."),
    block("Сессии", sort(g.sessions), max, sum(g.sessions), true),
    block("Браузер", sort(g.browsers), max, sum(g.browsers)),
    block("Хаб и плагины", sort(g.hub), max, sum(g.hub)),
  );
}

const BADGE_KB = 250 * 1024;   // метка в списке — от 250 МБ
const short = (kb) => (kb >= 1024 * 1024 ? `${(kb / 1048576).toFixed(1).replace(".", ",")}Г` : `${Math.round(kb / 1024)}М`);

export default function register(h) {
  hub = h;
  hub.addStyle("web/ram.css");
  start();
  hub.addView({
    id: "ram", title: "Память", subtitle: "кто сколько ест", icon: "icon.svg",
    render(root) { root.classList.add("ram"); render(root); },
    show(root) { const f = () => render(root); listeners.add(f); root._ramf = f; render(root); },
    hide(root) { listeners.delete(root._ramf); },
  });
  // метка в списке сессий — коротко и только у тяжёлых: строка списка узкая, имя сессии важнее (07.10: «hu… 330 МБ»)
  const badge = (root) => {
    const w = data?.groups?.sessions?.[root._name];
    const heavy = w && w.kb >= BADGE_KB;
    root.textContent = heavy ? short(w.kb) : "";
    root.title = w ? `Память: ${mb(w.kb)}` : "";
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
