<##
  一键启动 Index 学习岛（Windows / PowerShell）
  ============================================
  单进程 TypeScript 全栈：页面开发服务器与 API 由同一个 Node.js 进程提供。

  用法：
    .\start.ps1
    .\start.ps1 -Desktop
    .\start.ps1 -Port 5174
    .\start.ps1 -Refresh
#>
param(
  [switch]$Desktop,
  [switch]$Refresh,
  [switch]$SkipInstall,
  [int]$Port = 5173,
  # 兼容旧脚本参数；迁移后前后端共用一个端口。
  [int]$FrontendPort = 0,
  [int]$BackendPort = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = $Root

function Get-NodeMajor {
  try {
    $version = (& node -p "process.versions.node.split('.')[0]").Trim()
    return [int]$version
  } catch {
    throw "未找到 Node.js，请先安装 Node.js 22.5+。"
  }
}

$major = Get-NodeMajor
if ($major -lt 22) { throw "Index 学习岛需要 Node.js 22.5+。当前 Node.js 主版本：$major" }
if ($FrontendPort -gt 0) { $Port = $FrontendPort }
if ($BackendPort -gt 0) { Write-Host "提示：BackendPort 已废弃，TS 全栈服务统一使用端口 $Port。" -ForegroundColor Yellow }

if ($Refresh -or -not (Test-Path (Join-Path $ProjectDir "node_modules"))) {
  if ($SkipInstall) { throw "未找到项目依赖，请移除 -SkipInstall 后重试。" }
  Write-Host "首次运行：安装前端与全栈依赖…" -ForegroundColor Cyan
  Push-Location $ProjectDir
  try { & npm install } finally { Pop-Location }
}

$env:PORT = "$Port"
Push-Location $ProjectDir
try {
  if ($Desktop) {
    Write-Host "=== 启动 Index 学习岛 Electron 桌面端 ===" -ForegroundColor Cyan
    & npm run dev:desktop
  } else {
    Write-Host "=== 启动 Index 学习岛 TS 全栈服务 (Web 模式) ===" -ForegroundColor Cyan
    Write-Host "页面与 API：http://localhost:$Port"
    & npm run dev
  }
} finally { Pop-Location }
