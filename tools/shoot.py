#!/usr/bin/env python3
"""Kestrel Token Radar screenshot rig.

Serves the built /output directory with an in-process ThreadingHTTPServer (never a background
shell job), drives the real /usr/bin/google-chrome through Playwright, captures four dossier
screenshots at 1400x900 JPEG, and fails loudly on any console error, any request that leaves
127.0.0.1, any clipped layout, and any wrong verdict colour. Usage: python3 tools/shoot.py <out>
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

    def shot(name, quality=78):
        page.screenshot(path=os.path.join(SHOTS, name), type="jpeg", quality=quality)
        print(f"{name} done")

    def top_of(sel):
        page.evaluate("(s) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + window.scrollY - 6)", sel)
        page.wait_for_timeout(200)

    # ---- 01: the board, drawer closed: the top FARM picks above the ranked table
    page.goto(f"{BASE}/dashboard/index.html", wait_until="load")
    page.wait_for_timeout(500)
    st = page.evaluate("""() => ({
      drawer: document.getElementById('drawer').classList.contains('open'),
      kpis: document.querySelectorAll('.kpi').length,
      cards: document.querySelectorAll('.card .pill.FARM').length,
      cardBottom: Math.round(document.querySelector('.pk').getBoundingClientRect().bottom),
      cols: Array.from(document.querySelectorAll('#bm thead th')).map(th => Math.round(th.getBoundingClientRect().right)),
      rowsInView: Array.from(document.querySelectorAll('#bm tbody tr')).filter(tr => tr.getBoundingClientRect().bottom <= 900).length,
      bars: document.querySelectorAll('#bm .rb').length, evbars: document.querySelectorAll('#bm .eb').length,
      scroll: document.documentElement.scrollWidth,
      clipped: Array.from(document.querySelectorAll('.card > span, .kpi .v, .kpi .s')).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 40)),
      paper: getComputedStyle(document.body).backgroundColor
    })""")
    if st["drawer"] or st["kpis"] != 7 or st["cards"] != 5 or len(st["cols"]) != 9 or max(st["cols"]) > 1382:
        raise SystemExit(f"shot 01: layout wrong: {st}")
    if st["scroll"] > 1400 or st["clipped"] or st["paper"] != "rgb(248, 250, 252)" or st["rowsInView"] < 7 or st["bars"] != st["evbars"]:
        raise SystemExit(f"shot 01: overflow, clipping or too few rows: {st}")
    print(f"shot 01: 7 KPIs · 5 FARM cards (bottom {st['cardBottom']}) · 9 columns · {st['rowsInView']} rows above the fold · band + EV bars on every row")
    shot("01-board-overview.jpg")

    # ---- 02: the best FARM pick's detail view: bridge, anchors, 3-tier EV, recompute, six steps
    page.click(".card >> nth=0")
    page.wait_for_timeout(450)
    st2 = page.evaluate("""() => {
      const d = document.getElementById('drawer'), rc = d.querySelector('.recompute'), steps = d.querySelectorAll('ol.plan li');
      return {open: d.classList.contains('open'), title: d.querySelector('h2').textContent, pill: d.querySelector('.pill').textContent,
        rec: rc.textContent, good: !rc.classList.contains('off'), recBottom: Math.round(rc.getBoundingClientRect().bottom),
        steps: steps.length, lastStep: Math.round(steps[steps.length - 1].getBoundingClientRect().bottom), anchors: d.querySelectorAll('table.ev')[1].querySelectorAll('tbody tr').length};
    }""")
    if not st2["open"] or st2["pill"] != "FARM" or not st2["good"] or st2["rec"].count("✓") < 2 or st2["steps"] != 6 or st2["anchors"] != 3:
        raise SystemExit(f"shot 02: detail incomplete: {st2}")
    if st2["recBottom"] > 898 or st2["lastStep"] > 898:
        raise SystemExit(f"shot 02: recompute or step 6 below the fold: {st2}")
    print(f"shot 02: {st2['title']} · FARM · 3 anchors · recompute ✓✓ (bottom {st2['recBottom']}) · 6 steps (bottom {st2['lastStep']})")
    shot("02-protocol-detail-farm-plan.jpg")

    # ---- 03: the radar, filtered to the emerging segment
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    page.click("button[data-v='radar']")
    page.wait_for_timeout(300)
    page.select_option("#seg", "emerging")
    page.wait_for_timeout(350)
    top_of(".tabs")
    st4 = page.evaluate("""() => {
      const svg = document.querySelector('.rgrid svg'), lb = Array.from(svg.querySelectorAll('text.lb')).map(t => t.getBoundingClientRect());
      let hits = 0;
      for (let i = 0; i < lb.length; i++) for (let j = i + 1; j < lb.length; j++) { const a = lb[i], b = lb[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits++; }
      const r = svg.getBoundingClientRect();
      return {dots: svg.querySelectorAll('circle[data-i]').length, comps: svg.querySelectorAll('circle:not([data-i])').length, labels: lb.length, hits,
        out: lb.filter(b => b.left < r.left || b.right > r.right).length, bottom: Math.round(r.bottom), list: document.querySelectorAll('.rgrid table tbody tr').length,
        shown: document.querySelector('.shown').textContent};
    }""")
    if st4["dots"] != 177 or st4["comps"] != 87 or st4["labels"] < 8 or st4["hits"] or st4["out"] or st4["bottom"] > 898 or st4["list"] < 10:
        raise SystemExit(f"shot 03: radar incomplete or labels collide: {st4}")
    print(f"shot 03: radar · 177 rows + 87 comps · {st4['labels']} labels, 0 collisions · filtered: {st4['shown']} · list {st4['list']}")
    shot("03-filtered-emerging-radar.jpg")

    # ---- 04: the methodology suite
    page.select_option("#seg", "all")
    page.wait_for_timeout(250)
    page.click("button[data-v='model']")
    page.wait_for_timeout(450)
    top_of(".tabs")
    st5 = page.evaluate("""() => {
      const svg = document.querySelectorAll('.view svg.plot');
      return {loo: svg[0].querySelectorAll('circle').length, bars: svg[1].querySelectorAll('rect').length, idn: document.querySelector('.idn').textContent,
        fbar: Math.round(document.querySelector('.fbar').getBoundingClientRect().bottom), scroll: document.documentElement.scrollWidth,
        eq: document.querySelector('.eq').textContent};
    }""")
    if st5["loo"] != 87 or st5["bars"] != 87 or "758" not in st5["idn"] or "MISMATCH" in st5["idn"] or "log(mcap_usd)" not in st5["eq"] or st5["scroll"] > 1400 or st5["fbar"] > 898:
        raise SystemExit(f"shot 04: methodology incomplete: {st5}")
    print(f"shot 04: equation · LOO scatter 87 · residuals 87 · funnel bar in frame (bottom {st5['fbar']}) · {st5['idn'][:60]}")
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
