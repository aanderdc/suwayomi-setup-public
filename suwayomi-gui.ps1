Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------------- Configuracion ----------------
$Root        = $PSScriptRoot
$Port        = 4567
$Url         = "http://localhost:$Port"
$DataDir     = Join-Path $env:LOCALAPPDATA 'Tachidesk'
$InstallRoot = Join-Path $env:USERPROFILE 'Suwayomi'

$script:Launcher  = $null
$script:Starting  = $false
$script:StartTime = Get-Date

# ---------------- Funciones ----------------
function Msg($text, $icon = 'Information') {
    [void][System.Windows.Forms.MessageBox]::Show($text, 'Suwayomi', 'OK', $icon)
}

function Write-Log($text) {
    $txtLog.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format 'HH:mm:ss'), $text))
}

function Test-Server {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(300) -and $c.Connected
        $c.Close()
        return $ok
    } catch { return $false }
}

function Get-Launcher {
    if (-not (Test-Path $InstallRoot)) { return $null }
    Get-ChildItem -Path $InstallRoot -Filter 'Suwayomi-Launcher.jar' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Get-SuwayomiProcesses {
    Get-CimInstance Win32_Process |
        Where-Object { $_.Name -match 'java' -and $_.CommandLine -match 'Suwayomi' }
}

function Sync-MobileWebApp {
    $src = Join-Path $Root 'mobile'
    if (-not (Test-Path $src)) { return }
    try {
        $dest = Join-Path $DataDir 'webUI\movil'
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        Copy-Item -Path (Join-Path $src '*') -Destination $dest -Force
    } catch { }
}

function Run-Visible($scriptName, $scriptArgs = '') {
    $path = Join-Path $Root $scriptName
    if (-not (Test-Path $path)) { Msg "No se encuentra $scriptName en la carpeta." 'Error'; return }
    $cmd = "& '$path' $scriptArgs; Write-Host ''; Read-Host 'Terminado. Pulsa Enter para cerrar esta ventana'"
    Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
}

function Update-State {
    if (-not $script:Launcher) { $script:Launcher = Get-Launcher }
    $inst = [bool]$script:Launcher
    $up   = Test-Server

    if ($script:Starting -and $up) {
        $script:Starting = $false
        Write-Log 'Servidor listo. Abriendo el navegador...'
        Start-Process $Url
    } elseif ($script:Starting -and ((Get-Date) - $script:StartTime).TotalSeconds -gt 90) {
        $script:Starting = $false
        Write-Log 'El servidor no respondio en 90 segundos. Pulsa "Ver registro" para ver el motivo.'
    }

    if ($up) {
        $lblStatus.Text = 'ENCENDIDO';  $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(30, 140, 60)
    } elseif ($script:Starting) {
        $lblStatus.Text = 'INICIANDO...'; $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(220, 130, 0)
    } elseif ($inst) {
        $lblStatus.Text = 'APAGADO';    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(190, 40, 40)
    } else {
        $lblStatus.Text = 'NO INSTALADO'; $lblStatus.ForeColor = [System.Drawing.Color]::Gray
    }

    $btnStart.Enabled   = $inst -and (-not $up) -and (-not $script:Starting)
    $btnStop.Enabled    = $up -or $script:Starting
    $btnOpen.Enabled    = $up
    $btnInstall.Enabled = -not $inst
    $btnSources.Enabled = $up
    $btnHistory.Enabled = $inst
    $btnScan.Enabled    = $inst
    $btnMobile.Enabled  = $inst
}

function New-Btn($text, $x, $y, $w, $h, $color) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text
    $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, $h)
    $b.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $b.FlatStyle = 'Flat'
    $b.Cursor = 'Hand'
    if ($color) { $b.BackColor = $color; $b.ForeColor = [System.Drawing.Color]::White }
    $form.Controls.Add($b)
    return $b
}

function New-Section($text, $y) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.Location = New-Object System.Drawing.Point(20, $y)
    $l.Size = New-Object System.Drawing.Size(460, 18)
    $l.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $l.ForeColor = [System.Drawing.Color]::Gray
    $form.Controls.Add($l)
}

# ---------------- Ventana ----------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Suwayomi - Panel de control'
$form.ClientSize = New-Object System.Drawing.Size(500, 600)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(20, 10)
$lblStatus.Size = New-Object System.Drawing.Size(460, 45)
$lblStatus.TextAlign = 'MiddleCenter'
$lblStatus.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($lblStatus)

$green = [System.Drawing.Color]::FromArgb(30, 140, 60)
$red   = [System.Drawing.Color]::FromArgb(190, 40, 40)
$blue  = [System.Drawing.Color]::FromArgb(30, 100, 190)

New-Section 'USO DIARIO' 60
$btnStart = New-Btn 'Encender'  20  82 225 50 $green
$btnStop  = New-Btn 'Apagar'    255 82 225 50 $red
$btnOpen  = New-Btn 'Abrir Suwayomi en el navegador' 20 140 460 45 $blue

New-Section 'PRIMERA VEZ' 195
$btnInstall = New-Btn '1. Instalar Suwayomi'            20  217 225 40 $null
$btnSources = New-Btn '2. Anadir repositorio de extensiones'    255 217 225 40 $null

New-Section 'AYUDA' 267
$btnLog    = New-Btn 'Ver registro'         20  289 225 35 $null
$btnFolder = New-Btn 'Abrir carpeta de datos' 255 289 225 35 $null

New-Section 'MANTENIMIENTO Y SEGURIDAD' 334
$btnHistory = New-Btn 'Borrar historial' 20  356 225 35 $null
$btnScan    = New-Btn 'Escanear extensiones' 255 356 225 35 $null

New-Section 'ACCESO DESDE EL MOVIL (por datos o WiFi)' 399
$btnMobile = New-Btn 'Acceso desde el movil (Tailscale)' 20 421 460 40 $blue

$tip = New-Object System.Windows.Forms.ToolTip
$tip.SetToolTip($btnHistory, 'Borra el historial de lectura (con copia de seguridad)')
$tip.SetToolTip($btnScan, 'Comprueba las extensiones instaladas en VirusTotal (necesita una API key gratuita)')
$tip.SetToolTip($btnMobile, 'Abre el asistente visual de Tailscale: acceso privado HTTPS, codigo QR y control de suspension')

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(20, 468)
$txtLog.Size = New-Object System.Drawing.Size(460, 120)
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.BackColor = [System.Drawing.Color]::White
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 9)
$form.Controls.Add($txtLog)

# ---------------- Acciones ----------------
$btnStart.Add_Click({
    if (-not $script:Launcher) { Msg 'Suwayomi no esta instalado. Pulsa "Instalar Suwayomi".' 'Warning'; return }
    Sync-MobileWebApp
    $dir = $script:Launcher.DirectoryName
    $java = $null
    $jre = Join-Path $dir 'jre\bin\javaw.exe'
    if (Test-Path $jre) { $java = $jre }
    else {
        $cmd = Get-Command javaw.exe -ErrorAction SilentlyContinue
        if ($cmd) { $java = $cmd.Source }
    }
    if (-not $java) { Msg 'No se encontro Java. Reinstala Suwayomi con el boton "Instalar Suwayomi".' 'Error'; return }
    Start-Process -FilePath $java -ArgumentList '-jar', 'Suwayomi-Launcher.jar' -WorkingDirectory $dir -WindowStyle Hidden
    $script:Starting  = $true
    $script:StartTime = Get-Date
    Write-Log 'Encendiendo Suwayomi, puede tardar unos segundos...'
    Update-State
})

$btnStop.Add_Click({
    $procs = Get-SuwayomiProcesses
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    $script:Starting = $false
    Write-Log 'Suwayomi apagado.'
    Update-State
})

$btnOpen.Add_Click({ Start-Process $Url })

$btnInstall.Add_Click({
    Write-Log 'Abriendo el instalador. Espera a que termine en la otra ventana.'
    Run-Visible 'install.ps1'
})

$btnSources.Add_Click({
    Write-Log 'Anadiendo repositorio. Mira la otra ventana.'
    Run-Visible 'setup-sources.ps1'
})

$btnHistory.Add_Click({
    $texto = "Se borrara el historial de lectura.`n`n" +
             "- Los capitulos siguen marcados como leidos.`n" +
             "- Se conservan la biblioteca, el progreso y las descargas.`n" +
             "- Se hace una copia de seguridad de la base de datos antes.`n" +
             "- Suwayomi se cerrara si esta encendido.`n`n" +
             "Continuar?"
    $r = [System.Windows.Forms.MessageBox]::Show($texto, 'Borrar historial', 'YesNo', 'Question')
    if ($r -ne 'Yes') { return }

    foreach ($p in (Get-SuwayomiProcesses)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    $script:Starting = $false
    Write-Log 'Borrando historial. Mira la otra ventana; despues pulsa "Encender".'
    Update-State
    Run-Visible 'clear-history.ps1' '-Force'
})

$btnMobile.Add_Click({
    $path = Join-Path $Root 'setup-tailscale.ps1'
    if (-not (Test-Path $path)) { Msg 'No se encuentra setup-tailscale.ps1 en la carpeta.' 'Error'; return }
    Write-Log 'Abriendo asistente de acceso desde el movil (Tailscale)...'
    Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $path
})

$btnScan.Add_Click({
    $extDir = Join-Path $DataDir 'extensions'
    if (-not (Test-Path $extDir) -or -not (Get-ChildItem -Path $extDir -Filter *.jar -ErrorAction SilentlyContinue)) {
        Msg 'No hay extensiones instaladas todavia. Instala alguna desde Suwayomi y vuelve a probar.' 'Information'
        return
    }
    Write-Log 'Escaneando extensiones en VirusTotal. Mira la otra ventana (pedira tu API key).'
    Run-Visible 'verificar-extensiones.ps1'
})

$btnLog.Add_Click({
    $log = Join-Path $DataDir 'logs\application.log'
    if (-not (Test-Path $log)) { Msg 'Todavia no hay registro. Enciende Suwayomi primero.' 'Information'; return }
    Start-Process powershell -ArgumentList '-NoProfile', '-NoExit', '-Command', "Get-Content -Path '$log' -Wait -Tail 40"
})

$btnFolder.Add_Click({
    if (-not (Test-Path $DataDir)) { Msg 'Todavia no existe la carpeta de datos. Enciende Suwayomi una vez.' 'Information'; return }
    Start-Process explorer.exe $DataDir
})

# ---------------- Arranque ----------------
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({ Update-State })

$form.Add_Shown({
    Update-State
    if (-not $script:Launcher) { Write-Log 'Bienvenido. Pulsa "1. Instalar Suwayomi" para empezar.' }
    else { Write-Log 'Listo. Pulsa "Encender" para usar Suwayomi.' }
    $timer.Start()
})

[void]$form.ShowDialog()
$timer.Stop()