#!/usr/bin/env python3
"""Kestrel Token Radar screenshot rig and end-to-end check.

Serves a built output directory with an in-process ThreadingHTTPServer, drives the real
/usr/bin/google-chrome through Playwright, waits for the page's own live re-run of both fits,
exercises every control (capital switcher, filters, sort, search, detail drawer, tabs), checks that
the page's recomputed FDV, P(12m), P(24m), season share and two-outcome verdicts match board.json
for every row and tier, and captures four 1440x900 screenshots (Chrome's PNG, saved as a 256-colour
palette PNG by Pillow). It fails on any console or page error, any request that leaves
127.0.0.1, any horizontal overflow or clipped label, and any two overlapping <text> boxes inside any
<svg> of any of the four views.
Usage: python3 tools/shoot.py <out_dir> [--shots-to <dir>] [--no-shots]
"""
import http.server
import io
import json
import os
import socket
import sys
import threading

from PIL import Image

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tr_out1")
SAVE = "--no-shots" not in sys.argv
SHOTS = os.path.abspath(sys.argv[sys.argv.index("--shots-to") + 1]) if "--shots-to" in sys.argv else os.path.join(OUT, "screenshots")
W, H = 1440, 900
MAX_KB = 150  # four images as base64 plus the 65 KB text keep dossier.json under 0.9 MB


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=OUT, **kw)

    def log_message(self, *a):
        pass


s = socket.socket()
s.bind(("127.0.0.1", 0))
PORT = s.getsockname()[1]
s.close()
server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"

from playwright.sync_api import sync_playwright  # noqa: E402

errors, requests, fails = [], [], []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}{'  [' + str(detail) + ']' if detail else ''}")
    if not cond:
        fails.append(name)


board = json.load(open(os.path.join(OUT, "board.json")))["rows"]
by_slug = {r["slug"]: r for r in board}
N = len(board)

OVERLAP_JS = """() => { const out = []; let n = 0;
  for (const svg of document.querySelectorAll('svg')) {
    const r = svg.getBoundingClientRect();
    if (!r.width || r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue;
    const b = [...svg.querySelectorAll('text')].map(t => [t.textContent, t.getBoundingClientRect()]).filter(x => x[1].width > 0 && x[1].height > 0);
    n += b.length;
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const p = b[i][1], q = b[j][1];
      if (p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom) out.push(b[i][0] + ' / ' + b[j][0]); } }
  return { n, out }; }"""
CLIP = ".kpi b, .kpi span, .grid td b, .grid td small, .fx i, .dk b, .dk small, .dk label, h3, ol.bkl b, .bkk label, .bkk small, .stats label, .stats small, .acc small, .hb span, .strip, .led td"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    def shot(name):
        """Chrome's lossless PNG, re-encoded as a 256-colour octree palette PNG (flat UI: crisp text, exact hues)."""
        if not SAVE:
            return
        os.makedirs(SHOTS, exist_ok=True)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.mouse.move(700, 8)
        img = Image.open(io.BytesIO(page.screenshot(type="png"))).convert("RGB")
        buf = io.BytesIO()
        img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(buf, "PNG", optimize=True)
        check(f"{name}: {img.width}x{img.height}, {buf.tell() / 1024:.0f} KB <= {MAX_KB} KB", img.size == (W, H) and buf.tell() <= MAX_KB * 1024)
        open(os.path.join(SHOTS, name), "wb").write(buf.getvalue())

    def layout(label):
        st = page.evaluate("""(sel) => ({ scroll: document.documentElement.scrollWidth,
          clipped: [...document.querySelectorAll(sel)].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 50)) })""", CLIP)
        check(f"{label}: no horizontal overflow", st["scroll"] <= W, st["scroll"])
        check(f"{label}: no clipped label", not st["clipped"], st["clipped"][:4])

    def no_overlap(label):
        r = page.evaluate(OVERLAP_JS)
        check(f"{label}: 0 overlapping SVG <text> boxes among {r['n']} labels", not r["out"], r["out"][:3])

    page.goto(f"{BASE}/dashboard/index.html", wait_until="load")
    page.wait_for_function("() => L !== null", timeout=30000)
    page.wait_for_timeout(200)

    # ---- integrity strip, computed by the page: accounting, live rows and both live refits
    strip = page.evaluate("() => document.querySelector('.strip').textContent")
    check("integrity strip: 758/758, 40/40, all rows live, value fit + ledger and launch curve re-run = shipped",
          "758/758" in strip and "40/40" in strip and f"{N}/{N}" in strip and "4-term value fit" in strip and "758 LOO refits" in strip and "✗" not in strip, strip.strip()[:200])

    # ---- every tier: the page's numbers equal board.json's for all rows
    for tier in (1000, 10000, 50000):
        page.click(f"button[data-tier='{tier}']")
        page.wait_for_timeout(120)
        got = page.evaluate("(d) => R.rows.map(r => { const u = UN[r.slug], c = KM.campaign(O, u), t = KM.farmTier(r.f, d); return [r.slug, t.verdict, t.roi[1], KM.implied(F, u), c.p12, c.p24, c.ss, t.apr_if[1], t.apr[1]]; })", tier)
        bad = [g[0] for g in got if (lambda b: b["verdict_by_deposit"][str(tier)] != g[1] or b["net_roi_p50_pct_by_deposit"][str(tier)] != g[2] or b["implied_value_usd"] != g[3]
               or b["p_token_12m"] != g[4] or b["p_token_24m"] != g[5] or b["season_share"] != g[6] or b["net_apr_if_token_p50_pct_by_deposit"][str(tier)] != g[7] or b["net_apr_p50_pct_by_deposit"][str(tier)] != g[8])(by_slug[g[0]])]
        check(f"tier ${tier}: page recompute (FDV, P12, P24, season share, verdict, ROI, APR, if-token APR) = board.json, {len(got)} rows", not bad and len(got) == N, bad[:5])
        pills = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].map(tr => [tr.dataset.slug, tr.querySelector('.pill').textContent])")
        check(f"tier ${tier}: every rendered verdict pill matches", all(by_slug[s]["verdict_by_deposit"][str(tier)] == v for s, v in pills) and len(pills) == N, len(pills))
        bk = page.evaluate("(d) => { const b = KM.basket(R.rows, d), s = R.baskets[d], c = b.picks.reduce((a, x) => ((a[x.r.cat] = (a[x.r.cat] || 0) + 1), a), {}); return [JSON.stringify(b.slugs) === JSON.stringify(s.slugs) && b.net === s.net && b.p25 === s.p25 && b.costs === s.costs && b.apr === s.apr, new Set(b.picks.map(x => x.r.f.chain)).size === b.picks.length && Object.values(c).every(n => n <= M.cat_max), b.picks.length]; }", tier)
        check(f"tier ${tier}: basket recompute = data.js, distinct chains, <= 2 per category", bk[0] and bk[1], bk)
        mix = page.evaluate("() => [...document.querySelectorAll('.kpi em')].slice(0, 3).map(e => +e.textContent)")
        exp = [sum(1 for r in board if r["verdict_by_deposit"][str(tier)] == v) for v in ("FARM", "THIN", "SKIP")]
        check(f"tier ${tier}: KPI verdict mix {mix}", mix == exp, exp)

    # ---- sort, search, filters, reset
    page.click("button[data-tier='10000']")
    for key, getter in (("apr", "T(r).apr[1]"), ("tvl", "r.tvl"), ("p", "r.f.p12")):
        page.click(f"th[data-sort='{key}']")
        v = page.evaluate(f"() => [...document.querySelectorAll('#grid tbody tr')].map(tr => {{ const r = R.rows.find(x => x.slug === tr.dataset.slug); return {getter}; }})")
        check(f"sort: {key} descending", v == sorted(v, reverse=True) and len(v) == N)
    page.fill("#q", "lending")
    page.wait_for_timeout(150)
    n = page.evaluate("() => document.querySelectorAll('#grid tbody tr').length")
    check("search: 'lending' narrows the board", 0 < n < N, n)
    page.click("#reset")
    page.select_option("#seg", "W")
    page.wait_for_timeout(100)
    n = page.evaluate("() => document.querySelectorAll('#grid tbody tr').length")
    check("filter: watchlist segment shows 40", n == 40, n)
    page.click("#reset")
    page.select_option("#cat", "Lending")
    n = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].every(tr => R.rows.find(r => r.slug === tr.dataset.slug).cat === 'Lending')")
    check("filter: category Lending", n)
    page.click("#reset")
    page.click("button[data-v='THIN']")
    n = page.evaluate("() => [...document.querySelectorAll('#grid tbody .pill')].every(p => p.textContent === 'THIN') && document.querySelectorAll('#grid tbody tr').length")
    check("filter: THIN chip shows only THIN rows", bool(n), n)
    page.click("#reset")
    page.wait_for_timeout(150)

    # ---- 01 board overview at $10k, rank order
    page.evaluate("() => window.scrollTo(0, 0)")
    st = page.evaluate("() => ({rows: [...document.querySelectorAll('#grid tbody tr')].filter(tr => tr.getBoundingClientRect().bottom <= innerHeight).length, farm: [...document.querySelectorAll('.side .pill.FARM')].length, sleeves: document.querySelectorAll('.side ol.bkl').length, bottom: Math.round(document.querySelector('.side').getBoundingClientRect().bottom)})")
    check("shot 01: 11+ ranked rows above the fold", st["rows"] >= 11, st["rows"])
    check("shot 01: top-5 FARM setups and the allocator above the fold", st["farm"] == 5 and st["sleeves"] == 2 and st["bottom"] <= H, st)
    layout("shot 01")
    no_overlap("shot 01")
    shot("01-board-overview.png")

    # ---- 02 detail drawer of the best watchlist FARM at $10k (else the best setup)
    pick = page.evaluate("() => { const w = R.rows.filter(r => r.seg === 'W' && T(r).verdict === 'FARM').sort((a, b) => T(b).apr[1] - T(a).apr[1]); return w.length ? w[0].slug : null; }")
    if pick:
        page.evaluate("(s) => openDrawer(s)", pick)
    else:
        page.click(".side ol.bkl li >> nth=0")
    page.wait_for_timeout(400)
    st = page.evaluate("""() => { const d = document.getElementById('drawer'), st = d.querySelectorAll('ol.plan li');
      return {open: d.classList.contains('open'), name: d.querySelector('h2').textContent, pill: d.querySelector('.dk .pill').textContent,
        rec: d.querySelector('.mono').textContent, checks: [...d.querySelectorAll('h3 small')].map(e => e.textContent).filter(t => t.includes('= board')).length,
        steps: st.length, last: Math.round(st[st.length - 1].getBoundingClientRect().bottom), secs: d.querySelectorAll('.fe tr.sec').length,
        chart: Math.round(d.querySelector('svg.sens').getBoundingClientRect().bottom), scroll: d.scrollWidth - d.clientWidth}; }""")
    check(f"shot 02: drawer for {st['name']}", st["open"] and st["pill"] == "FARM", st["pill"])
    check("shot 02: FDV (KM.implied) and odds (KM.campaign) both recompute = board", "✓" in st["rec"] and st["checks"] == 2, st["checks"])
    check("shot 02: token-ships / no-token / blended sections", st["secs"] == 3, st["secs"])
    check("shot 02: 7 plan steps and the sensitivity chart above the fold", st["steps"] == 7 and st["last"] <= H and st["chart"] <= H, (st["last"], st["chart"]))
    check("shot 02: drawer has no horizontal overflow", st["scroll"] <= 0, st["scroll"])
    layout("shot 02")
    no_overlap("shot 02")
    shot("02-protocol-detail-farm-plan.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)

    # ---- 03 FARM-filtered actionable view, sorted by risk-adj APR, with the allocator and breakdown
    page.click("button[data-v='FARM']")
    page.click("th[data-sort='apr']")
    page.wait_for_timeout(200)
    st = page.evaluate("() => ({pills: [...document.querySelectorAll('#grid tbody .pill')].map(p => p.textContent), apr: [...document.querySelectorAll('#grid tbody tr')].map(tr => T(R.rows.find(r => r.slug === tr.dataset.slug)).apr[1]), sleeves: document.querySelectorAll('.side ol.bkl li').length, bars: document.querySelectorAll('.hb').length, bottom: Math.round(document.querySelector('.side').getBoundingClientRect().bottom)})")
    exp = sum(1 for r in board if r["verdict_by_deposit"]["10000"] == "FARM")
    check(f"shot 03: {exp} FARM rows only, sorted by risk-adj APR", len(st["pills"]) == exp and set(st["pills"]) == {"FARM"} and st["apr"] == sorted(st["apr"], reverse=True), len(st["pills"]))
    check("shot 03: 4-sleeve allocator and breakdown bars above the fold", st["sleeves"] == 4 and st["bars"] >= 6 and st["bottom"] <= H, st)
    layout("shot 03")
    no_overlap("shot 03")
    shot("03-filtered-emerging-radar.png")
    page.click("#reset")

    # ---- 04 methodology
    page.click("button[data-tab='method']")
    page.wait_for_timeout(300)
    st = page.evaluate("() => ({loo: document.querySelectorAll('.mgrid circle.in, .mgrid circle.out').length, cal: document.querySelectorAll('.mgrid circle.cal').length, led: document.querySelectorAll('.led tr').length - 1, acc: document.querySelectorAll('.acc div').length, vis: [...document.querySelectorAll('.mgrid > section')].map(s => Math.round(s.getBoundingClientRect().bottom))})")
    check("shot 04: 87 blind LOO points and 5 calibration quintiles", st["loo"] == 87 and st["cal"] == 5, st)
    check("shot 04: term ledger shows the shipped design plus every tested one", st["led"] == 1 + len(json.loads(page.evaluate("() => JSON.stringify(F.ledger)"))), st["led"])
    check("shot 04: 6-bucket 758 accounting", st["acc"] == 6, st["acc"])
    check("shot 04: all three methodology panels end above the fold", all(v <= H for v in st["vis"]), st["vis"])
    layout("shot 04")
    no_overlap("shot 04")
    shot("04-model-methodology.png")
    browser.close()

server.shutdown()
off = [u for u in requests if not u.startswith(BASE)]
check("network: every request stays on 127.0.0.1 (0 external)", not off, off[:3])
check("console: 0 errors, 0 page errors", not errors, errors[:3])
print(f"\n{'E2E PASS' if not fails else str(len(fails)) + ' FAILURES: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
