$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskPort = 8765
$taskUrl = "http://127.0.0.1:$taskPort"
try {
    $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 2
    if ($taskHealth.app -eq 'speaking-room') {
        $taskEdge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
        if (Test-Path -LiteralPath $taskEdge) {
            Start-Process -FilePath $taskEdge -ArgumentList "--app=$taskUrl" -WindowStyle Hidden
        } else {
            Start-Process $taskUrl
        }
        exit
    }
} catch {}
try {
    $taskPython = @(
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $taskPython) {
        $taskPython = (Get-Command python.exe -ErrorAction Stop).Source
    }
    $taskServer = Join-Path $taskRoot 'server.py'
    $taskData = Join-Path $taskRoot 'data'
    New-Item -Path $taskData -ItemType Directory -Force | Out-Null
    Start-Process -FilePath $taskPython -ArgumentList @("`"$taskServer`"", '--open', '--port', $taskPort) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'server-error.log')
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Startup failed. See data/server-error.log. Python 3.10+ is required.`n$($_.Exception.Message)", 'Speaking Room') | Out-Null
}
