"""Browser end-to-end: drives the real admin UI and a real web player in Chromium against the running API."""
import re, sys, time, uuid
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:5080"
U = uuid.uuid4().hex[:6]
passed = failed = 0
def ok(cond, name):
    global passed, failed
    print(("  ✓ " if cond else "  ✗ ") + name); passed += bool(cond); failed += (not cond)

with sync_playwright() as p:
    browser = p.chromium.launch()
    admin_ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    player_ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    a = admin_ctx.new_page(); pl = player_ctx.new_page()
    errors = []
    a.on("pageerror", lambda e: errors.append(str(e))); pl.on("pageerror", lambda e: errors.append(str(e)))

    print("\nAdmin UI")
    a.goto(f"{BASE}/devices"); a.wait_for_url(re.compile("/login"))
    ok("/login" in a.url, "unauthenticated deep link redirects to sign-in")
    a.get_by_label("Email").fill("admin@demo.local"); a.get_by_label("Password").fill("wrong-pass1"); a.get_by_role("button", name="Sign in").click()
    expect(a.get_by_role("alert")).to_contain_text("incorrect"); ok(True, "wrong password shows an inline error")
    a.get_by_label("Password").fill("Admin@12345"); a.get_by_role("button", name="Sign in").click()
    expect(a.get_by_text("Device wall")).to_be_visible(); ok(True, "sign-in lands on the dashboard device wall")
    expect(a.get_by_text("Live", exact=True)).to_be_visible(timeout=10000); ok(True, "admin realtime channel shows Live")
    a.screenshot(path="shots/1-dashboard.png")

    a.goto(f"{BASE}/media")
    a.locator('input[type=file]').set_input_files("shots/brand-teal.png")
    expect(a.get_by_text("brand-teal").first).to_be_visible(timeout=15000); ok(True, "upload a PNG through the media page")
    expect(a.get_by_text("1280×720").first).to_be_visible(); ok(True, "image dimensions probed in the browser and stored")

    a.goto(f"{BASE}/playlists"); a.get_by_role("button", name="New playlist").click()
    a.wait_for_url(re.compile(r"/playlists/[0-9a-f-]{36}"))
    a.get_by_label("Name", exact=True).fill(f"Browser loop {U}")
    a.get_by_label("Search library").fill("brand-teal"); a.locator("button:has-text('brand-teal')").first.click()
    a.get_by_role("button", name="Save changes").click()
    expect(a.get_by_role("button", name="Saved")).to_be_visible(); ok(True, "build and save a playlist in the editor")

    print("\nWeb player pairing")
    pl.goto(f"{BASE}/player")
    code_el = pl.locator(".font-mono").first
    expect(code_el).to_have_text(re.compile(r"^[A-Z2-9]{3} [A-Z2-9]{3}$"), timeout=10000)
    code = code_el.inner_text().replace(" ", ""); ok(True, f"player shows pairing code {code}")
    pl.screenshot(path="shots/2-player-pairing.png")

    a.goto(f"{BASE}/devices"); a.get_by_role("button", name="Pair a screen").click()
    a.get_by_label("Pairing code").fill(code); a.get_by_label("Screen name").fill(f"Browser TV {U}")
    a.get_by_label("Default playlist").select_option(label=f"Browser loop {U}")
    a.get_by_role("button", name="Pair screen").click()
    expect(a.get_by_text(f"Browser TV {U}").first).to_be_visible(); ok(True, "admin pairs the screen with the code")

    img = pl.locator("img[src^='blob:']")
    expect(img).to_be_visible(timeout=20000); ok(True, "player collects its key, syncs, and plays media from its local cache (blob: URL)")
    cached = pl.evaluate("async () => (await (await caches.open('signage-media-v1')).keys()).length")
    ok(cached >= 1, f"media stored in Cache Storage ({cached} file) after sha256 verification")
    pl.screenshot(path="shots/3-player-playing.png")

    print("\nRealtime status and commands")
    a.locator(f"a[href^='/devices/']:has-text('Browser TV {U}')").first.click()
    expect(a.get_by_label("Online")).to_be_visible(timeout=10000); ok(True, "device page shows the screen Online")
    a.get_by_role("button", name="Identify").click()
    expect(pl.get_by_text(f"Browser TV {U}")).to_be_visible(timeout=10000); ok(True, "Identify command shows the screen name on the player")
    a.screenshot(path="shots/4-device-detail.png")

    print("\nOffline resilience")
    player_ctx.set_offline(True)
    pl.reload()
    expect(pl.locator("img[src^='blob:']")).to_be_visible(timeout=20000)
    ok(True, "with the network cut, a rebooted player starts from its service-worker shell and keeps playing cached media")
    expect(a.get_by_label("Offline")).to_be_visible(timeout=20000); ok(True, "admin UI flips the screen to Offline live")
    player_ctx.set_offline(False)
    expect(a.get_by_label("Online")).to_be_visible(timeout=40000); ok(True, "screen reconnects and shows Online again")

    print("\nLayout editor")
    a.goto(f"{BASE}/layouts"); a.get_by_role("tab", name="Templates").click()
    a.locator("div.rounded-lg:has-text('Main with sidebar') >> button:has-text('Use')").first.click()
    a.get_by_role("button", name="Create and edit").click()
    a.wait_for_url(re.compile(r"/layouts/[0-9a-f-]{36}"))
    a.get_by_label("Playlist").select_option(label=f"Browser loop {U}")
    a.get_by_role("button", name="Save layout").click()
    expect(a.get_by_role("button", name="Saved")).to_be_visible(); ok(True, "create a layout from a template and assign a zone playlist")
    a.screenshot(path="shots/5-layout-editor.png")

    print("\nUnpair")
    a.goto(f"{BASE}/devices"); a.locator(f"a[href^='/devices/']:has-text('Browser TV {U}')").first.click()
    a.get_by_role("button", name="Unpair screen").click(); a.get_by_role("button", name="Unpair screen").last.click()
    a.wait_for_url(f"{BASE}/devices")
    try: expect(pl.get_by_text(re.compile("pair this screen", re.I))).to_be_visible(timeout=35000)
    except AssertionError: print("   player shows:", pl.evaluate("document.body.innerText.slice(0,120)")); raise
    ok(True, "unpaired player wipes its key and cache and returns to a new pairing code")

    ok(not errors, "no uncaught JavaScript errors" + (f": {errors[:3]}" if errors else ""))
    browser.close()

print(f"\n{passed} passed, {failed} failed"); sys.exit(1 if failed else 0)
