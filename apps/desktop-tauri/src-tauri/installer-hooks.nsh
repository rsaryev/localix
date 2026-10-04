; "Open in Localix" Explorer shell verbs for folders, folder backgrounds, and
; drives. HKCU matches the NSIS installMode "currentUser". %V = the clicked path.
; NoWorkingDirectory stops Explorer from overriding %V (it would pass System32
; on a drive right-click otherwise).
;
; The path is handed to localix.exe as a plain argv; the Rust shell's
; open_path_args (single-instance + cold-start) routes a directory to a project
; window, exactly like the `localix <path>` CLI and file associations do.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInLocalix" "" "Open in Localix"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInLocalix" "Icon" '"$INSTDIR\localix.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInLocalix" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInLocalix\command" "" '"$INSTDIR\localix.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInLocalix" "" "Open in Localix"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInLocalix" "Icon" '"$INSTDIR\localix.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInLocalix" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInLocalix\command" "" '"$INSTDIR\localix.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInLocalix" "" "Open in Localix"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInLocalix" "Icon" '"$INSTDIR\localix.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInLocalix" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInLocalix\command" "" '"$INSTDIR\localix.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInLocalix"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInLocalix"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInLocalix"
!macroend
