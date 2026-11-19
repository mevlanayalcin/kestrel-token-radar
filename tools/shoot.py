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

    def shot(name, quality=80):
        page.screenshot(path=os.path.join(SHOTS, name), type="jpeg", quality=quality)
        print(f"{name} done")

    # ---- 01: the full board, drawer closed — cover shot, nothing obscured, nothing overflows
    page.goto(f"{BASE}/dashboard/index.html", wait_until="load")
    page.wait_for_timeout(500)
    st = page.evaluate("""() => ({
      drawer: document.getElementById('drawer').classList.contains('open'),
      kpis: document.querySelectorAll('.kpi').length,
      cols: Array.from(document.querySelectorAll('#bm thead th')).map(th => Math.round(th.getBoundingClientRect().right)),
      rows: document.querySelectorAll('#bm tbody tr').length,
      scroll: document.documentElement.scrollWidth,
      paper: getComputedStyle(document.body).backgroundColor,
      pillF: (() => { const p = document.querySelector('.pill.SKIP'); const cs = getComputedStyle(p); return [cs.backgroundColor, cs.color, cs.fontWeight]; })(),
      firstAnchor: document.querySelectorAll('#bm tbody tr td.anc').length,
      light: getComputedStyle(document.querySelector('.mast h1')).color
    })""")
    if st["drawer"]:
        raise SystemExit("shot 01: the drawer must be closed for the cover")
    if st["kpis"] != 7 or len(st["cols"]) != 9 or max(st["cols"]) > 1382:
        raise SystemExit(f"shot 01: layout not fully visible: {st}")
    if st["scroll"] > 1400:
        raise SystemExit(f"shot 01: horizontal overflow, scrollWidth {st['scroll']}")
    if st["paper"] != "rgb(248, 250, 252)" or st["light"] != "rgb(15, 23, 42)":
        raise SystemExit(f"shot 01: the page is not the light print theme: {st['paper']} / {st['light']}")
    if st["pillF"][0] != "rgb(185, 28, 28)" or st["pillF"][1] != "rgb(255, 255, 255)":
        raise SystemExit(f"shot 01: verdict pills are not solid high-contrast: {st['pillF']}")
    if st["firstAnchor"] < 10:
        raise SystemExit(f"shot 01: rows lost their named anchors: {st['firstAnchor']}")
    print(f"shot 01: drawer closed · {st['kpis']} KPIs · 9 columns, right edge {max(st['cols'])} · {st['rows']} rows · no overflow · light theme + solid pills verified")
    shot("01-board-overview.jpg")

    # ---- 02: rank-1 deep dive — verdict, anchors, EV bridge, six-step plan, page-side recompute
    page.click("#bm tbody tr:first-child")
    page.wait_for_timeout(450)
    st2 = page.evaluate("""() => {
      const d = document.getElementById('drawer');
      const rc = d.querySelector('.recompute');
      const ev = d.querySelectorAll('table.ev');
      const steps = d.querySelectorAll('ul.plan li');
      const r = d.getBoundingClientRect();
      return {
        open: d.classList.contains('open'), title: d.querySelector('h2').textContent,
        inView: r.left >= 0 && r.right <= 1401,
        tables: ev.length, rec: rc ? rc.textContent : '', recGood: rc ? !rc.classList.contains('off') : false,
        steps: steps.length, lastStepBottom: steps.length ? Math.round(steps[steps.length - 1].getBoundingClientRect().bottom) : 0,
        pill: d.querySelector('.pill') ? d.querySelector('.pill').textContent : ''
      };
    }""")
    if not st2["open"] or not st2["inView"]:
        raise SystemExit(f"shot 02: drawer not open or off-screen: {st2}")
    if st2["tables"] != 2 or st2["steps"] != 6 or not st2["recGood"] or "✓" not in st2["rec"]:
        raise SystemExit(f"shot 02: drawer content incomplete (2 tables, 6 steps, recompute ✓): {st2}")
    page.evaluate("() => document.getElementById('drawer').querySelector('.recompute').scrollIntoView({block: 'center'})")
    page.wait_for_timeout(250)
    st3 = page.evaluate("""() => {
      const rc = document.querySelector('#drawer .recompute').getBoundingClientRect();
      const h2 = document.querySelector('#drawer h2').getBoundingClientRect();
      return {recTop: Math.round(rc.top), recBottom: Math.round(rc.bottom), h2Visible: h2.bottom < 900 && h2.top > 0};
    }""")
    if st3["recBottom"] > 898 or st3["recTop"] < 0:
        raise SystemExit(f"shot 02: recompute block not framed: {st3}")
    print(f"shot 02: {st2['title']} · {st2['pill']} · anchors+EV tables · 6 plan steps · recompute ✓ inside frame")
    shot("02-protocol-detail-farm-plan.jpg")

    # ---- 03: the emerging FARM set below the floor, sorted by net EV — the actionable screen
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    page.select_option("#seg", "emerging")
    page.select_option("#ver", "FARM")
    page.wait_for_timeout(250)
    page.click("#bm thead th button[data-s='ev']")
    page.wait_for_timeout(350)
    st4 = page.evaluate("""() => {
      const rows = Array.from(document.querySelectorAll('#bm tbody tr'));
      const farmCount = rows.filter(tr => tr.querySelector('.pill.FARM')).length;
      const belowFloor = rows.every(tr => parseFloat(tr.children[5].textContent.replace(/[^0-9.]/g, '')) < 50);
      const evs = rows.map(tr => parseFloat(tr.children[7].firstChild.textContent));
      const desc = evs.every((v, i) => i === 0 || v <= evs[i - 1] + 0.001);
      return {rows: rows.length, farmCount, belowFloor, desc, top: rows.length ? rows[0].querySelector('.nm').textContent : ''};
    }""")
    if st4["rows"] == 0 or st4["farmCount"] != st4["rows"] or not st4["desc"] or not st4["belowFloor"]:
        raise SystemExit(f"shot 03: the filter did not hold (all rows FARM, EV desc): {st4}")
    print(f"shot 03: {st4['rows']} emerging FARM picks · every row below the floor · EV descending · top: {st4['top']}")
    shot("03-filtered-emerging-radar.jpg")

    # ---- 04: the methodology — the fitted equation, both validations drawn, the funnel identity
    page.select_option("#seg", "all")
    page.select_option("#ver", "all")
    page.wait_for_timeout(250)
    page.click("button[data-v='model']")
    page.wait_for_timeout(450)
    st5 = page.evaluate("""() => {
      const svg = document.querySelectorAll('.view svg.plot');
      const loo = svg[0] ? svg[0].querySelectorAll('circle').length : 0;
      const bars = svg.length > 1 ? svg[1].querySelectorAll('rect').length : 0;
      const idn = document.querySelector('.idn');
      const fnl = document.querySelectorAll('.fnl .fn').length;
      const coef = document.querySelectorAll('.panel table.mini')[0];
      return {svgs: svg.length, loo, bars, idn: idn ? idn.textContent : '', fnl, coefRows: coef ? coef.querySelectorAll('tbody tr').length : 0,
              eq: document.querySelector('.eq') ? document.querySelector('.eq').textContent : '', scroll: document.documentElement.scrollWidth};
    }""")
    if st5["svgs"] != 2 or st5["loo"] != 87 or st5["bars"] != 87:
        raise SystemExit(f"shot 04: the LOO scatter and residual strip must draw all 87 comps: {st5}")
    if "758" not in st5["idn"] or "MISMATCH" in st5["idn"] or "log(mcap_usd)" not in st5["eq"]:
        raise SystemExit(f"shot 04: funnel identity or equation missing: {st5['idn'][:90]}")
    if st5["coefRows"] < 8 or st5["fnl"] < 7 or st5["scroll"] > 1400:
        raise SystemExit(f"shot 04: methodology not fully rendered: {st5}")
    print(f"shot 04: equation shown · {st5['coefRows']} coefficients · LOO scatter 87 pts · residual strip 87 bars · {st5['fnl']} funnel lines · identity reads: …{st5['idn'][-52:]}")
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
