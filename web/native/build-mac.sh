#!/bin/sh
set -eu
cd "$(dirname "$0")"
APP="口风琴输入助手.app"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>HarmonicaInput</string>
<key>CFBundleIdentifier</key><string>local.deltaforce.harmonica.input</string>
<key>CFBundleName</key><string>口风琴输入助手</string>
<key>CFBundleDisplayName</key><string>口风琴输入助手</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
<key>NSAccessibilityUsageDescription</key><string>按曲谱发送音阶键和鼠标修饰键，用于自动演奏。</string>
</dict></plist>
PLIST
/usr/bin/swiftc -O MacInput.swift -o "$APP/Contents/MacOS/HarmonicaInput" -framework AppKit -framework ApplicationServices -framework CoreGraphics
/usr/bin/codesign --force --sign - --identifier local.deltaforce.harmonica.input "$APP"
printf '%s\n' 'Built 口风琴输入助手.app'
