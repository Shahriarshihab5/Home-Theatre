' Starts (or reuses) the Home Movie Theatre server and opens it in the browser.
' Use this for the desktop shortcut when you want to watch on the laptop.
Option Explicit

Dim shell, fso, here, script
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(here, "start-movie-theatre.ps1")

shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Open", 0, False
