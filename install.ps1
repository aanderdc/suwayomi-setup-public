param(
    [string]$InstallDir = (Join-Path $HOME "Suwayomi"),
    [string]$Version = "v2.4.2366"
)
$ErrorActionPreference = "Stop"

$zipName = "Suwayomi-Server-$Version-windows-x64.zip"
$url = "https://github.com/Suwayomi/Suwayomi-Server/releases/download/$Version/$zipName"
$tmp = Join-Path $env:TEMP $zipName

Write-Host "Descargando $url ..."
if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --retry 3 -o $tmp $url
    if ($LASTEXITCODE -ne 0) { throw "Fallo la descarga (curl exit $LASTEXITCODE)." }
} else {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Host "Extrayendo en $InstallDir ..."
Expand-Archive -Path $tmp -DestinationPath $InstallDir -Force
Remove-Item $tmp -Force

$app = Join-Path $InstallDir "Suwayomi-Server-$Version-windows-x64"
if (-not (Test-Path $app)) { throw "No se encontro la carpeta extraida: $app" }

Write-Host ""
Write-Host "Instalado en: $app"
Write-Host "1) Ejecuta '$app\Suwayomi Launcher.bat' y pulsa Launch."
Write-Host "2) Con el servidor corriendo, ejecuta setup-sources.ps1 para anadir el repositorio de extensiones."
Write-Host "3) Abre http://localhost:4567"