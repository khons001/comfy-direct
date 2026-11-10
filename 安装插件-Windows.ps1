param([switch]$PrepareOnly,[switch]$NoConnect,[switch]$ReplaceStandalone)
$ErrorActionPreference='Stop'
$toolRoot=if($env:COMFY_DIRECT_HOME){$env:COMFY_DIRECT_HOME}else{Join-Path $env:LOCALAPPDATA 'CodexComfyDirect'}
& (Join-Path $PSScriptRoot 'setup\prepare-windows.ps1') -PrepareOnly -Destination $toolRoot
if($PrepareOnly){return}
$codexCmd=Get-Command codex -ErrorAction SilentlyContinue
if(-not $codexCmd){throw '未找到 Codex CLI。运行环境已准备；可在支持本地插件市场的 Codex 中添加此目录，或先安装 Codex CLI 后重试。'}
$configHome=if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $HOME '.codex'}
$configFile=Join-Path $configHome 'config.toml'
if(Test-Path -LiteralPath $configFile){
  $configText=[IO.File]::ReadAllText($configFile)
  if($configText -match '(?m)^\s*\[mcp_servers\.comfy_direct\]\s*$'){
    if(-not $ReplaceStandalone){throw '检测到原有 comfy_direct 独立连接，已保留。迁移时添加 -ReplaceStandalone；否则继续用原连接，不要重复安装。'}
    Copy-Item -LiteralPath $configFile -Destination ($configFile+'.before-comfy-plugin-'+[DateTime]::UtcNow.Ticks)
  }
}
& $codexCmd.Source plugin marketplace add $PSScriptRoot
if($LASTEXITCODE -ne 0){throw '添加本地插件源失败。'}
& $codexCmd.Source plugin add 'comfy-direct-windows@comfy-direct-personal'
if($LASTEXITCODE -ne 0){throw '安装插件失败。'}
if($ReplaceStandalone -and $configText -match '(?m)^\s*\[mcp_servers\.comfy_direct\]\s*$'){
  & $codexCmd.Source mcp remove comfy_direct
  if($LASTEXITCODE -ne 0){throw '插件已安装，但旧连接未移除；请保留备份排查，避免同时调用两套工具。'}
}
$launcher=Join-Path $PSScriptRoot 'plugins\comfy-direct-windows\scripts\launch.ps1'
$savedConfig=Join-Path $toolRoot 'data\config.json'
if(-not(Test-Path -LiteralPath $savedConfig)){
  & powershell.exe -NoProfile -File $launcher configure --wizard
  if($LASTEXITCODE -ne 0){throw '服务器连接信息未配置。'}
}
if(-not $NoConnect){
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NoExit','-File',('"'+$launcher+'"'),'connect') -WindowStyle Normal
}
Write-Host '插件已安装。重新加载插件或在新聊天中使用。未提交生成任务。请保留此目录作为插件来源。'
