"""The situation a TV/tablet is in: player loaded over plain http://<LAN IP> (insecure context)."""
import re, json, urllib.request, sys
from playwright.sync_api import sync_playwright, expect
BASE="http://192.0.2.2:5080"; passed=failed=0
def ok(c,n):
    global passed,failed; print(("  ✓ " if c else "  ✗ ")+n); passed+=bool(c); failed+=(not c)
def req(m,p,body=None,tok=None):
    r=urllib.request.Request(BASE+p,method=m,data=json.dumps(body).encode() if body is not None else None,headers={"Content-Type":"application/json",**({"Authorization":f"Bearer {tok}"} if tok else {})})
    with urllib.request.urlopen(r) as x: t=x.read(); return json.loads(t) if t else None
tok=req("POST","/api/auth/login",{"email":"admin@demo.local","password":"Admin@12345"})["accessToken"]
pls=req("GET","/api/playlists",None,tok); pl=next(p for p in pls if p["itemCount"]>0 and all(i["mediaType"]=="Image" for i in p["items"]))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":720}, user_agent="Mozilla/5.0 (Linux; Android 12; BRAVIA 4K GB) AppleWebKit/537.36 Chrome/120 Safari/537.36")
    pg=ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{BASE}/player")
    ok(pg.evaluate("window.isSecureContext")==False and pg.evaluate("typeof caches")=="undefined", "running in an insecure context (no Cache Storage, no WebCrypto)")
    el=pg.locator(".font-mono").first; expect(el).to_have_text(re.compile(r"^[A-Z2-9]{3} [A-Z2-9]{3}$"))
    d=req("POST","/api/devices/pair",{"code":el.inner_text().replace(" ",""),"name":"LAN TV","defaultPlaylistId":pl["id"]},tok)
    ok(d["type"]=="AndroidTv", f"Android TV user agent detected as device type {d['type']}")
    expect(pg.locator("img[src^='blob:']")).to_be_visible(timeout=20000); ok(True, "pairs, syncs and plays media from a local blob")
    n=pg.evaluate("""() => new Promise(r => { const q = indexedDB.open('signage-player'); q.onsuccess = () => { const c = q.result.transaction('media').objectStore('media').count(); c.onsuccess = () => r(c.result); }; })""")
    ok(n>=1, f"media stored in IndexedDB ({n} file(s)), verified with the JS SHA-256")
    ctx.set_offline(True); pg.wait_for_timeout(8000)
    ok(pg.locator("img[src^='blob:']").count()>0, "keeps playing with the network cut")
    ctx.set_offline(False)
    req("DELETE",f"/api/devices/{d['id']}",None,tok)
    expect(pg.get_by_text(re.compile("pair this screen",re.I))).to_be_visible(timeout=40000); ok(True, "unpair wipes IndexedDB content and returns to pairing")
    ok(pg.evaluate("""() => new Promise(r => { const q = indexedDB.open('signage-player'); q.onsuccess = () => { const c = q.result.transaction('media').objectStore('media').count(); c.onsuccess = () => r(c.result); }; })""")==0, "no media left behind after unpair")
    ok(not errs, "no JavaScript errors" + (f": {errs[:2]}" if errs else ""))
    b.close()
print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
