#!/usr/bin/env python3
"""Kestrel Token Radar screenshot rig.

Serves the built /output directory with an in-process ThreadingHTTPServer (never a background
shell job), drives the real /usr/bin/google-chrome through Playwright, captures four dossier
screenshots at 1400x900 JPEG, and fails loudly on any console error or any request that leaves
127.0.0.1. Usage: python3 tools/shoot.py <output_dir>
"""
import http.server
import os
import socket
import sys
import threading

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tr_out1")
SHOTS = os.path.join(OUT, "screenshots")
os.makedirs(SHOTS, exist_ok=True)

# ---------------------------------------------------------------- in-process server


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=OUT, **kw)

    def log_message(self, *a):  # keep the console clean
        pass


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = free_port()
server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
print(f"serving {OUT} at {BASE}")

# ---------------------------------------------------------------- capture

from playwright.sync_api import sync_playwright  # noqa: E402

console_errors = []
requests = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        args=["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
    )
    page = browser.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=1)
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    def shot(name, quality=94):
        page.screenshot(path=os.path.join(SHOTS, name), type="jpeg", quality=quality)
        print(f"{name} done")

    # ---- 01: the full board, drawer closed — cover shot, nothing obscured
    page.goto(f"{BASE}/dashboard/index.html", wait_until="load")
    page.wait_for_timeout(500)
    state = page.evaluate("() => ({drawer: document.getElementById('drawer').classList.contains('open'), kpis: document.querySelectorAll('.kpi').length, cols: Array.from(document.querySelectorAll('#bm thead th')).map(th => Math.round(th.getBoundingClientRect().right)), rows: document.querySelectorAll('#bm tbody tr').length})")
    if state["drawer"]:
        raise SystemExit("shot 01: the drawer must be closed for the cover")
    if state["kpis"] != 6 or len(state["cols"]) != 10 or max(state["cols"]) > 1380:
        raise SystemExit(f"shot 01: layout not fully visible: {state}")
    print(f"shot 01 state: drawer closed, {state['kpis']} KPI cards, {len(state['cols'])} columns, rightmost edge {max(state['cols'])}, {state['rows']} rows")
    shot("01-board-overview.jpg")

    # ---- 02: the rank-1 detail deep-dive — header KPIs, waterfall, band, gauge, farm plan
    page.click("#bm tbody tr:first-child")
    page.wait_for_timeout(500)
    state2 = page.evaluate("() => { const s = document.querySelectorAll('#drawer .plan li'); const r = s[1] && s[1].getBoundingClientRect(); return {open: document.getElementById('drawer').classList.contains('open'), title: document.querySelector('#drawer h2').textContent, step2Bottom: r ? Math.round(r.bottom) : 9999, kpis: document.querySelectorAll('#drawer .dk > div').length, wf: document.querySelectorAll('#drawer .wfrow').length}; }")
    if not state2["open"] or state2["kpis"] != 4 or state2["wf"] != 5 or state2["step2Bottom"] > 898:
        raise SystemExit(f"shot 02: drawer content not fully framed: {state2}")
    print(f"shot 02 state: {state2['title']} · {state2['kpis']} KPIs · 5 waterfall stages · step 02 ends at {state2['step2Bottom']}px")
    shot("02-protocol-detail-farm-plan.jpg")

    # ---- 03: the filtered emerging radar below the $50M floor, sorted by 7d growth
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.select_option("#seg", "emerging")
    page.select_option("#tier", "b5")
    page.fill("#q", "dex")
    page.wait_for_timeout(250)
    page.click("th button:has-text('7d')")
    page.wait_for_timeout(400)
    shot("03-filtered-emerging-radar.jpg")

    # ---- 04: the methodology — the model panel, the peer multiples, the backtest
    page.fill("#q", "")
    page.click("button.reset")
    page.wait_for_timeout(400)
    page.evaluate("window.scrollTo(0, document.querySelector('.grid2').getBoundingClientRect().top + window.scrollY - 140)")
    page.wait_for_timeout(300)
    shot("04-model-methodology.jpg")

    browser.close()

server.shutdown()

# ---------------------------------------------------------------- hygiene checks

bad_requests = [u for u in requests if not u.startswith(f"http://127.0.0.1:{PORT}")]
print(f"requests: {len(requests)} (all to 127.0.0.1:{PORT}: {len(bad_requests) == 0})")
for u in bad_requests:
    print("  OFF-SERVER REQUEST:", u)
if console_errors:
    print("CONSOLE ERRORS:")
    for e in console_errors:
        print("  ", e)
    sys.exit(1)
if bad_requests:
    sys.exit(1)

from PIL import Image  # noqa: E402

for name in sorted(os.listdir(SHOTS)):
    path = os.path.join(SHOTS, name)
    with Image.open(path) as im:
        w, h = im.size
    size = os.path.getsize(path)
    ok = size <= 512 * 1024 and max(w, h) <= 1440 and min(w, h) >= 800
    print(f"{name}: {w}x{h}, {size/1024:.0f} KB {'OK' if ok else 'FAIL'}")
    if not ok:
        sys.exit(1)
print("screenshots verified")
