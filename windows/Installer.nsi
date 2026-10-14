Unicode true
!include "MUI2.nsh"
!include "x64.nsh"

!ifndef PUBLISH_DIR
  !error "Pass /DPUBLISH_DIR=<absolute publish folder>"
!endif
!ifndef OUT_DIR
  !error "Pass /DOUT_DIR=<absolute output folder>"
!endif
!ifndef BOOTSTRAPPER
  !error "Pass /DBOOTSTRAPPER=<absolute WebView2 bootstrapper>"
!endif

Name "三角洲口风琴自动演奏器"
OutFile "${OUT_DIR}/三角洲口风琴自动演奏器-安装程序-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\DeltaForceHarmonica"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!define PRODUCT_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeltaForceHarmonica"
!define WEBVIEW_KEY "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW_KEY_MACHINE "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "本安装包需要 64 位 Windows。"
    Abort
  ${EndIf}
FunctionEnd

Section "安装" SecMain
  SetOutPath "$INSTDIR"
  File "${PUBLISH_DIR}/DeltaForceHarmonica.exe"
  File /oname=MicrosoftEdgeWebView2RuntimeInstallerX64.exe "${BOOTSTRAPPER}"
  SetOutPath "$INSTDIR\www"
  File /r "${PUBLISH_DIR}/www/*.*"
  SetOutPath "$INSTDIR"

  ; WebView2 Runtime is an official Microsoft prerequisite, installed per user
  ; only when the documented Evergreen Runtime registry version is missing.
  SetRegView 64
  ReadRegStr $0 HKCU "${WEBVIEW_KEY}" "pv"
  StrCmp $0 "" 0 runtime_check_version
  ReadRegStr $0 HKLM "${WEBVIEW_KEY_MACHINE}" "pv"
runtime_check_version:
  StrCmp $0 "" runtime_install
  StrCmp $0 "0.0.0.0" runtime_install
  Goto runtime_ready
runtime_install:
  DetailPrint "正在安装 Microsoft Edge WebView2 Runtime..."
  ExecWait '"$INSTDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $1
  ReadRegStr $0 HKCU "${WEBVIEW_KEY}" "pv"
  StrCmp $0 "" 0 runtime_after_install
  ReadRegStr $0 HKLM "${WEBVIEW_KEY_MACHINE}" "pv"
runtime_after_install:
  StrCmp $0 "" runtime_failed
  StrCmp $0 "0.0.0.0" runtime_failed
  Goto runtime_ready
runtime_failed:
  MessageBox MB_ICONSTOP "WebView2 Runtime 未能安装。请联网后重新运行安装程序。"
  Abort
runtime_ready:
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\三角洲口风琴自动演奏器.lnk" "$INSTDIR\DeltaForceHarmonica.exe"
  CreateShortcut "$SMPROGRAMS\三角洲口风琴自动演奏器.lnk" "$INSTDIR\DeltaForceHarmonica.exe"
  WriteRegStr HKCU "${PRODUCT_KEY}" "DisplayName" "三角洲口风琴自动演奏器"
  WriteRegStr HKCU "${PRODUCT_KEY}" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "${PRODUCT_KEY}" "Publisher" "DeltaForceHarmonica"
  WriteRegStr HKCU "${PRODUCT_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${PRODUCT_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${PRODUCT_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\三角洲口风琴自动演奏器.lnk"
  Delete "$SMPROGRAMS\三角洲口风琴自动演奏器.lnk"
  Delete "$INSTDIR\DeltaForceHarmonica.exe"
  Delete "$INSTDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\www"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${PRODUCT_KEY}"
  ; Keep the user's imported scores and favorites in WebView2's profile.
SectionEnd
