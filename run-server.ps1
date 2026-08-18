Set-Location $PSScriptRoot
$node = if (Get-Command node -ErrorAction SilentlyContinue) { (Get-Command node).Source }
         elseif (Test-Path "C:\Program Files\nodejs\node.exe") { "C:\Program Files\nodejs\node.exe" }
         elseif (Test-Path "$env:LOCALAPPDATA\Programs\nodejs\node.exe") { "$env:LOCALAPPDATA\Programs\nodejs\node.exe" }
         else { throw "Node.js tidak ditemukan. Install dari https://nodejs.org lalu jalankan ulang." }
& $node "$PSScriptRoot\server.js" *> "$PSScriptRoot\server.log"
