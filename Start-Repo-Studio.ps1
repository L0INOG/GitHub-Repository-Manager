$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path -LiteralPath $exe)) {
  throw 'Electron is not installed. Run "npm install" first.'
}

Start-Process -FilePath $exe -ArgumentList '.' -WorkingDirectory $root
