param([ValidateSet('connect','configure','check','list')][string]$Action='connect')
$ErrorActionPreference='Stop'
$runtime=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-location.json') -Raw -Encoding UTF8 | ConvertFrom-Json).node
$env:COMFY_DIRECT_CONFIG=Join-Path $PSScriptRoot 'data\config.json'
$env:COMFY_DIRECT_DATA_DIR=Join-Path $PSScriptRoot 'data'
$env:COMFY_DIRECT_ENDPOINT=$null
$arguments=@($Action); if($Action -eq 'configure'){$arguments+='--wizard'}
& $runtime (Join-Path $PSScriptRoot 'bin.mjs') @arguments
exit $LASTEXITCODE
