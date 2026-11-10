param([Parameter(Position=0)][string]$Action='mcp',[Parameter(ValueFromRemainingArguments=$true)][string[]]$ToolArgs)
$ErrorActionPreference='Stop'
$toolRoot=if($env:COMFY_DIRECT_HOME){$env:COMFY_DIRECT_HOME}else{Join-Path $env:LOCALAPPDATA 'CodexComfyDirect'}
$toolArch=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}
$toolNode=Join-Path $toolRoot ("runtime\node-v24.22.2-win-"+$toolArch+'\node.exe')
if(-not(Test-Path -LiteralPath $toolNode)) {
  $candidate=Get-Command node.exe -ErrorAction SilentlyContinue
  if(-not $candidate){throw '先运行分发包中的 安装插件-Windows.ps1，准备本地运行环境。'}
  $toolNode=$candidate.Source
}
& $toolNode -e 'const [a,b]=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'
if($LASTEXITCODE -ne 0){throw 'Node.js 需要 22.18 或更高版本；请运行安装脚本。'}
if(-not $env:COMFY_DIRECT_DATA_DIR){$env:COMFY_DIRECT_DATA_DIR=Join-Path $toolRoot 'data'}
if(-not $env:COMFY_DIRECT_CONFIG){$env:COMFY_DIRECT_CONFIG=Join-Path $env:COMFY_DIRECT_DATA_DIR 'config.json'}
$entry=Join-Path (Split-Path $PSScriptRoot -Parent) 'server\bin.mjs'
& $toolNode $entry $Action @ToolArgs
exit $LASTEXITCODE
