#!/usr/bin/env python3
"""Checks every relative Markdown link in docs/ resolves to a file and (if given) a heading anchor (GitHub slug rules)."""
import re, pathlib, sys
DOCS = pathlib.Path(__file__).resolve().parents[1]
def slug(h):
    h = re.sub(r"<[^>]+>", "", h.strip().lower())
    h = re.sub(r"[^\w\- ]", "", h)          # drop punctuation (keeps letters, digits, _, -, space)
    return h.replace(" ", "-")
anchors = {}
for f in DOCS.rglob("*.md"):
    text = re.sub(r"```.*?```", "", f.read_text(), flags=re.S)
    anchors[f.resolve()] = {slug(m.group(1)) for m in re.finditer(r"^#{1,6} (.+)$", text, re.M)}
bad = 0; total = 0
for f in DOCS.rglob("*.md"):
    text = re.sub(r"```.*?```", "", f.read_text(), flags=re.S)
    for m in re.finditer(r"\]\(([^)\s]+)\)", text):
        link = m.group(1)
        if re.match(r"^[a-z]+:", link): continue
        total += 1
        path, _, anchor = link.partition("#")
        target = (f.parent / path).resolve() if path else f.resolve()
        if not target.exists(): bad += 1; print(f"✗ {f.name}: missing file {link}"); continue
        if anchor and target.suffix == ".md" and anchor not in anchors.get(target, set()):
            bad += 1; print(f"✗ {f.name}: missing anchor {link}")
print(f"{total - bad}/{total} internal links resolve"); sys.exit(1 if bad else 0)
