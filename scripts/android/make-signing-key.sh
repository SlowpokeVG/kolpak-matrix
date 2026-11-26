#!/usr/bin/env bash
# Kolpak: make a new Android signing key, and print what to put in the GitHub secrets.
#
# Kolpak's current release key lives in src-tauri/gen/android/signing (kept in the repo on
# the owner's call). Use this script only to start over with a private key, knowing that
# Android installs an update only when it is signed with the same key as the installed app:
# a new key means everyone uninstalls and installs again. To keep the current key but take
# it out of the repo, put it into the secrets instead (base64 of signing/kolpak-release.jks,
# alias and password from signing/kolpak-release.properties) and delete that folder.
#
#   scripts/android/make-signing-key.sh [output.jks]
#
# Then, in the repository's Settings → Secrets and variables → Actions, add:
#   ANDROID_KEY_BASE64    the base64 printed below
#   ANDROID_KEY_ALIAS     kolpak
#   ANDROID_KEY_PASSWORD  the password you typed
# or with the GitHub CLI:
#   gh secret set ANDROID_KEY_BASE64 < kolpak-release.jks.b64
#   gh secret set ANDROID_KEY_ALIAS --body kolpak
#   gh secret set ANDROID_KEY_PASSWORD
set -euo pipefail

OUT="${1:-kolpak-release.jks}"
ALIAS=kolpak

if [ -e "$OUT" ]; then
  echo "$OUT already exists; not overwriting a signing key." >&2
  exit 1
fi

read -r -s -p "Password for the new key (at least 6 characters): " PASSWORD
echo
read -r -s -p "Again: " AGAIN
echo
[ "$PASSWORD" = "$AGAIN" ] || { echo "The passwords differ." >&2; exit 1; }
[ "${#PASSWORD}" -ge 6 ] || { echo "Too short." >&2; exit 1; }

# One password for the store and the key: the Gradle config (keystore.properties) uses one.
keytool -genkeypair -v \
  -keystore "$OUT" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASSWORD" -keypass "$PASSWORD" \
  -dname "CN=Kolpak, O=KLPQ"

base64 -w0 "$OUT" > "$OUT.b64" 2>/dev/null || base64 -i "$OUT" -o "$OUT.b64"
echo
echo "Key: $OUT (alias $ALIAS). Base64 for ANDROID_KEY_BASE64: $OUT.b64"
echo "Delete $OUT.b64 once the secret is set; keep $OUT and the password backed up."
