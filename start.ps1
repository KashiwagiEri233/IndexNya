#Requires -Version 5.1
<#
  一键启动 Index 学习岛（Windows / PowerShell）
  ============================================
  用法：
    .\start.ps1               # 启动前后端（首次自动创建虚拟环境并安装依赖）
    .\start.ps1 -Refresh      # 强制重新安装后端依赖
    .\start.ps1 -SkipInstall  # 跳过依赖安装（环境已就绪时启动更快）
    .\start.ps1 -BackendPort 8001 -FrontendPort 5174   # 自定义端口

  按 Ctrl+C 退出，脚本会自动关闭前后端进程。
#>
param(
  [switch]$Refresh,
  [switch]$SkipInstall,
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$VenvDir = Join-Path $BackendDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

function Write-Step([string]$Message) {
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Get-PythonCommand {
  # 返回可用的 python 命令名（要求 >= 3.12）
  foreach ($candidate in @("python", "py")) {
    try {
      $out = & $candidate -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
      if ($LASTEXITCODE -eq 0 -and $out) {
        $ver = [version]($out.Trim() + ".0")
        if ($ver -ge [version]"3.12.0") {
          Write-Host "检测到 Python $($out.Trim())（$candidate）" -ForegroundColor DarkGray
          return $candidate
        }
      }
    } catch { }
  }
  throw "未找到 Python 3.12+，请先安装并勾选 Add to PATH（https://www.python.org/downloads/）"
}

function Test-Node {
  try {
    $out = & npm --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) {
      Write-Host "检测到 Node.js v$out" -ForegroundColor DarkGray
      return
    }
  } catch { }
  throw "未找到 Node.js 18+，请先安装（https://nodejs.org/）"
}

# ---------- 0. 环境检查 ----------
Write-Step "环境检查"
$PyCmd = Get-PythonCommand
Test-Node

# ---------- 1. 配置文件 ----------
$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $Root ".env.example") $EnvFile
  Write-Host "已自动生成 .env（模板来自 .env.example）" -ForegroundColor Yellow
  Write-Host "如需服务端固定模型，请编辑 .env 填写 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL；也可以直接在网页「设置」中添加模型。" -ForegroundColor Yellow
}

# ---------- 2. 后端依赖 ----------
Write-Step "后端准备 (FastAPI :$BackendPort)"
if (-not (Test-Path $VenvPython)) {
  Write-Host "首次运行：创建 Python 虚拟环境..."
  & $PyCmd -m venv $VenvDir
  if ($LASTEXITCODE -ne 0) { throw "创建虚拟环境失败" }
}
$InstallMarker = Join-Path $VenvDir "Scripts\uvicorn.exe"
if (-not $SkipInstall -and ($Refresh -or -not (Test-Path $InstallMarker))) {
  Write-Host "安装后端依赖（pip install -e .）..."
  & $VenvPython -m pip install --upgrade pip --quiet
  if ($LASTEXITCODE -ne 0) { throw "pip 升级失败" }
  Push-Location $BackendDir
  try {
    & $VenvPython -m pip install -e . --quiet
    if ($LASTEXITCODE -ne 0) { throw "后端依赖安装失败" }
  } finally {
    Pop-Location
  }
}

# ---------- 3. 前端依赖 ----------
Write-Step "前端准备 (Vite :$FrontendPort)"
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
  Write-Host "首次运行：安装前端依赖（npm install，可能需要几分钟）..."
  Push-Location $FrontendDir
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "前端依赖安装失败" }
  } finally {
    Pop-Location
  }
}

# ---------- 4. 启动 ----------
Write-Step "启动服务"
$BackendProc = Start-Process -FilePath $VenvPython `
  -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--port", "$BackendPort") `
  -WorkingDirectory $BackendDir -NoNewWindow -PassThru

$FrontendProc = Start-Process -FilePath $env:ComSpec `
  -ArgumentList @("/c", "npm run dev -- --port $FrontendPort") `
  -WorkingDirectory $FrontendDir -NoNewWindow -PassThru

try {
  # 等待后端就绪（最多 30 秒）
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$BackendPort/api/health" -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if ($ready) {
    Write-Host "✅ 后端就绪：http://localhost:$BackendPort/docs" -ForegroundColor Green
  } else {
    Write-Host "⚠️ 后端未在 30 秒内就绪，请查看上方日志" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "✅ 启动完成：" -ForegroundColor Green
  Write-Host "   前端: http://localhost:$FrontendPort"
  Write-Host "   后端: http://localhost:$BackendPort/docs"
  Write-Host "   按 Ctrl+C 退出（自动关闭前后端）"

  Wait-Process -Id @($BackendProc.Id, $FrontendProc.Id) -ErrorAction SilentlyContinue
}
finally {
  Write-Host ""
  Write-Host "正在关闭前后端..."
  foreach ($proc in @($FrontendProc, $BackendProc)) {
    if ($proc -and -not $proc.HasExited) {
      & taskkill /PID $proc.Id /T /F 2>$null | Out-Null
    }
  }
  Write-Host "已退出。"
}
