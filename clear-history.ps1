<#
.SYNOPSIS
    Borra el historial de lectura de Suwayomi-Server.

.DESCRIPTION
    El historial de la interfaz web se construye a partir de la columna
    LAST_READ_AT de la tabla CHAPTER. La API de Suwayomi no permite
    modificarla, asi que este script lo hace directamente en la base de datos
    H2, usando el Java y la herramienta H2 que ya trae el propio Suwayomi.

    Solo se pone LAST_READ_AT a 0. Los capitulos siguen marcados como leidos
    y se conservan el progreso, la biblioteca y las descargas.

    Antes de modificar nada se hace una copia de database.mv.db.

.PARAMETER InstallDir
    Carpeta del servidor, la que contiene "jre" y "bin"
    (p. ej. ...\Suwayomi-Server-v2.4.2366-windows-x64).
    Si no se indica, se busca en $HOME\Suwayomi y en Descargas.

.PARAMETER DataDir
    Carpeta de datos de Suwayomi. Por defecto %LOCALAPPDATA%\Tachidesk.

.PARAMETER Force
    Si el servidor esta en marcha, lo cierra (solo el Java de ESTA instalacion).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\clear-history.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\clear-history.ps1 -Force
#>
param(
    [string]$InstallDir,
    [string]$DataDir = (Join-Path $env:LOCALAPPDATA "Tachidesk"),
    [int]$MangaId = 0,
    [switch]$Force
)
$ErrorActionPreference = "Stop"
if ($MangaId -lt 0) { throw "MangaId debe ser un numero positivo." }

# --- Localizar la carpeta del servidor ---------------------------------------
if (-not $InstallDir) {
    $candidates = @()
    foreach ($parent in @((Join-Path $HOME "Suwayomi"), (Join-Path $HOME "Downloads"))) {
        if (Test-Path $parent) {
            $candidates += Get-ChildItem -Path $parent -Directory -Filter "Suwayomi-Server-*-windows-x64" -ErrorAction SilentlyContinue
        }
    }
    if (-not $candidates) {
        throw "No encuentro la carpeta del servidor. Indicala con -InstallDir ""C:\ruta\Suwayomi-Server-vX-windows-x64""."
    }
    $InstallDir = ($candidates | Sort-Object Name -Descending | Select-Object -First 1).FullName
}
$InstallDir = (Resolve-Path $InstallDir).Path

$java = Join-Path $InstallDir "jre\bin\java.exe"
$jar  = Join-Path $InstallDir "bin\Suwayomi-Server.jar"
$db   = Join-Path $DataDir "database.mv.db"

foreach ($p in @($java, $jar, $db)) {
    if (-not (Test-Path $p)) { throw "No existe: $p" }
}

Write-Host "Servidor: $InstallDir"
Write-Host "Datos:    $DataDir"

# --- Comprobar que el servidor esta cerrado ----------------------------------
function Get-ServerProcess {
    Get-Process -Name javaw, java -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase) }
}

$running = Get-ServerProcess
if ($running) {
    if ($Force) {
        Write-Host "Cerrando el servidor ..."
        $running | Stop-Process -Force
        Start-Sleep -Seconds 3
    } else {
        throw "Suwayomi esta en marcha. Cierralo desde el icono de la bandeja (o ejecuta de nuevo con -Force)."
    }
}

# --- Consultas a H2 -----------------------------------------------------------
$dbBase = (Join-Path $DataDir "database") -replace "\\", "/"

function Invoke-H2([string]$sql, [switch]$ReadOnly) {
    $url = "jdbc:h2:file:$dbBase"
    if ($ReadOnly) { $url += ";ACCESS_MODE_DATA=r" }
    $out = & $java -cp $jar org.h2.tools.Shell -url $url -sql $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Error ejecutando H2:`n$out" }
    return $out
}

$whereSql = if ($MangaId -gt 0) { "MANGA = $MangaId AND LAST_READ_AT > 0" } else { "LAST_READ_AT > 0" }

Write-Host ""
if ($MangaId -gt 0) {
    Write-Host "Capitulos con historial ahora mismo (manga $MangaId):"
} else {
    Write-Host "Capitulos con historial ahora mismo:"
}
Invoke-H2 "SELECT COUNT(*) FROM CHAPTER WHERE $whereSql" -ReadOnly

# --- Copia de seguridad -------------------------------------------------------
$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $DataDir "database.mv.db.bak-$stamp"
Copy-Item -Path $db -Destination $backup
Write-Host ""
Write-Host "Copia de seguridad: $backup"

# --- Borrar el historial ------------------------------------------------------
Invoke-H2 "UPDATE CHAPTER SET LAST_READ_AT = 0 WHERE $whereSql" | Out-Null

Write-Host ""
Write-Host "Capitulos con historial despues (debe ser 0):"
Invoke-H2 "SELECT COUNT(*) FROM CHAPTER WHERE $whereSql" -ReadOnly

Write-Host ""
Write-Host "Listo. Arranca Suwayomi y recarga la pagina Historial (F5)."
Write-Host "Para deshacerlo: cierra Suwayomi y restaura la copia sobre database.mv.db."
