#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
DOTNET_BIN="${DOTNET_BIN:-dotnet}"
MAKENSIS_BIN="${MAKENSIS_BIN:-makensis}"
PUBLISH_DIR="$(pwd)/windows/publish"
OUTPUT_DIR="${OUTPUT_DIR:-$(pwd)/windows/release}"
BOOTSTRAPPER="$(pwd)/windows/deps/MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
mkdir -p "$OUTPUT_DIR" "$(dirname "$BOOTSTRAPPER")"
if [ ! -s "$BOOTSTRAPPER" ]; then
  curl -fL --retry 2 -o "$BOOTSTRAPPER" 'https://go.microsoft.com/fwlink/p/?LinkId=2124703'
fi
"$DOTNET_BIN" publish windows/DeltaForce.Harmonica.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o "$PUBLISH_DIR"
"$MAKENSIS_BIN" "-DPUBLISH_DIR=$PUBLISH_DIR" "-DOUT_DIR=$OUTPUT_DIR" "-DBOOTSTRAPPER=$BOOTSTRAPPER" windows/Installer.nsi
printf 'Windows installer: %s\n' "$OUTPUT_DIR/三角洲口风琴自动演奏器-安装程序-x64.exe"
