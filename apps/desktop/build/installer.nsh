; Extra steps of the Windows installer (electron-builder's NSIS template includes this file).
;
; Uninstalling keeps the person's data by default (specs/003-desktop-apps-releases, FR-008). The uninstaller asks once whether to remove it too,
; with "No" as the default answer. It never asks, and never deletes, when it runs as part of an update or silently.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also delete your Cashfold data on this computer?$\r$\n$\r$\nThis removes the accounts, transactions and settings stored here. It cannot be undone. Choose No to keep your data, for example to install Cashfold again later." IDNO cashfoldKeepData
        RMDir /r "$APPDATA\${APP_FILENAME}"
      cashfoldKeepData:
    ${endIf}
  ${endIf}
!macroend
