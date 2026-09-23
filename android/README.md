# Signage Player for Android TV and Android tablets

One APK for both. On a TV it appears in the TV launcher with a banner; on a tablet it appears in the app drawer.
It wraps the web player (`/player`) in a kiosk shell that adds:

- full screen with the system bars hidden, and the screen kept awake (this also stops the TV screensaver)
- start on boot, so a screen recovers from power cuts by itself
- automatic retry when the server can't be reached, and offline start from the WebView cache
- real device info reported to the CMS: Android TV vs tablet, make/model, Android version, a stable hardware ID
- videos autoplay without a tap; the remote's Back button can't exit the player

Supports Android 5.0 (API 21) and newer, signed with APK Signature Scheme v1+v2+v3.

## Install

**First, make the server reachable from the screen.** The API must listen on the network, not just localhost:
`dotnet run` already binds `0.0.0.0:5080` (see launchSettings.json). Allow port 5080 through the server's firewall.
From the TV's or tablet's browser, `http://<server-ip>:5080/health` should show `Healthy`.

**Android tablet**
1. Open `http://<server-ip>:5080/downloads/signage-player.apk` in Chrome on the tablet (or use Settings → Connect a screen → Download Android app).
2. Allow "Install unknown apps" for Chrome when asked, then install.

**Android TV / Google TV**
1. Settings → Device Preferences → About → click "Build" 7 times to enable developer options. Then Security & restrictions → allow Unknown sources for your installer app.
2. Install the free **Downloader** app (by AFTVnews) from the Play Store, open it, and enter `http://<server-ip>:5080/downloads/signage-player.apk`.
   Or, from a computer: `adb connect <tv-ip>` then `adb install signage-player.apk`.

**Then, on the screen:**
1. Open **Signage Player**, enter the server address (e.g. `192.168.1.10:5080`), and press **Connect**. The app checks `/health` before saving it.
2. On Android 10+, press **Allow start on boot** and turn on "Display over other apps". Without it, Android blocks apps from opening themselves after a reboot.
3. The screen shows a 6-character code. In the CMS: Devices → Pair a screen → enter the code.

**Hidden menu:** press **Back three times quickly** (or the Menu key) for: reload, change server, turn start-on-boot on or off, and exit.

## Recommended device settings for 24/7 screens
- Turn off the TV's own sleep timer, eco/auto power-off and "no signal" standby.
- On tablets: set Screen timeout to the maximum and keep the tablet on a charger.
- For locked-down kiosks, use Android screen pinning, or an MDM with kiosk mode, to pin Signage Player.

## Build from source (no Gradle needed)
```bash
sudo apt install android-sdk android-sdk-platform-23 dalvik-exchange openjdk-17-jdk-headless
./build.sh                      # → build/signage-player.apk
cp build/signage-player.apk ../frontend/public/downloads/   # so the CMS serves the new version
```
`build.sh` creates `keystore/signage-player.jks` on first run. **Keep that file and its password** (`KEYSTORE_PASS`, default `signage-player`): Android only installs updates signed with the same key. For production, create your own key (`KEYSTORE=... KEYSTORE_PASS=... ./build.sh`) and don't commit it.

## Notes and limits
- The app targets API 23, the level this Gradle-free toolchain supports. Sideloading works on all current Android versions, but Google Play requires a newer target, so publishing to Play means porting to a Gradle/Android Studio project (the code is plain Java with no dependencies, so that's quick).
- Over plain `http://` the player stores media in IndexedDB and verifies checksums with a built-in SHA-256, because browsers disable Cache Storage and WebCrypto on non-HTTPS origins. Serving the CMS over HTTPS works too.
- Web-page media needs the network; images and videos are fully cached for offline playback.
- Use H.264/AAC MP4 for video. It is the only format every Android TV decodes in hardware.
- Tested here: APK build, signing and manifest checks, and the web player in Chromium under exactly the conditions the app creates (plain HTTP on a LAN IP, Android TV user agent, network loss). It was **not** run on a physical TV or an emulator, because none is available in this build environment. Please try it on one screen before rolling out.
