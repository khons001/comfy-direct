param(
 [string]$Destination=(Join-Path $env:LOCALAPPDATA 'ComfyDirect'),
 [string]$SshCommand,
 [string]$Endpoint,
 [switch]$PrepareOnly,
 [switch]$ForcePortableRuntime
)
$ErrorActionPreference='Stop'
$toolRoot=[IO.Path]::GetFullPath($Destination)
& (Join-Path $PSScriptRoot 'setup\prepare-windows.ps1') -Destination $toolRoot -PrepareOnly -ForcePortableRuntime:$ForcePortableRuntime
$toolNode=(Get-Content -LiteralPath (Join-Path $toolRoot 'runtime-location.json') -Raw -Encoding UTF8 | ConvertFrom-Json).node
$entry=Join-Path $toolRoot 'bin.mjs'
$oldConfig=$env:COMFY_DIRECT_CONFIG; $oldData=$env:COMFY_DIRECT_DATA_DIR; $oldEndpoint=$env:COMFY_DIRECT_ENDPOINT
try {
 $env:COMFY_DIRECT_CONFIG=Join-Path $toolRoot 'data\config.json'
 $env:COMFY_DIRECT_DATA_DIR=Join-Path $toolRoot 'data'
 $env:COMFY_DIRECT_ENDPOINT=$null
 $arguments=@('configure')
 if($SshCommand){$arguments+=@('--ssh-command',$SshCommand)}
 if($Endpoint){$arguments+=@('--endpoint',$Endpoint)}
 if(-not $PrepareOnly -and -not $SshCommand -and -not $Endpoint -and -not(Test-Path -LiteralPath $env:COMFY_DIRECT_CONFIG)){$arguments+='--wizard'}
 if(-not $PrepareOnly -or $SshCommand -or $Endpoint -or (Test-Path -LiteralPath $env:COMFY_DIRECT_CONFIG)){
  & $toolNode $entry @arguments
  if($LASTEXITCODE -ne 0){throw '连接配置未完成。'}
 }
 & $toolNode (Join-Path $toolRoot 'export-mcp.mjs') $toolRoot $toolNode
 if($LASTEXITCODE -ne 0){throw 'MCP配置导出失败。'}
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup\manage-windows.ps1') -Destination (Join-Path $toolRoot '管理连接.ps1') -Force
 Write-Host ('安装完成。将 '+(Join-Path $toolRoot 'mcp-client.json')+' 中的工具配置添加到支持本地 stdio MCP 的客户端。')
 Write-Host '没有修改任何 Agent 客户端配置，没有连接服务器，也没有生成视频。'
} finally {$env:COMFY_DIRECT_CONFIG=$oldConfig; $env:COMFY_DIRECT_DATA_DIR=$oldData; $env:COMFY_DIRECT_ENDPOINT=$oldEndpoint}
