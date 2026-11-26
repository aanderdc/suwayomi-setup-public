<#
.SYNOPSIS
    Comprueba en VirusTotal las extensiones (.jar) instaladas en Suwayomi.

.DESCRIPTION
    Calcula el SHA256 de cada .jar y lo consulta en VirusTotal. Si el archivo
    no es conocido, lo sube y espera al analisis. Necesita una API key gratuita
    de VirusTotal (virustotal.com > tu perfil > API key), que se puede pasar en
    la variable de entorno VT_API_KEY o se pide al ejecutar.

    La cuenta gratuita permite unas 4 consultas por minuto, asi que tarda un
    poco por extension. Ojo: si una extension no es conocida, se SUBE a
    VirusTotal y otros usuarios podran descargarla.

.PARAMETER Dir
    Carpeta con los .jar. Por defecto %LOCALAPPDATA%\Tachidesk\extensions
    (donde Suwayomi guarda las extensiones instaladas); si no existe, se usa
    la carpeta "extensions" junto a este script.
#>
param([string]$Dir)
$ErrorActionPreference = 'Stop'
if (-not $Dir) {
    $Dir = Join-Path $env:LOCALAPPDATA 'Tachidesk\extensions'
    if (-not (Test-Path $Dir)) { $Dir = Join-Path $PSScriptRoot 'extensions' }
}
$base = 'https://www.virustotal.com/api/v3'

if (-not (Test-Path $Dir)) { Write-Host "No existe la carpeta $Dir. Instala alguna extension desde Suwayomi primero."; exit 1 }
$jars = Get-ChildItem -Path $Dir -Filter *.jar
if (-not $jars) { Write-Host "No hay .jar en $Dir"; exit 1 }
Write-Host "Carpeta: $Dir"

$key = $env:VT_API_KEY
if (-not $key) { $key = Read-Host 'Pega tu API key de VirusTotal' }
$h = @{ 'x-apikey' = $key }

$resultados = New-Object System.Collections.Generic.List[object]

foreach ($jar in $jars) {
    $hash = (Get-FileHash -Algorithm SHA256 -Path $jar.FullName).Hash.ToLower()
    Write-Host ""
    Write-Host "== $($jar.Name)"
    Write-Host "   SHA256: $hash"

    $stats = $null
    try {
        $r = Invoke-RestMethod -Uri "$base/files/$hash" -Headers $h
        $stats = $r.data.attributes.last_analysis_stats
        Write-Host "   Ya conocido por VirusTotal."
    } catch {
        $code = $null
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code -eq 401 -or $code -eq 403) { Write-Host "   API key no valida."; exit 1 }
        if ($code -ne 404) { Write-Host "   Error consultando VirusTotal: $($_.Exception.Message)"; exit 1 }

        Write-Host "   No conocido. Subiendo el archivo..."
        $up = curl.exe -s -X POST "$base/files" -H "x-apikey: $key" -F "file=@$($jar.FullName)" | ConvertFrom-Json
        $id = $up.data.id
        if (-not $id) { Write-Host "   No se pudo subir el archivo."; exit 1 }

        for ($i = 1; $i -le 20; $i++) {
            Start-Sleep -Seconds 15
            $a = Invoke-RestMethod -Uri "$base/analyses/$id" -Headers $h
            Write-Host "   Esperando analisis... ($($a.data.attributes.status))"
            if ($a.data.attributes.status -eq 'completed') {
                $stats = $a.data.attributes.stats
                break
            }
        }
    }

    if (-not $stats) {
        Write-Host "   Sin resultado. Mira el hash a mano en virustotal.com"
        $resultados.Add([pscustomobject]@{ Archivo = $jar.Name; Estado = 'SIN RESULTADO'; Detecciones = '-' })
    } else {
        $mal = [int]$stats.malicious
        $sus = [int]$stats.suspicious
        $total = $mal + $sus + [int]$stats.undetected + [int]$stats.harmless
        if ($mal -eq 0 -and $sus -eq 0) { $estado = 'LIMPIO' }
        elseif ($mal -le 2) { $estado = 'REVISAR (posible falso positivo)' }
        else { $estado = 'PELIGRO' }
        Write-Host "   Malicioso: $mal  Sospechoso: $sus  (de $total motores)"
        Write-Host "   Informe: https://www.virustotal.com/gui/file/$hash"
        $resultados.Add([pscustomobject]@{ Archivo = $jar.Name; Estado = $estado; Detecciones = "$mal/$total" })
    }

    # limite gratuito: 4 consultas por minuto
    Start-Sleep -Seconds 16
}

Write-Host ""
Write-Host "================ RESUMEN ================"
$resultados | Format-Table -AutoSize