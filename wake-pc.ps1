<#
.SYNOPSIS
    Envia un paquete magico Wake-on-LAN (UDP puerto 9) o muestra la direccion MAC de este PC.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\wake-pc.ps1
    powershell -ExecutionPolicy Bypass -File .\wake-pc.ps1 -Mac "AA:BB:CC:DD:EE:FF"
#>
param(
    [string]$Mac,
    [string]$Broadcast = '255.255.255.255',
    [int]$Port = 9
)
$ErrorActionPreference = 'Stop'

if (-not $Mac) {
    Write-Host '=== DIRECCIONES MAC DE ESTE PC (para Wake-on-LAN) ===' -ForegroundColor Cyan
    Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name, InterfaceDescription, MacAddress | Format-Table -AutoSize
    Write-Host 'Para despertar este PC desde otro equipo en tu misma red local:'
    Write-Host '  powershell -ExecutionPolicy Bypass -File .\wake-pc.ps1 -Mac "AA-BB-CC-DD-EE-FF"'
    Write-Host 'Nota: activa Wake-on-LAN en la BIOS y en propiedades del adaptador de red.'
    return
}

$clean = ($Mac -replace '[^0-9A-Fa-f]', '')
if ($clean.Length -ne 12) { throw "Direccion MAC no valida: $Mac" }
$macBytes = for ($i = 0; $i -lt 12; $i += 2) { [Convert]::ToByte($clean.Substring($i, 2), 16) }

$packet = [byte[]](,0xFF * 6) + ($macBytes * 16)
$udp = New-Object System.Net.Sockets.UdpClient
$udp.EnableBroadcast = $true
try {
    [void]$udp.Send($packet, $packet.Length, $Broadcast, $Port)
    Write-Host "Paquete Wake-on-LAN enviado a $Mac ($Broadcast`:$Port)." -ForegroundColor Green
} finally {
    $udp.Close()
}
