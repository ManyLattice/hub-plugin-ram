// Память по агентам: процесс плагина (main.py) снимает ps, страница рисует вид «Память» и метку у сессии.
const POLL_MS = 5000;

let hub = null, data = null, timer = null;
const listeners = new Set();

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

function block(title, entries, max, total) {
  const el = hub.el;
  const box = el("div", "ram-block");
  box.append(el("h3", "ram-title", `${title} · ${mb(total)}`));
  for (const [name, v] of entries) {
    const row = el("details", "ram-row");
    const head = el("summary", "ram-head");
    const bar = el("span", "ram-bar");
    bar.style.width = `${Math.max(2, (v.kb / max) * 100)}%`;
    head.append(el("span", "ram-name", name), el("span", "ram-val", mb(v.kb)), el("span", "ram-track"));
    head.lastChild.append(bar);
    row.append(head);
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
    block("Сессии", sort(g.sessions), max, sum(g.sessions)),
    block("Браузер", sort(g.browsers), max, sum(g.browsers)),
    block("Хаб и плагины", sort(g.hub), max, sum(g.hub)),
  );
}

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
  hub.addSlot("sidebar.session", {
    id: "ram-badge", order: 90,
    render(root, snap, ctx) {
      const v = data?.groups?.sessions?.[ctx.session.name];
      root.textContent = v ? mb(v.kb) : "";
      root.className = "ram-badge";
      if (!root._ram) { root._ram = true; listeners.add(() => { const w = data?.groups?.sessions?.[root._name]; if (w) root.textContent = mb(w.kb); }); }
      root._name = ctx.session.name;
    },
  });
}
