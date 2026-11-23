<#
.SYNOPSIS
    Prepara el acceso a Suwayomi desde el movil (por datos moviles) usando Tailscale.

.DESCRIPTION
    Tailscale crea una red privada entre tu PC y tu movil: no se abre ningun
    puerto del router y Suwayomi no queda publicado en Internet. Solo los
    dispositivos con TU cuenta de Tailscale pueden entrar.

    El script, paso a paso y pidiendo confirmacion en lo importante:
      1. Instala Tailscale en el PC si no esta (con winget).
      2. Te ayuda a iniciar sesion (abre el navegador).
      3. Comprueba que Suwayomi escucha fuera de "localhost".
      4. (Opcional) Abre el puerto solo para la red de Tailscale en el firewall.
      5. (Opcional) Evita que el PC se suspenda cuando esta enchufado.
      6. Te da la direccion para abrir en el movil y la copia al portapapeles.
#>
$ErrorActionPreference = 'Stop'
$Port    = 4567
$DataDir = Join-Path $env:LOCALAPPDATA 'Tachidesk'
$RuleName = 'Suwayomi (solo Tailscale)'

function Titulo($t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Ok($t)     { Write-Host "  [OK] $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  [!]  $t" -ForegroundColor Yellow }

function Preguntar($texto, [bool]$porDefecto = $true) {
    $sufijo = if ($porDefecto) { '[S/n]' } else { '[s/N]' }
    $r = (Read-Host "$texto $sufijo").Trim().ToLower()
    if (-not $r) { return $porDefecto }
    return ($r -eq 's' -or $r -eq 'si' -or $r -eq 'y' -or $r -eq 'yes')
}

function Find-Tailscale {
    $p = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (Test-Path $p) { return $p }
    $c = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return $null
}

function Get-TsStatus($ts) {
    try {
        $txt = & $ts status --json 2>$null | Out-String
        if ($txt.Trim()) { return ($txt | ConvertFrom-Json) }
    } catch { }
    return $null
}

function Test-Port($addr, $port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect($addr, $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(1000) -and $c.Connected
        $c.Close()
        return $ok
    } catch { return $false }
}

Write-Host ''
Write-Host 'ACCESO A SUWAYOMI DESDE EL MOVIL (con Tailscale)' -ForegroundColor White
Write-Host 'Necesitaras una cuenta gratuita de Tailscale (Google, Microsoft, Apple o GitHub).'

# ---------------------------------------------------------------- 1. Instalar
Titulo '1/6 Tailscale en este PC'
$ts = Find-Tailscale
if ($ts) {
    Ok 'Tailscale ya esta instalado.'
} else {
    Write-Host '  Tailscale no esta instalado. Voy a instalarlo; Windows te pedira permiso.'
    if (-not (Preguntar '  Instalar Tailscale ahora?')) { Write-Host 'Cancelado.'; return }
    if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
        & winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
    }
    $ts = Find-Tailscale
    if (-not $ts) {
        Aviso 'No he podido instalarlo automaticamente. Se abre la pagina de descarga.'
        Start-Process 'https://tailscale.com/download/windows'
        Read-Host '  Instalalo y pulsa Enter para continuar'
        $ts = Find-Tailscale
    }
    if (-not $ts) { throw 'Tailscale sigue sin estar instalado. Instalalo y vuelve a ejecutar esto.' }
    Ok 'Tailscale instalado.'
}

# ---------------------------------------------------------------- 2. Sesion
Titulo '2/6 Iniciar sesion'
$st = Get-TsStatus $ts
if (-not $st) {
    $gui = Join-Path (Split-Path $ts) 'tailscale-ipn.exe'
    if (Test-Path $gui) { Start-Process $gui }
    for ($i = 0; $i -lt 10 -and -not $st; $i++) { Start-Sleep -Seconds 2; $st = Get-TsStatus $ts }
}
if (-not $st) { throw 'No consigo hablar con Tailscale. Reinicia el PC y vuelve a probar.' }

if ($st.BackendState -eq 'Running') {
    Ok 'Ya has iniciado sesion en Tailscale.'
} else {
    Write-Host '  Se abrira el navegador: inicia sesion y pulsa "Connect".'
    Write-Host '  Usa la MISMA cuenta que usaras en el movil.'
    $o = Join-Path $env:TEMP 'tailscale-up.out'; $e = Join-Path $env:TEMP 'tailscale-up.err'
    Remove-Item $o, $e -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $ts -ArgumentList 'up' -WindowStyle Hidden -PassThru `
         -RedirectStandardOutput $o -RedirectStandardError $e
    $abierto = $false
    $limite = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $limite) {
        Start-Sleep -Seconds 2
        if (-not $abierto) {
            $txt = ''
            foreach ($f in @($o, $e)) { if (Test-Path $f) { $txt += (Get-Content $f -Raw -ErrorAction SilentlyContinue) } }
            if ($txt -match 'https://login\.tailscale\.com/\S+') {
                Start-Process $Matches[0]
                $abierto = $true
                Write-Host '  Esperando a que termines en el navegador...'
            }
        }
        $st = Get-TsStatus $ts
        if ($st -and $st.BackendState -eq 'Running') { break }
    }
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    if (-not $st -or $st.BackendState -ne 'Running') {
        throw 'No se ha completado el inicio de sesion. Vuelve a pulsar el boton y termina el login en el navegador.'
    }
    Ok 'Sesion iniciada.'
}

$ip = ((& $ts ip -4 2>$null) | Select-Object -First 1)
if (-not $ip) { throw 'Tailscale no ha dado una direccion IP. Vuelve a intentarlo en un minuto.' }
$ip = "$ip".Trim()
Ok "Direccion de este PC en tu red privada: $ip"

# ---------------------------------------------------------------- 3. Suwayomi escucha
Titulo '3/6 Suwayomi escuchando en la red privada'
$conf = Join-Path $DataDir 'server.conf'
$cambiado = $false
if (Test-Path $conf) {
    $txt = Get-Content $conf -Raw
    if ($txt -match '(?m)^\s*server\.ip\s*=\s*"?([^"\s#]+)') {
        $valor = $Matches[1]
        if ($valor -in @('127.0.0.1', 'localhost', '::1')) {
            Aviso "Suwayomi solo escucha en este PC (server.ip = $valor), asi que el movil no podria entrar."
            if (Preguntar '  Cambiarlo para que acepte conexiones de la red? (se guarda una copia)') {
                Copy-Item $conf "$conf.bak" -Force
                $nuevo = [regex]::Replace($txt, '(?m)^(\s*server\.ip\s*=\s*)"?[^"\s#]+"?', '${1}"0.0.0.0"')
                Set-Content -Path $conf -Value $nuevo -Encoding UTF8
                $cambiado = $true
                Ok 'Cambiado a 0.0.0.0. Hay que reiniciar Suwayomi (Apagar y Encender).'
            }
        } else { Ok "server.ip = $valor (correcto)." }
    } else { Ok 'La configuracion de Suwayomi no limita la red (correcto).' }
} else {
    Aviso 'Aun no existe server.conf: enciende Suwayomi una vez y vuelve a ejecutar esto si el movil no conecta.'
}
if (Test-Port '127.0.0.1' $Port) {
    if (-not $cambiado) {
        if (Test-Port $ip $Port) { Ok "Suwayomi responde en $ip`:$Port." }
        else { Aviso "Suwayomi esta encendido pero no responde en $ip`:$Port. Revisa server.ip en $conf." }
    }
} else {
    Aviso 'Suwayomi esta apagado ahora mismo. Recuerda pulsar "Encender" antes de usarlo desde el movil.'
}

# ---------------------------------------------------------------- 4. Firewall
Titulo '4/6 Firewall de Windows'
$regla = $null
try { $regla = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue } catch { }
if ($regla) {
    Ok 'La regla del firewall ya existe.'
} else {
    Write-Host "  Windows puede bloquear al movil aunque Tailscale funcione."
    Write-Host "  Puedo crear una regla que abre el puerto $Port SOLO para dispositivos de Tailscale."
    if (Preguntar '  Crear la regla? (Windows pedira permiso de administrador)') {
        $cmd = "New-NetFirewallRule -DisplayName '$RuleName' -Direction Inbound -Protocol TCP -LocalPort $Port " +
               "-RemoteAddress 100.64.0.0/10 -Action Allow -Profile Any | Out-Null"
        try {
            Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $cmd
            if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) { Ok 'Regla creada.' }
            else { Aviso 'No se ha creado la regla (quiza se cancelo el permiso).' }
        } catch { Aviso 'No se ha creado la regla (permiso cancelado).' }
    }
}

# ---------------------------------------------------------------- 5. Suspension
Titulo '5/6 Que el PC no se duerma'
Write-Host '  Si el PC se suspende, el movil perdera la conexion.'
if (Preguntar '  Evitar la suspension automatica cuando el PC esta enchufado? (la pantalla si podra apagarse)' $false) {
    & powercfg /change standby-timeout-ac 0
    & powercfg /change hibernate-timeout-ac 0
    Ok 'Hecho. Con el PC enchufado no se suspendera solo.'
} else {
    Aviso 'No se ha cambiado. Deja el PC encendido y sin suspender cuando quieras usarlo desde el movil.'
}

# ---------------------------------------------------------------- 6. Movil
Titulo '6/6 En el movil'
$url = "http://$ip`:$Port"
try { Set-Clipboard -Value $url } catch { }
Write-Host ''
Write-Host "  Direccion para el movil:  $url" -ForegroundColor Green
Write-Host '  (copiada al portapapeles)'
Write-Host ''
Write-Host '  En el movil Android:'
Write-Host '   1. Instala "Tailscale" desde Google Play.'
Write-Host '   2. Abrela, inicia sesion con la MISMA cuenta y acepta la conexion VPN.'
Write-Host '   3. Con Tailscale conectado, abre Chrome y entra en la direccion de arriba.'
Write-Host '   4. En Chrome: menu (3 puntos) > "Anadir a pantalla de inicio" para tener un icono.'
Write-Host ''
Write-Host '  Funciona tambien con datos moviles. El PC debe estar encendido, con Suwayomi en marcha.'
