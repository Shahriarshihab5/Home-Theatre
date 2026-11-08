' Starts the Home Movie Theatre server silently at Windows logon.
' The main logic lives in start-movie-theatre.ps1 next to this file.
Option Explicit

Dim shell, fso, here, script
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(here, "start-movie-theatre.ps1")

shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Quiet", 0, False
