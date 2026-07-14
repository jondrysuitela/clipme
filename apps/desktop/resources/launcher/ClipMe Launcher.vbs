Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
Set env = shell.Environment("PROCESS")

On Error Resume Next
env.Remove "ELECTRON_RUN_AS_NODE"
env.Remove "ELECTRON_NO_ATTACH_CONSOLE"
On Error GoTo 0

appDir = fs.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir
shell.Run """" & appDir & "\ClipMe.exe" & """", 1, False
