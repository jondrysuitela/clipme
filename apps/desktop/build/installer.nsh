!macro customInstall
  CreateShortCut "$DESKTOP\ClipMe.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\ClipMe Launcher.vbs"' "$INSTDIR\ClipMe.exe" 0
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\ClipMe.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\ClipMe Launcher.vbs"' "$INSTDIR\ClipMe.exe" 0
!macroend
