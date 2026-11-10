$launcher=Join-Path $PSScriptRoot 'plugins\comfy-direct-windows\scripts\launch.ps1'
& powershell.exe -NoProfile -File $launcher configure --wizard
