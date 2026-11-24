Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------------- Configuracion ----------------
$Root        = $PSScriptRoot
$Port        = 4567
$MobilePort  = 4568
$Url         = "http://localhost:$Port"
$DataDir     = Join-Path $env:LOCALAPPDATA 'Tachidesk'
$InstallRoot = Join-Path $env:USERPROFILE 'Suwayomi'
$StartupFile = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Suwayomi-AutoStart.bat'

$script:Launcher  = $null
$script:Starting  = $false
$script:StartTime = Get-Date
$script:AllowExit = $false

# ---------------- Funciones ----------------
function Msg($text, $icon = 'Information') {
    [void][System.Windows.Forms.MessageBox]::Show($text, 'Suwayomi', 'OK', $icon)
}

function Write-Log($text) {
    $txtLog.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format 'HH:mm:ss'), $text))
}

function Test-Port($portNum) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $portNum, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(300) -and $c.Connected
        $c.Close()
        return $ok
    } catch { return $false }
}

function Test-Server {
    return (Test-Port $Port)
}

function Get-Launcher {
    if (-not (Test-Path $InstallRoot)) { return $null }
    Get-ChildItem -Path $InstallRoot -Filter 'Suwayomi-Launcher.jar' -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
}

function Get-SuwayomiProcesses {
    Get-CimInstance Win32_Process |
        Where-Object { $_.Name -match 'java' -and $_.CommandLine -match 'Suwayomi' }
}

function Start-MobileServer {
    if (Test-Port $MobilePort) { return }
    $srv = Join-Path $Root 'mobile-server.ps1'
    if (-not (Test-Path $srv)) { return }
    Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $srv -WindowStyle Hidden
}

function Stop-MobileServer {
    $procs = Get-CimInstance Win32_Process |
        Where-Object { $_.Name -match 'powershell' -and $_.CommandLine -match 'mobile-server\.ps1' }
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-SuwayomiNow {
    $script:Launcher = Get-Launcher
    if (-not $script:Launcher) { Msg 'Suwayomi no esta instalado. Pulsa "1. Instalar Suwayomi".' 'Warning'; return }
    Start-MobileServer
    $dir = $script:Launcher.DirectoryName
    $java = $null
    $jre = Join-Path $dir 'jre\bin\javaw.exe'
    if (Test-Path $jre) { $java = $jre }
    else {
        $cmd = Get-Command javaw.exe -ErrorAction SilentlyContinue
        if ($cmd) { $java = $cmd.Source }
    }
    if (-not $java) { Msg 'No se encontro Java. Reinstala Suwayomi con el boton "1. Instalar Suwayomi".' 'Error'; return }
    $serverJar = Join-Path $dir 'bin\Suwayomi-Server.jar'
    if (Test-Path $serverJar) {
        Start-Process -FilePath $java -ArgumentList `
            '-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false', `
            '-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false', `
            '-jar', 'bin\Suwayomi-Server.jar' -WorkingDirectory $dir -WindowStyle Hidden
    } else {
        Start-Process -FilePath $java -ArgumentList '--add-exports=java.desktop/sun.awt=ALL-UNNAMED', '-jar', 'Suwayomi-Launcher.jar' -WorkingDirectory $dir -WindowStyle Hidden
    }
    $script:Starting  = $true
    $script:StartTime = Get-Date
    Write-Log 'Encendiendo Suwayomi, puede tardar unos segundos...'
    Update-State
}

function Stop-SuwayomiNow {
    $procs = Get-SuwayomiProcesses
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-MobileServer
    $script:Starting = $false
    Write-Log 'Suwayomi apagado.'
    Update-State
}

function Run-Visible($scriptName, $scriptArgs = '') {
    $path = Join-Path $Root $scriptName
    if (-not (Test-Path $path)) { Msg "No se encuentra $scriptName en la carpeta." 'Error'; return }
    $cmd = "& '$path' $scriptArgs; Write-Host ''; Read-Host 'Terminado. Pulsa Enter para cerrar esta ventana'"
    Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
}

function Update-AutoStartLabel {
    if (Test-Path $StartupFile) {
        $btnAutoStart.Text = 'Inicio con Windows: SI'
        $btnAutoStart.ForeColor = [System.Drawing.Color]::FromArgb(20, 120, 50)
    } else {
        $btnAutoStart.Text = 'Inicio con Windows: NO'
        $btnAutoStart.ForeColor = [System.Drawing.Color]::Black
    }
}

function Update-State {
    $script:Launcher = Get-Launcher
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

    $btnStart.Enabled     = $inst -and (-not $up) -and (-not $script:Starting)
    $btnStop.Enabled      = $up -or $script:Starting
    $btnOpen.Enabled      = $up
    $btnInstall.Enabled   = -not $inst
    $btnSources.Enabled   = $up
    $btnHistory.Enabled   = $inst
    $btnScan.Enabled      = $inst
    $btnUpdate.Enabled    = $inst
    $btnBackup.Enabled    = $inst
    $btnAutoStart.Enabled = $inst
    $btnMobile.Enabled    = $inst
    Update-AutoStartLabel
}

function New-Btn($text, $x, $y, $w, $h, $color) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text
    $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, $h)
    $b.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
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
$form.ClientSize = New-Object System.Drawing.Size(500, 650)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(20, 8)
$lblStatus.Size = New-Object System.Drawing.Size(460, 42)
$lblStatus.TextAlign = 'MiddleCenter'
$lblStatus.Font = New-Object System.Drawing.Font('Segoe UI', 19, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($lblStatus)

$green = [System.Drawing.Color]::FromArgb(30, 140, 60)
$red   = [System.Drawing.Color]::FromArgb(190, 40, 40)
$blue  = [System.Drawing.Color]::FromArgb(30, 100, 190)

New-Section 'USO DIARIO' 54
$btnStart = New-Btn 'Encender'  20  74 225 46 $green
$btnStop  = New-Btn 'Apagar'    255 74 225 46 $red
$btnOpen  = New-Btn 'Abrir Suwayomi en el navegador' 20 126 460 40 $blue

New-Section 'PRIMERA VEZ' 176
$btnInstall = New-Btn '1. Instalar Suwayomi'                 20  196 225 36 $null
$btnSources = New-Btn '2. Anadir repositorio de extensiones' 255 196 225 36 $null

New-Section 'MANTENIMIENTO, COPIAS Y SEGURIDAD' 242
$btnUpdate    = New-Btn 'Actualizar Suwayomi'    20  262 225 34 $null
$btnBackup    = New-Btn 'Copia de seguridad'     255 262 225 34 $null
$btnHistory   = New-Btn 'Borrar historial'       20  302 225 34 $null
$btnScan      = New-Btn 'Escanear extensiones'   255 302 225 34 $null
$btnAutoStart = New-Btn 'Inicio con Windows: NO' 20  342 225 34 $null
$btnLog       = New-Btn 'Ver registro'           255 342 108 34 $null
$btnFolder    = New-Btn 'Carpeta datos'          372 342 108 34 $null

New-Section 'ACCESO DESDE EL MOVIL (por datos o WiFi)' 386
$btnMobile = New-Btn 'Acceso desde el movil (Tailscale + App)' 20 406 460 40 $blue

$tip = New-Object System.Windows.Forms.ToolTip
$tip.SetToolTip($btnUpdate, 'Comprueba la ultima version oficial en GitHub y actualiza conservando tu biblioteca')
$tip.SetToolTip($btnBackup, 'Crea o restaura copias de seguridad (database.mv.db y .tachibk para Mihon/Tachiyomi)')
$tip.SetToolTip($btnHistory, 'Borra el historial de lectura (con copia de seguridad)')
$tip.SetToolTip($btnScan, 'Comprueba las extensiones instaladas en VirusTotal (necesita una API key gratuita)')
$tip.SetToolTip($btnAutoStart, 'Arranca Suwayomi y el servidor movil automaticamente al encender Windows (reversible)')
$tip.SetToolTip($btnMobile, 'Abre el asistente visual de Tailscale: acceso privado HTTPS, codigo QR y control de suspension')

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(20, 456)
$txtLog.Size = New-Object System.Drawing.Size(460, 182)
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.BackColor = [System.Drawing.Color]::White
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 8.5)
$form.Controls.Add($txtLog)

# ---------------- Icono en bandeja del sistema (System Tray) ----------------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Application
$tray.Text = 'Suwayomi - Panel de control'
$tray.Visible = $true

$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$miShow  = $trayMenu.Items.Add('Mostrar panel')
$miOpen  = $trayMenu.Items.Add('Abrir en navegador')
$miStart = $trayMenu.Items.Add('Encender Suwayomi')
$miStop  = $trayMenu.Items.Add('Apagar Suwayomi')
[void]$trayMenu.Items.Add('-')
$miExit  = $trayMenu.Items.Add('Cerrar panel (salir)')
$tray.ContextMenuStrip = $trayMenu

$miShow.Add_Click({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })
$miOpen.Add_Click({ if (Test-Server) { Start-Process $Url } })
$miStart.Add_Click({ if (-not (Test-Server)) { Start-SuwayomiNow } })
$miStop.Add_Click({ Stop-SuwayomiNow })
$miExit.Add_Click({ $script:AllowExit = $true; $form.Close() })
$tray.Add_DoubleClick({ $form.Show(); $form.WindowState = 'Normal'; $form.Activate() })

$form.Add_Resize({
    if ($form.WindowState -eq 'Minimized') {
        $form.Hide()
        $tray.ShowBalloonTip(2000, 'Suwayomi', 'El panel sigue en la bandeja del sistema. Doble clic para abrirlo.', 'Info')
    }
})

# ---------------- Acciones ----------------
$btnStart.Add_Click({ Start-SuwayomiNow })
$btnStop.Add_Click({ Stop-SuwayomiNow })
$btnOpen.Add_Click({ Start-Process $Url })

$btnInstall.Add_Click({
    Write-Log 'Abriendo el instalador. Espera a que termine en la otra ventana.'
    Run-Visible 'install.ps1'
})

$btnSources.Add_Click({
    Write-Log 'Anadiendo repositorio. Mira la otra ventana.'
    Run-Visible 'setup-sources.ps1'
})

$btnUpdate.Add_Click({
    Write-Log 'Comprobando actualizaciones de Suwayomi en GitHub...'
    Run-Visible 'update-suwayomi.ps1'
})

$btnBackup.Add_Click({
    Write-Log 'Abriendo asistente de copias de seguridad y restauracion...'
    Run-Visible 'backup-restore.ps1'
})

$btnAutoStart.Add_Click({
    if (Test-Path $StartupFile) {
        Remove-Item -Path $StartupFile -Force -ErrorAction SilentlyContinue
        Write-Log 'Inicio automatico con Windows DESACTIVADO.'
    } else {
        $l = Get-Launcher
        if (-not $l) { Msg 'Instala Suwayomi primero.' 'Warning'; return }
        $dir = $l.DirectoryName
        $jre = Join-Path $dir 'jre\bin\javaw.exe'
        $javaCmd = if (Test-Path $jre) { "`"$jre`"" } else { 'javaw.exe' }
        $srvJar = Join-Path $dir 'bin\Suwayomi-Server.jar'
        $mobileSrv = Join-Path $Root 'mobile-server.ps1'
        $lines = @(
            '@echo off',
            "cd /d `"$dir`"",
            "start `"`" $javaCmd -Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false -Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false -jar `"$srvJar`"",
            "if exist `"$mobileSrv`" start `"`" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$mobileSrv`""
        )
        Set-Content -Path $StartupFile -Value ($lines -join "`r`n") -Encoding ASCII
        Write-Log 'Inicio automatico con Windows ACTIVADO (Suwayomi + app movil arrancaran solos al iniciar sesion).'
    }
    Update-AutoStartLabel
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
    if (Test-Server) { Start-MobileServer }
    if (-not $script:Launcher) { Write-Log 'Bienvenido. Pulsa "1. Instalar Suwayomi" para empezar.' }
    else { Write-Log 'Listo. Minimizar oculta el panel en la bandeja del sistema.' }
    $timer.Start()
})

$form.Add_FormClosing({
    $timer.Stop()
    $tray.Visible = $false
    $tray.Dispose()
})

[void]$form.ShowDialog()
