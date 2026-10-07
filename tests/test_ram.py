import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ram

PS = """\
 10 1 100 /x/bin/hub-up
 11 10 50 /x/bin/hubd
 12 11 300 /home/.local/bin/claude -p --verbose -n alpha --settings s
 13 12 70 node mcp-server.js
 14 11 200 /home/.local/bin/claude -p --verbose -n beta
 15 10 40 python3 /x/web/server.py
 16 10 30 python3 main.py
 20 1 400 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9223
 21 20 90 /Applications/Google Chrome.app/x/Google Chrome Helper (Renderer) --type=renderer
"""


class RamTest(unittest.TestCase):
    def test_groups(self):
        g = ram.measure(ram.parse(PS), cwds={16: "/ext/ram"})
        self.assertEqual(g["sessions"]["alpha"]["kb"], 370)
        self.assertEqual(g["sessions"]["beta"]["kb"], 200)
        self.assertEqual(g["browsers"]["Chrome :9223"]["kb"], 490)
        self.assertEqual(g["hub"]["ram"]["kb"], 30)
        self.assertEqual(g["hub"]["hub-up"]["kb"], 100)

    def test_no_double_count(self):
        g = ram.measure(ram.parse(PS))
        total = sum(v["kb"] for grp in g.values() for v in grp.values())
        self.assertEqual(total, 100 + 50 + 300 + 70 + 200 + 40 + 30 + 400 + 90)


if __name__ == "__main__":
    unittest.main()
