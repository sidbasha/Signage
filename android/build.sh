#!/usr/bin/env bash
# Builds a signed APK without Gradle, using the Debian/Ubuntu Android SDK packages:
#   sudo apt install android-sdk android-sdk-platform-23 dalvik-exchange openjdk-17-jdk-headless
# Output: build/signage-player.apk
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
JAR=$SDK/platforms/android-23/android.jar
rm -rf build && mkdir -p build/gen build/classes

aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$JAR" -F build/unsigned.apk
javac -Xlint:-options --release 8 -encoding UTF-8 -classpath "$JAR" -d build/classes \
  $(find src build/gen -name '*.java') 2>&1 | grep -v "^Note:" || true
[ -n "$(find build/classes -name MainActivity.class)" ] || { echo "javac failed"; exit 1; }
dalvik-exchange --dex --min-sdk-version=21 --output=build/classes.dex build/classes
(cd build && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f 4 build/unsigned.apk build/aligned.apk

# Signing key: keep keystore/ safe. Updates must be signed with the same key or devices refuse to upgrade.
KS=${KEYSTORE:-keystore/signage-player.jks}
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -alias signage -keyalg RSA -keysize 3072 -validity 10000 \
    -storepass "${KEYSTORE_PASS:-signage-player}" -keypass "${KEYSTORE_PASS:-signage-player}" \
    -dname "CN=Signage Player, O=Signage CMS" >/dev/null 2>&1
  echo "Created signing key $KS (password: ${KEYSTORE_PASS:-signage-player})"
fi
apksigner sign --ks "$KS" --ks-key-alias signage --ks-pass "pass:${KEYSTORE_PASS:-signage-player}" --out build/signage-player.apk build/aligned.apk
apksigner verify --print-certs build/signage-player.apk | head -2
ls -la build/signage-player.apk
