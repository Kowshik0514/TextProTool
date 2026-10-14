' TextPro launcher — starts the app with no visible console window.
' Recreate the Desktop shortcut with: npm run shortcut

Option Explicit

Dim fso, shell, root, launcher, command, exitCode

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(root, "scripts\launch.mjs")

If Not fso.FileExists(launcher) Then
    MsgBox "Could not find:" & vbCrLf & launcher, vbCritical, "TextPro"
    WScript.Quit 1
End If

shell.CurrentDirectory = root
command = "cmd /c node """ & launcher & """"

' 0 = hidden window, True = wait so a startup failure can be reported
exitCode = shell.Run(command, 0, True)

If exitCode <> 0 Then
    MsgBox "TextPro failed to start (exit code " & exitCode & ")." & vbCrLf & vbCrLf & _
           "Try running this in the project folder:" & vbCrLf & _
           "    npm run build", vbCritical, "TextPro"
End If
