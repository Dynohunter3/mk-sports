#!/usr/bin/env bash
# Build an installable, release-signed MK Sports APK.
#
#   ./scripts/build-apk.sh
#
# Needs: JDK 17 (React Native's Gradle plugin compiles with a Java 17 toolchain; newer JDKs alone
# are not enough), Node 20+, network access to dl.google.com (Android SDK), maven.google.com,
# repo1.maven.org and services.gradle.org. The Android SDK is installed into
# $ANDROID_HOME (default ~/android-sdk) on first run.
#
# Signing: set PREDICTPRO_UPLOAD_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD in
# ~/.gradle/gradle.properties to sign with your release key (otherwise the debug key is used,
# which installs fine but can't be used to publish updates).
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
CMDLINE_TOOLS_ZIP="commandlinetools-linux-13114758_latest.zip"
PLATFORM="platforms;android-37.0"  # the SDK names this platform 37.0
BUILD_TOOLS="build-tools;37.0.0"
NDK="ndk;27.1.12297006"
CMAKE="cmake;3.22.1"

if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "==> Installing Android command-line tools into $ANDROID_HOME"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  tmp="$(mktemp -d)"
  curl -fsSL "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP" -o "$tmp/tools.zip"
  unzip -q "$tmp/tools.zip" -d "$tmp"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$tmp"
fi
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
yes | "$SDKM" --licenses >/dev/null || true
echo "==> Installing SDK packages (first run downloads ~1.5 GB)"
"$SDKM" --install "platform-tools" "$PLATFORM" "$BUILD_TOOLS" "$NDK" "$CMAKE" >/dev/null

echo "==> Installing JS dependencies"
npm ci --no-audit --no-fund

echo "==> Generating the native Android project"
EXPO_OFFLINE=1 CI=1 npx expo prebuild --platform android --clean --no-install
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

echo "==> Building the release APK"
(cd android && ./gradlew --no-daemon assembleRelease)

mkdir -p dist-apk
version=$(node -p "require('./app.json').expo.version")
out="dist-apk/MKSports-$version.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$out"
echo "==> Done: $out ($(du -h "$out" | cut -f1))"
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --print-certs "$out" | grep -E "Signer #1 certificate (DN|SHA-256)" || true
sha256sum "$out"
