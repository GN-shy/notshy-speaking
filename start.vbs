Option Explicit
Dim taskShell, taskFS, taskFolder, taskCommand
Set taskShell = CreateObject("WScript.Shell")
Set taskFS = CreateObject("Scripting.FileSystemObject")
taskFolder = taskFS.GetParentFolderName(WScript.ScriptFullName)
taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & taskFolder & "\launch.ps1"""
taskShell.Run taskCommand, 0, False
