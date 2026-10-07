"""Сколько оперативной памяти ест каждая сессия хаба: её claude и все дети (MCP, фоновые команды, сборки)."""
import os
import re
import subprocess

NAME_RE = re.compile(r"(?:^|\s)-n\s+(\S+)")


def parse(text):
    """Вывод `ps -axo pid=,ppid=,rss=,command=` -> {pid: (ppid, rss_kb, command)}."""
    procs = {}
    for line in text.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4 or not all(p.isdigit() for p in parts[:3]):
            continue
        procs[int(parts[0])] = (int(parts[1]), int(parts[2]), parts[3])
    return procs


def children_map(procs):
    kids = {}
    for pid, (ppid, _, _) in procs.items():
        kids.setdefault(ppid, []).append(pid)
    return kids


def subtree(root, kids):
    out, stack = [], [root]
    while stack:
        pid = stack.pop()
        out.append(pid)
        stack.extend(kids.get(pid, []))
    return out


def label(cmd, cwd=""):
    """Короткое имя процесса для разбивки."""
    words = cmd.split()
    if "Google Chrome" in cmd:
        m = re.search(r"--type=(\S+)", cmd)
        kind = m.group(1) if m else "browser"
        return "Chrome " + kind
    exe = os.path.basename(words[0]) if words else cmd
    script = next((os.path.basename(w) for w in words[1:] if not w.startswith("-")), "")
    if exe in ("npm", "npx") and len(words) > 2 and words[1] == "exec":
        return words[2]
    if exe.lower().startswith(("python", "node", "npm")) and script and script.isprintable() and script[0] != "\\":
        if script in ("main.py", "main.js") and cwd:
            return os.path.basename(cwd.rstrip("/")) or script
        return script
    return exe


def measure(procs, is_session_root=None, cwds=None):
    """Разложить процессы по владельцам.

    -> {"sessions": {имя: {"kb", "procs": [(label, kb)]}}, "browsers": {...}, "hub": {...}}
    Сессия — claude с `-n <имя>`; браузер — процесс с --remote-debugging-port и его дети;
    остальное под hub-up — процессы хаба.
    """
    cwds = cwds or {}
    kids = children_map(procs)
    owner = {}
    groups = {"sessions": {}, "browsers": {}, "hub": {}}

    def claim(kind, name, root, whole=True):
        g = groups[kind].setdefault(name, {"kb": 0, "procs": []})
        for pid in subtree(root, kids) if whole else [root]:
            if pid in owner:
                continue
            owner[pid] = (kind, name)
            _, rss, cmd = procs[pid]
            g["kb"] += rss
            g["procs"].append((label(cmd, cwds.get(pid, "")), rss))

    for pid, (_, _, cmd) in sorted(procs.items()):
        if "/claude" in cmd.split(None, 1)[0] and " -p " in cmd + " ":
            m = NAME_RE.search(cmd)
            if m:
                claim("sessions", m.group(1), pid)
    for pid, (_, _, cmd) in sorted(procs.items()):
        if "Google Chrome" in cmd and "--remote-debugging-port=" in cmd and "--type=" not in cmd:
            port = re.search(r"--remote-debugging-port=(\d+)", cmd).group(1)
            claim("browsers", "Chrome (снимки)" if port == "0" else f"Chrome :{port}", pid)
    hubup = [p for p, (_, _, c) in procs.items() if c.endswith("bin/hub-up")]
    for root in hubup:
        for pid in subtree(root, kids):
            if pid not in owner:
                claim("hub", label(procs[pid][2], cwds.get(pid, "")), pid, whole=False)
    for g in groups.values():
        for v in g.values():
            agg = {}
            for lab, kb in v["procs"]:
                agg[lab] = agg.get(lab, 0) + kb
            v["procs"] = sorted(([k, n] for k, n in agg.items()), key=lambda x: -x[1])[:12]
    return groups


def needs_cwd(procs):
    return [p for p, (_, _, c) in procs.items() if re.search(r"\s(main\.py|main\.js)(\s|$)", c)]


def sample():
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,rss=,command="], capture_output=True, text=True, timeout=20).stdout
    procs = parse(out)
    cwds = {}
    pids = needs_cwd(procs)
    if pids:
        try:
            r = subprocess.run(["lsof", "-a", "-d", "cwd", "-Fn", "-p", ",".join(map(str, pids))],
                               capture_output=True, text=True, timeout=20).stdout
        except (OSError, subprocess.SubprocessError):
            r = ""
        pid = None
        for line in r.splitlines():
            if line.startswith("p"):
                pid = int(line[1:])
            elif line.startswith("n") and pid:
                cwds[pid] = line[1:]
    return measure(procs, cwds=cwds)
