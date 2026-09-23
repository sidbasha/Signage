#!/usr/bin/env python3
"""
Parses every ```mermaid block in docs/*.md with the real Mermaid parser (headless Chromium) and renders each to SVG.
Usage: python3 docs/_tools/validate_mermaid.py [path/to/mermaid.min.js]
Needs: pip install playwright && playwright install chromium ; npm install mermaid@11 (for mermaid.min.js)
"""
import pathlib, re, sys, json
from playwright.sync_api import sync_playwright
DOCS = pathlib.Path(__file__).resolve().parents[1]
MM = sys.argv[1] if len(sys.argv) > 1 else "node_modules/mermaid/dist/mermaid.min.js"
blocks = []
for f in sorted(DOCS.rglob("*.md")):
    for i, m in enumerate(re.finditer(r"```mermaid\n(.*?)```", f.read_text(), re.S)):
        blocks.append((f"{f.relative_to(DOCS)}#{i + 1}", m.group(1)))
bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.set_content("<html><body></body></html>"); pg.add_script_tag(path=MM)
    pg.evaluate("mermaid.initialize({startOnLoad:false, securityLevel:'strict', maxTextSize: 200000})")
    for name, src in blocks:
        res = pg.evaluate("""async (src) => { try { await mermaid.parse(src); const r = await mermaid.render('m' + Math.random().toString(36).slice(2), src);
                              return {ok: true, size: r.svg.length}; } catch (e) { return {ok: false, err: String(e.message || e).slice(0, 300)}; } }""", src)
        if not res["ok"]: bad += 1; print(f"✗ {name}: {res['err']}")
    b.close()
print(f"{len(blocks) - bad}/{len(blocks)} Mermaid diagrams parse and render"); sys.exit(1 if bad else 0)
