<#
.SYNOPSIS
    Asistente sencillo para crear y restaurar copias de seguridad de Suwayomi (DB + .tachibk).
#>
param(
    [string]$DataDir = (Join-Path $env:LOCALAPPDATA 'Tachidesk'),
    [int]$Port = 4567
)
$ErrorActionPreference = 'Stop'

$BackupDir = Join-Path $DataDir 'backups'
$DbPath    = Join-Path $DataDir 'database.mv.db'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

function Test-ServerUp {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400) -and $c.Connected
        $c.Close()
        return $ok
    } catch { return $false }
}

Write-Host '=== COPIAS DE SEGURIDAD DE SUWAYOMI ===' -ForegroundColor Cyan
Write-Host "Carpeta de copias: $BackupDir"
Write-Host ''
Write-Host '  1) Crear copia de seguridad ahora (DB + .tachibk si esta encendido)'
Write-Host '  2) Restaurar una copia de database.mv.db'
Write-Host '  3) Abrir carpeta de copias de seguridad'
Write-Host '  0) Salir'
Write-Host ''
$opt = (Read-Host 'Elige una opcion').Trim()

if ($opt -eq '1') {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (Test-Path $DbPath) {
        $destDb = Join-Path $BackupDir "database.mv.db.bak-$stamp"
        Copy-Item -Path $DbPath -Destination $destDb -Force
        Write-Host "[OK] Copia de base de datos guardada: $destDb" -ForegroundColor Green
    } else {
        Write-Host '[!] Todavia no existe database.mv.db.' -ForegroundColor Yellow
    }

    if (Test-ServerUp) {
        try {
            $body = @{ query = 'mutation { createBackup(input: {}) { url } }' } | ConvertTo-Json -Compress
            $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/graphql" -ContentType 'application/json' -Body $body
            $url = $r.data.createBackup.url
            if ($url) {
                $destTb = Join-Path $BackupDir "suwayomi-$stamp.tachibk"
                Invoke-WebRequest -Uri "http://127.0.0.1:$Port$url" -OutFile $destTb -UseBasicParsing
                Write-Host "[OK] Copia compatible con Mihon/Tachiyomi guardada: $destTb" -ForegroundColor Green
            }
        } catch {
            Write-Host "[!] No se pudo generar .tachibk via API: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Host 'Nota: si enciendes Suwayomi antes, tambien genera archivo .tachibk compatible con Mihon/Tachiyomi.'
    }
}
elseif ($opt -eq '2') {
    $files = @(Get-ChildItem -Path $BackupDir -Filter 'database.mv.db.bak-*' -ErrorAction SilentlyContinue)
    $files += @(Get-ChildItem -Path $DataDir -Filter 'database.mv.db.bak-*' -ErrorAction SilentlyContinue)
    $files = $files | Sort-Object LastWriteTime -Descending
    if (-not $files) {
        Write-Host 'No se encontraron copias de database.mv.db todavia.' -ForegroundColor Yellow
        return
    }
    Write-Host ''
    for ($i = 0; $i -lt $files.Count; $i++) {
        $f = $files[$i]
        Write-Host ("  {0}) {1}  ({2:yyyy-MM-dd HH:mm})" -f ($i + 1), $f.Name, $f.LastWriteTime)
    }
    $sel = [int](Read-Host 'Numero de la copia a restaurar (0 para cancelar)')
    if ($sel -lt 1 -or $sel -gt $files.Count) { Write-Host 'Cancelado.'; return }
    $chosen = $files[$sel - 1]

    $procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'java' -and $_.CommandLine -match 'Suwayomi' }
    if ($procs) {
        Write-Host 'Cerrando Suwayomi antes de restaurar...'
        foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 3
    }
    if (Test-Path $DbPath) {
        $safe = Join-Path $BackupDir ("database.mv.db.pre-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Copy-Item -Path $DbPath -Destination $safe -Force
        Write-Host "Copia preventiva de la DB actual guardada en: $safe"
    }
    Copy-Item -Path $chosen.FullName -Destination $DbPath -Force
    Write-Host "[OK] Base de datos restaurada desde $($chosen.Name)." -ForegroundColor Green
    Write-Host 'Pulsa "Encender" en el panel de control.'
}
elseif ($opt -eq '3') {
    Start-Process explorer.exe $BackupDir
}
