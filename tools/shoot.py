#!/usr/bin/env python3
"""Kestrel Token Radar screenshot rig and end-to-end check.

Serves a built output directory with an in-process ThreadingHTTPServer, drives the real
/usr/bin/google-chrome through Playwright, exercises every control (tabs, capital switcher,
filters, sort, search, detail drawer, the 758-protocol audit), checks that the page's recomputed
implied FDV, P(token) and two-outcome verdicts match board.json for every row and tier, and captures
four 1440x900 JPEG screenshots. It fails on any console or page error, any request that leaves
127.0.0.1, any horizontal overflow, clipped label or overlapping chart text.
Usage: python3 tools/shoot.py <out_dir> [--no-shots]
"""
import http.server
import json
import os
import socket
import sys
import threading

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tr_out1")
SAVE = "--no-shots" not in sys.argv
SHOTS = os.path.join(OUT, "screenshots")
W, H = 1440, 900
TARGET_KB = (170, 215)  # four images as base64 keep the dossier near 1.1 MiB, well under the 1.5 MiB cap


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

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"])
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))

    def shot(name):
        if not SAVE:
            return
        path = os.path.join(SHOTS, name)
        for q in (90, 88, 86, 84, 82, 80, 78, 76, 74, 72, 70, 66, 62):
            page.screenshot(path=path, type="jpeg", quality=q)
            kb = os.path.getsize(path) / 1024
            if kb <= TARGET_KB[1]:
                break
        print(f"  {name}: quality {q}, {kb:.0f} KB")

    CLIP = ".kpi b, .kpi span, .grid td b, .grid td small, .dk b, .dk small, h3, .matrix button, ol.bkl b, ol.bkl small, .bkk label, .bkk small, .odds label, .stats label, .acc small, .hb span, .strip, .filters input"

    def layout(label):
        st = page.evaluate("""(sel) => ({
          scroll: document.documentElement.scrollWidth,
          clipped: Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 50)),
        })""", CLIP)
        check(f"{label}: no horizontal overflow", st["scroll"] <= W, st["scroll"])
        check(f"{label}: no clipped or ellipsized label", not st["clipped"], st["clipped"][:4])

    def overlaps(sel):
        return page.evaluate("""(sel) => { const out = [];
          for (const svg of document.querySelectorAll(sel)) {
            const b = [...svg.querySelectorAll('text')].map(t => [t.textContent, t.getBoundingClientRect()]).filter(x => x[1].width > 0);
            for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const p = b[i][1], q = b[j][1];
              if (p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) out.push(b[i][0] + ' / ' + b[j][0]); } }
          return out; }""", sel)

    page.goto(f"{BASE}/dashboard/index.html", wait_until="load")
    page.wait_for_timeout(400)

    # ---- integrity strip, computed by the page on boot
    strip = page.evaluate("() => document.querySelector('.strip').textContent")
    check("integrity strip: 758/758 accounted, 40/40 watchlist, all rows live, all sign checks", f"758/758" in strip and "40/40" in strip and f"{N}/{N}" in strip and f"{4 * N}/{4 * N}" in strip and "✗" not in strip, strip.strip()[:160])

    # ---- every tier: the page's FDV, P(token), verdicts and p50 ROI equal board.json's for all rows
    for tier in (1000, 10000, 50000):
        page.click(f"button[data-tier='{tier}']")
        page.wait_for_timeout(120)
        got = page.evaluate("(d) => R.rows.map(r => [r.slug, T(r, d).verdict, T(r, d).roi[1], valuation(r).fdv, odds(r).p, T(r, d).apr_if[1]])", tier)
        bad = [g[0] for g in got if by_slug[g[0]]["verdict_by_deposit"][str(tier)] != g[1] or by_slug[g[0]]["net_roi_p50_pct_by_deposit"][str(tier)] != g[2] or by_slug[g[0]]["implied_value_usd"] != g[3] or by_slug[g[0]]["p_token_12m"] != g[4] or by_slug[g[0]]["net_apr_if_token_p50_pct_by_deposit"][str(tier)] != g[5]]
        check(f"tier ${tier}: page recompute (FDV, P(token), two-outcome verdict, ROI, if-token APR) = board.json for all {len(got)} rows", not bad and len(got) == N, bad[:5])
        pills = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].map(tr => [tr.dataset.slug, tr.querySelector('.pill').textContent])")
        check(f"tier ${tier}: every rendered verdict pill matches", all(by_slug[s]["verdict_by_deposit"][str(tier)] == v for s, v in pills) and len(pills) == N, len(pills))
        bk = page.evaluate("(d) => { const b = basket(d), s = R.baskets[d], c = b.p.reduce((a, x) => ((a[x.r.cat] = (a[x.r.cat] || 0) + 1), a), {}); return [JSON.stringify(b.p.map(x => x.r.slug)) === JSON.stringify(s.slugs) && b.net === s.net_p50 && b.p25 === s.net_p25 && b.costs === s.costs && b.apr === s.apr_p50, new Set(b.p.map(x => x.r.f.chain)).size === b.p.length && Object.values(c).every(n => n <= M.basket_cat_max), b.p.length]; }", tier)
        check(f"tier ${tier}: basket recompute = data.js, distinct chains, <= 2 per category", bk[0] and bk[1], bk)
        mix = page.evaluate("() => [...document.querySelectorAll('.kpi.wide em')].map(e => +e.textContent)")
        exp = [sum(1 for r in board if r["verdict_by_deposit"][str(tier)] == v) for v in ("FARM", "THIN", "SKIP")]
        check(f"tier ${tier}: KPI verdict mix {mix}", mix == exp, exp)

    # ---- sort, search, filters, reset
    page.click("button[data-tier='10000']")
    for key, getter in (("apr", "T(r).apr[1]"), ("tvl", "r.tvl"), ("p", "r.f.p")):
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

    # ---- the 758 audit
    page.click("button[data-tab='audit']")
    page.wait_for_timeout(200)
    n = page.evaluate("() => document.querySelectorAll('table.au tr').length - 1")
    check("audit: all 758 protocols listed", n == 758, n)
    page.click("button[data-ad='C']")
    n = page.evaluate("() => [...document.querySelectorAll('table.au .disp')].map(e => e.textContent)")
    check("audit: traded-comp chip shows the 87 comps only", len(n) == 87 and set(n) == {"Traded comp"}, len(n))
    page.click("button[data-ad='all']")
    page.fill("#aq", "binance")
    page.wait_for_timeout(150)
    n = page.evaluate("() => document.querySelectorAll('table.au tr').length - 1")
    check("audit: search narrows the 758", 0 < n < 758, n)
    page.fill("#aq", "")
    page.click("button[data-ad='W']")
    page.click("table.au tr.lnk >> nth=0")
    page.wait_for_timeout(250)
    check("audit: a watchlist row opens its drawer", page.evaluate("() => document.getElementById('drawer').classList.contains('open')"))
    page.keyboard.press("Escape")
    page.click("button[data-ad='all']")
    layout("tab audit")
    page.click("button[data-tab='method']")
    page.wait_for_timeout(150)
    layout("tab method")
    page.click("button[data-tab='board']")
    page.wait_for_timeout(150)
    layout("tab board")

    # ---- 01 board overview at $10k
    page.evaluate("() => window.scrollTo(0, 0)")
    rows_in_view = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].filter(tr => tr.getBoundingClientRect().bottom <= innerHeight).length")
    check("shot 01: 10+ board rows above the fold", rows_in_view >= 10, rows_in_view)
    st = page.evaluate("() => ({cards: document.querySelectorAll('ol.bkl li').length, cells: document.querySelectorAll('.matrix button').length, bottom: Math.round(document.querySelector('.side').getBoundingClientRect().bottom)})")
    check("shot 01: top-5 farm setups and the 40-cell watchlist grid above the fold", st["cards"] == 5 and st["cells"] == 40 and st["bottom"] <= H, st)
    shot("01-board-overview.jpg")

    # ---- 02 detail drawer of the best setup
    page.click("ol.bkl li >> nth=0")
    page.wait_for_timeout(400)
    st = page.evaluate("""() => { const d = document.getElementById('drawer'), st = d.querySelectorAll('ol.plan li');
      return {open: d.classList.contains('open'), name: d.querySelector('h2').textContent, pill: d.querySelector('.dk .pill').textContent,
        rec: d.querySelector('.mono').textContent, odds: [...d.querySelectorAll('h3 small')].map(e => e.textContent).filter(t => t.includes('recomputed')).length,
        steps: st.length, last: Math.round(st[st.length - 1].getBoundingClientRect().bottom), secs: d.querySelectorAll('.fe tr.sec').length,
        chart: Math.round(d.querySelector('svg.sens').getBoundingClientRect().bottom), peer: d.querySelectorAll('svg.peer rect').length, scroll: d.scrollWidth - d.clientWidth}; }""")
    check(f"shot 02: drawer for {st['name']}", st["open"] and st["pill"] == "FARM", st["pill"])
    check("shot 02: waterfall and launch odds both recompute = board", "✓ board" in st["rec"] and st["odds"] == 2, st["odds"])
    check("shot 02: token-ships / no-token / blended sections", st["secs"] == 3, st["secs"])
    check("shot 02: 7 plan steps and the sensitivity chart above the fold", st["steps"] == 7 and st["last"] <= H and st["chart"] <= H, (st["last"], st["chart"]))
    check("shot 02: drawer has no horizontal overflow", st["scroll"] <= 0, st["scroll"])
    check("shot 02: peer comps bars (row + 3 anchors)", st["peer"] == 4, st["peer"])
    ov = overlaps("#drawer svg")
    check("shot 02: no overlapping chart labels", not ov, ov[:3])
    layout("shot 02")
    shot("02-protocol-detail-farm-plan.jpg")
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)

    # ---- 03 FARM-filtered actionable view, sorted by risk-adj APR, with the allocator and breakdown
    page.click("button[data-v='FARM']")
    page.click("th[data-sort='apr']")
    page.wait_for_timeout(200)
    st = page.evaluate("() => ({pills: [...document.querySelectorAll('#grid tbody .pill')].map(p => p.textContent), apr: [...document.querySelectorAll('#grid tbody tr')].map(tr => T(R.rows.find(r => r.slug === tr.dataset.slug)).apr[1]), sleeves: document.querySelectorAll('ol.bkl li').length, bars: document.querySelectorAll('.hb').length, bottom: Math.round(document.querySelector('.side').getBoundingClientRect().bottom)})")
    exp = sum(1 for r in board if r["verdict_by_deposit"]["10000"] == "FARM")
    check(f"shot 03: {exp} FARM rows only, sorted by risk-adj APR", len(st["pills"]) == exp and set(st["pills"]) == {"FARM"} and st["apr"] == sorted(st["apr"], reverse=True), len(st["pills"]))
    check("shot 03: 4-sleeve allocator and breakdown bars above the fold", st["sleeves"] == 4 and st["bars"] >= 6 and st["bottom"] <= H, st)
    layout("shot 03")
    shot("03-filtered-emerging-radar.jpg")
    page.click("#reset")

    # ---- 04 methodology
    page.click("button[data-tab='method']")
    page.wait_for_timeout(300)
    st = page.evaluate("() => ({loo: document.querySelectorAll('.mgrid circle.in, .mgrid circle.out').length, cal: document.querySelectorAll('.mgrid circle.cal').length, mono: [...document.querySelectorAll('.mgrid .mono4 b')].map(b => b.textContent), acc: document.querySelectorAll('.acc div').length})")
    check("shot 04: 87 blind LOO points and 5 calibration quintiles", st["loo"] == 87 and st["cal"] == 5, st)
    check("shot 04: monotonicity holds on every row (4 checks)", len(st["mono"]) == 4 and all(m.startswith(f"{N}/{N}") for m in st["mono"]), st["mono"])
    check("shot 04: 6-bucket 758 accounting", st["acc"] == 6, st["acc"])
    ov = overlaps(".mgrid svg")
    check("shot 04: no overlapping chart labels", not ov, ov[:3])
    vis = page.evaluate("() => [...document.querySelectorAll('.mgrid > section:not(.span)')].map(s => Math.round(s.getBoundingClientRect().bottom))")
    check("shot 04: all three methodology panels end above the fold", all(v <= H for v in vis), vis)
    layout("shot 04")
    shot("04-model-methodology.jpg")
    browser.close()

server.shutdown()
off = [u for u in requests if not u.startswith(BASE)]
check("network: every request stays on 127.0.0.1", not off, off[:3])
check("console: zero errors", not errors, errors[:3])
print(f"\n{'E2E PASS' if not fails else str(len(fails)) + ' FAILURES: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
