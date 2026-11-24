<#
.SYNOPSIS
    Comprueba la ultima version oficial de Suwayomi-Server en GitHub y actualiza conservando tus datos.
#>
param(
    [string]$InstallDir = (Join-Path $HOME 'Suwayomi')
)
$ErrorActionPreference = 'Stop'

Write-Host '=== ACTUALIZAR SUWAYOMI (Windows) ===' -ForegroundColor Cyan

$currentVer = '(no instalado)'
if (Test-Path $InstallDir) {
    $dirs = Get-ChildItem -Path $InstallDir -Directory -Filter 'Suwayomi-Server-*-windows-x64' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    if ($dirs) {
        if ($dirs[0].Name -match 'Suwayomi-Server-(v[^-]+)-windows') { $currentVer = $Matches[1] }
        else { $currentVer = $dirs[0].Name }
    }
}
Write-Host "Version instalada: $currentVer"

Write-Host 'Consultando ultima version oficial en GitHub...'
$headers = @{ 'User-Agent' = 'suwayomi-setup-public' }
$rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/Suwayomi/Suwayomi-Server/releases/latest' -Headers $headers
$latestTag = "$($rel.tag_name)".Trim()
if (-not $latestTag) { throw 'No se pudo obtener la ultima version desde GitHub.' }

$asset = $rel.assets | Where-Object { $_.name -match 'windows-x64\.zip$' } | Select-Object -First 1
if (-not $asset) { throw "No se encontro paquete windows-x64.zip en la release $latestTag." }

Write-Host "Ultima version:    $latestTag" -ForegroundColor Green
if ($currentVer -eq $latestTag) {
    Write-Host ''
    Write-Host 'Ya tienes la ultima version instalada.' -ForegroundColor Green
    return
}

Write-Host ''
Write-Host 'Tu biblioteca, descargas y base de datos (%LOCALAPPDATA%\Tachidesk) NO se borran.'
$ans = (Read-Host "Descargar e instalar $latestTag ahora? [S/n]").Trim().ToLower()
if ($ans -and $ans -notin @('s', 'si', 'y', 'yes')) {
    Write-Host 'Cancelado.'
    return
}

# Cerrar Suwayomi si esta en marcha
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'java' -and $_.CommandLine -match 'Suwayomi' }
if ($procs) {
    Write-Host 'Cerrando Suwayomi antes de actualizar...'
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

$tmp = Join-Path $env:TEMP $asset.name
Write-Host "Descargando $($asset.browser_download_url) ..."
if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --retry 3 -o $tmp $asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw "Error descargando (curl exit $LASTEXITCODE)." }
} else {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Host "Extrayendo en $InstallDir ..."
Expand-Archive -Path $tmp -DestinationPath $InstallDir -Force
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "Actualizado correctamente a $latestTag." -ForegroundColor Green
Write-Host 'Pulsa "Encender" en el panel de control para usar la nueva version.'
