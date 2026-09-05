#Requires -Version 5.1
<#
  一键启动 Index 学习岛（Windows / PowerShell）
  ============================================
  单进程 TypeScript 全栈：页面与 API 由同一个 Node.js 进程提供。

  兼容性修复（任意设备均可运行）：
    - 依赖安装优先使用 npm.cmd，不可用时回退 node 直接调用 npm-cli.js，
      完全绕过部分 Windows 环境下 npm.ps1 的 $LASTEXITCODE 异常
    - 启动直接调用 node 运行脚本，不经过 npm run
    - npm 命令退出码检查，失败时给出明确错误提示

  用法：
    .\start.ps1                 # Web 模式启动（http://localhost:5173）
    .\start.ps1 -Desktop        # 启动 Electron 桌面端
    .\start.ps1 -Port 5174      # 自定义端口
    .\start.ps1 -Refresh        # 强制重新安装依赖
    .\start.ps1 -SkipInstall    # 跳过依赖安装（环境已就绪时更快）

  按 Ctrl+C 退出（Electron 模式关闭窗口即退出）。
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

# ============ 1. Node.js 检查（>= 22） ============
Write-Host "`n=== 环境检查 ===" -ForegroundColor Cyan
try {
  $NodeVersion = (& node -p "process.versions.node").Trim()
} catch {
  Write-Host "[错误] 未找到 Node.js，请安装 Node.js 22+（https://nodejs.org/）并勾选 Add to PATH。" -ForegroundColor Red
  exit 1
}
$parts = $NodeVersion.Split(".")
if ([int]$parts[0] -lt 22) {
  Write-Host "[错误] Index 学习岛需要 Node.js 22+。当前版本：v$NodeVersion" -ForegroundColor Red
  exit 1
}
Write-Host "检测到 Node.js v$NodeVersion" -ForegroundColor DarkGray

# ============ 2. 定位 node 与 npm（优先 npm.cmd，绕过 npm.ps1） ============
$NodeExe = (Get-Command node -ErrorAction Stop).Source
$NodeDir = Split-Path $NodeExe -Parent
$NpmCli = Join-Path $NodeDir "node_modules\npm\bin\npm-cli.js"
$HasNpmCmd = [bool](Get-Command npm.cmd -ErrorAction SilentlyContinue)
if (-not $HasNpmCmd -and -not (Test-Path $NpmCli)) {
  Write-Host "[错误] 未找到 npm（npm.cmd 与 npm-cli.js 均不存在），请重装 Node.js。" -ForegroundColor Red
  exit 1
}

function Invoke-Npm {
  param([string[]]$NpmArgs)
  if ($HasNpmCmd) {
    & npm.cmd @NpmArgs
  } else {
    & node $NpmCli @NpmArgs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "npm 命令执行失败（退出码 $LASTEXITCODE）：npm $($NpmArgs -join ' ')"
  }
}

# ============ 3. 参数兼容 ============
if ($FrontendPort -gt 0) { $Port = $FrontendPort }
if ($BackendPort -gt 0) {
  Write-Host "提示：BackendPort 已废弃，TS 全栈服务统一使用端口 $Port。" -ForegroundColor Yellow
}

# ============ 4. 依赖安装 ============
if ($Refresh -or -not (Test-Path (Join-Path $ProjectDir "node_modules"))) {
  if ($SkipInstall) {
    Write-Host "[错误] 未找到项目依赖（node_modules 不存在），请移除 -SkipInstall 后重试。" -ForegroundColor Red
    exit 1
  }
  Write-Host "`n=== 安装依赖（npm install，首次可能需要几分钟）===" -ForegroundColor Cyan
  Push-Location $ProjectDir
  try {
    Invoke-Npm @("install")
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败（退出码 $LASTEXITCODE）" }
  } catch {
    Write-Host "[错误] $($_.Exception.Message)" -ForegroundColor Red
    Pop-Location
    exit 1
  }
  Pop-Location
}

# ============ 5. 启动 ============
$env:PORT = "$Port"
Write-Host ""
if ($Desktop) {
  Write-Host "=== 启动 Index 学习岛 Electron 桌面端 ===" -ForegroundColor Cyan
  Write-Host "桌面端窗口即将打开；关闭窗口即退出。"
  Push-Location $ProjectDir
  try {
    & node "scripts\dev-desktop.mjs"
  } finally {
    Pop-Location
  }
} else {
  Write-Host "=== 启动 Index 学习岛 TS 全栈服务 (Web 模式) ===" -ForegroundColor Cyan
  Write-Host "页面与 API：http://localhost:$Port"
  Write-Host "按 Ctrl+C 退出"
  Push-Location $ProjectDir
  try {
    & node --experimental-strip-types "src\runtime\dev.ts"
  } finally {
    Pop-Location
  }
}
