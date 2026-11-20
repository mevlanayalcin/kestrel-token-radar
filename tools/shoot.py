#!/usr/bin/env python3
"""Kestrel Token Radar screenshot rig and end-to-end check.

Serves a built output directory with an in-process ThreadingHTTPServer, drives the real
/usr/bin/google-chrome through Playwright, exercises every control (tabs, capital switcher,
filters, sort, search, detail drawer), checks that the page's recomputed verdicts match
board.json for every row and tier, and captures four 1440x900 JPEG screenshots. It fails on any
console error, any request that leaves 127.0.0.1, any horizontal overflow or clipped KPI.
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
TARGET_KB = (200, 275)  # four images must fit the 1.5 MiB dossier as base64


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
        for q in (90, 88, 86, 84, 82, 80, 78, 75, 72, 70, 66, 62):
            page.screenshot(path=path, type="jpeg", quality=q)
            kb = os.path.getsize(path) / 1024
            if kb <= TARGET_KB[1]:
                break
        print(f"  {name}: quality {q}, {kb:.0f} KB")

    def layout(label):
        st = page.evaluate("""() => ({
          scroll: document.documentElement.scrollWidth,
          clipped: Array.from(document.querySelectorAll('.kpi b, .kpi span, .grid td b, .dk b, h3')).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.slice(0, 50)),
        })""")
        check(f"{label}: no horizontal overflow", st["scroll"] <= W, st["scroll"])
        check(f"{label}: no clipped headline text", not st["clipped"], st["clipped"])

    page.goto(f"{BASE}/dashboard/index.html", wait_until="load")
    page.wait_for_timeout(400)

    # ---- every tier: the page's verdicts and p50 ROI equal board.json's for all rows
    for tier in (1000, 10000, 50000):
        page.click(f"button[data-tier='{tier}']")
        page.wait_for_timeout(120)
        got = page.evaluate("(d) => R.rows.map(r => [r.slug, T(r, d).verdict, T(r, d).roi[1], valuation(r).fdv])", tier)
        bad = [g[0] for g in got if by_slug[g[0]]["verdict_by_deposit"][str(tier)] != g[1] or by_slug[g[0]]["net_roi_p50_pct_by_deposit"][str(tier)] != g[2] or by_slug[g[0]]["implied_value_usd"] != g[3]]
        check(f"tier ${tier}: page recompute = board.json for all {len(got)} rows", not bad and len(got) == len(board), bad[:5])
        pills = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].map(tr => [tr.dataset.slug, tr.querySelector('.pill').textContent])")
        check(f"tier ${tier}: every rendered verdict pill matches", all(by_slug[s]["verdict_by_deposit"][str(tier)] == v for s, v in pills) and len(pills) == len(board), len(pills))
        mix = page.evaluate("() => [...document.querySelectorAll('.kpi.wide em')].map(e => +e.textContent)")
        exp = [sum(1 for r in board if r["verdict_by_deposit"][str(tier)] == v) for v in ("FARM", "THIN", "SKIP")]
        check(f"tier ${tier}: KPI verdict mix {mix}", mix == exp, exp)

    # ---- sort, search, filters, reset
    page.click("button[data-tier='10000']")
    page.click("th[data-sort='apr']")
    aprs = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].map(tr => T(R.rows.find(r => r.slug === tr.dataset.slug)).apr[1])")
    check("sort: Net APR descending", aprs == sorted(aprs, reverse=True))
    page.click("th[data-sort='tvl']")
    tv = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].map(tr => R.rows.find(r => r.slug === tr.dataset.slug).tvl)")
    check("sort: TVL descending", tv == sorted(tv, reverse=True))
    page.fill("#q", "lending")
    page.wait_for_timeout(150)
    n = page.evaluate("() => document.querySelectorAll('#grid tbody tr').length")
    check("search: 'lending' narrows the board", 0 < n < len(board), n)
    page.click("#reset")
    page.select_option("#seg", "W")
    page.wait_for_timeout(100)
    n = page.evaluate("() => document.querySelectorAll('#grid tbody tr').length")
    check("filter: watchlist segment shows 40", n == 40, n)
    page.click("#reset")
    page.click("button[data-v='FARM']")
    n = page.evaluate("() => [...document.querySelectorAll('#grid tbody .pill')].every(p => p.textContent === 'FARM') && document.querySelectorAll('#grid tbody tr').length")
    check("filter: FARM chip shows only FARM rows", bool(n), n)
    page.click("#reset")
    for tab in ("radar", "traded", "method", "board"):
        page.click(f"button[data-tab='{tab}']")
        page.wait_for_timeout(150)
        layout(f"tab {tab}")
    dots = page.evaluate("() => (document.querySelector('button[data-tab=radar]').click(), document.querySelectorAll('.chart circle[data-slug]').length)")
    check("radar: one dot per ranked row", dots == len(board), dots)
    page.click("button[data-tab='board']")
    page.wait_for_timeout(150)

    # ---- 01 board overview at $10k
    page.evaluate("() => window.scrollTo(0, 0)")
    layout("shot 01")
    rows_in_view = page.evaluate("() => [...document.querySelectorAll('#grid tbody tr')].filter(tr => tr.getBoundingClientRect().bottom <= innerHeight).length")
    check("shot 01: 10+ board rows above the fold", rows_in_view >= 10, rows_in_view)
    shot("01-board-overview.jpg")

    # ---- 02 detail drawer of the best setup
    page.click("ol.best li >> nth=0")
    page.wait_for_timeout(400)
    st = page.evaluate("""() => { const d = document.getElementById('drawer'), st = d.querySelectorAll('ol.plan li');
      return {open: d.classList.contains('open'), name: d.querySelector('h2').textContent, pill: d.querySelector('.dk .pill').textContent,
        rec: d.querySelector('.mono').textContent, steps: st.length, last: Math.round(st[st.length - 1].getBoundingClientRect().bottom),
        chart: Math.round(d.querySelector('svg.chart').getBoundingClientRect().bottom), scroll: d.scrollWidth - d.clientWidth}; }""")
    check(f"shot 02: drawer for {st['name']}", st["open"] and st["pill"] == "FARM", st["pill"])
    check("shot 02: waterfall recompute matches board", "✓ board" in st["rec"], st["rec"][-30:])
    check("shot 02: 7 plan steps and the sensitivity chart above the fold", st["steps"] == 7 and st["last"] <= H and st["chart"] <= H, (st["last"], st["chart"]))
    check("shot 02: drawer has no horizontal overflow", st["scroll"] <= 0, st["scroll"])
    shot("02-protocol-detail-farm-plan.jpg")
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)

    # ---- 03 filtered: FARM verdicts in the emerging radar, sorted by net APR
    page.select_option("#seg", "E")
    page.click("button[data-v='FARM']")
    page.click("th[data-sort='apr']")
    page.wait_for_timeout(200)
    layout("shot 03")
    shot("03-filtered-emerging-radar.jpg")
    page.click("#reset")

    # ---- 04 methodology
    page.click("button[data-tab='method']")
    page.wait_for_timeout(300)
    st = page.evaluate("() => ({loo: document.querySelectorAll('.mgrid svg.chart circle').length, heat: document.querySelectorAll('.heat td').length})")
    check("shot 04: 87 blind LOO points and the k x d grid", st["loo"] == 87 and st["heat"] == 16, st)
    layout("shot 04")
    shot("04-model-methodology.jpg")
    browser.close()

server.shutdown()
off = [u for u in requests if not u.startswith(BASE)]
check("network: every request stays on 127.0.0.1", not off, off[:3])
check("console: zero errors", not errors, errors[:3])
print(f"\n{'E2E PASS' if not fails else str(len(fails)) + ' FAILURES: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
