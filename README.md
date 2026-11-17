# hub-plugin-ram

A plugin for [Agents Hub](https://github.com/flagman/agents-hub-core): how much memory each hub session eats - its
`claude` and all its child processes (MCP servers, background commands, builds), and apart from them the hub's browsers
and the processes of the hub itself with its plugins.

<img src="icon.png" width="256" alt="Memory">

- The "Memory" view in the sidebar: sessions, browsers and the hub from the largest down, each with what it is made of
  (`claude`, `chrome-devtools-mcp`, `node`…).
- Free a session's memory right there: open its row - "Restart" (the process anew with the same conversation, MCP
  servers and background commands too), "Compact" (compact the conversation) and, for executors and workers, "Put to
  sleep". Each asks for confirmation with a second press; a busy session does it after its turn. Needs a hub with the
  page actions `/api/session/reload` and `/api/session/compact`.
- A badge at the session in the list on the left - short ("330M", "1.2G"), only at the ones that take 250 MB or more;
  the exact number is in the tooltip.

## How it works

- `main.py` - a process next to the hub (`run`): every few seconds it takes `ps` (and `lsof` - the folder of plugin
  processes, to label them by name) and sums the memory by process trees: a session is the process
  `claude -p … -n <name>` and everything under it; a browser is Chrome with `--remote-debugging-port` and its processes;
  the rest under `hub-up` is the hub.
- It serves the snapshot to the hub page on `127.0.0.1:<page port + 10>`, only to it. Only short process labels (the
  name of the program or script) go to the page, not command lines: they may carry keys.
- `web/main.js` - the "Memory" view and the badge in the session list.

Works on macOS and Linux (`ps`, `lsof`).

## Tests

```
PYTHONPATH=<hub code folder>:. python3 -m unittest discover -s tests
```
