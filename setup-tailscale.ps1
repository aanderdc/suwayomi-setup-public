<#
.SYNOPSIS
    Asistente visual para configurar el acceso a Suwayomi desde el movil con Tailscale.

.DESCRIPTION
    Crea un acceso privado HTTPS (Tailscale Serve) hacia Suwayomi en este PC:
      - No abre puertos en el router ni cambia el firewall de Windows.
      - No expone Suwayomi a Internet (nunca activa Funnel).
      - Solo los dispositivos con TU cuenta de Tailscale pueden entrar.
      - Genera un codigo QR local (sin internet) para abrirlo directo en el movil.
      - Permite evitar que el PC se suspenda enchufado (y restaurarlo con un clic).
#>
param(
    [switch]$SelfTest
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------------- Generador QR local (ISO/IEC 18004, sin dependencias) ----------------
$qrSource = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Text;

public static class LocalQrCode {
    private struct Spec {
        public int Version;
        public int EcFormatBits; // L=1 (01), M=0 (00)
        public int DataCodewords;
        public int EcPerBlock;
        public int NumBlocks;
        public int AlignCoord; // 0 for v1
    }

    // V1-M..V6-M (hasta 106 bytes) y V6-L (hasta 134 bytes)
    private static readonly Spec[] Specs = new Spec[] {
        new Spec { Version = 1, EcFormatBits = 0, DataCodewords = 16,  EcPerBlock = 10, NumBlocks = 1, AlignCoord = 0  },
        new Spec { Version = 2, EcFormatBits = 0, DataCodewords = 28,  EcPerBlock = 16, NumBlocks = 1, AlignCoord = 18 },
        new Spec { Version = 3, EcFormatBits = 0, DataCodewords = 44,  EcPerBlock = 26, NumBlocks = 1, AlignCoord = 22 },
        new Spec { Version = 4, EcFormatBits = 0, DataCodewords = 64,  EcPerBlock = 18, NumBlocks = 2, AlignCoord = 26 },
        new Spec { Version = 5, EcFormatBits = 0, DataCodewords = 86,  EcPerBlock = 24, NumBlocks = 2, AlignCoord = 30 },
        new Spec { Version = 6, EcFormatBits = 0, DataCodewords = 108, EcPerBlock = 16, NumBlocks = 4, AlignCoord = 34 },
        new Spec { Version = 6, EcFormatBits = 1, DataCodewords = 136, EcPerBlock = 18, NumBlocks = 2, AlignCoord = 34 }
    };

    private static byte GfMul(byte x, byte y) {
        int z = 0;
        for (int i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >> 7) * 0x11D);
            z ^= ((y >> i) & 1) * x;
        }
        return (byte)z;
    }

    private static byte[] RsGenerator(int degree) {
        byte[] poly = new byte[degree];
        poly[degree - 1] = 1;
        byte root = 1;
        for (int i = 0; i < degree; i++) {
            for (int j = 0; j < degree; j++) {
                poly[j] = GfMul(poly[j], root);
                if (j + 1 < degree) poly[j] ^= poly[j + 1];
            }
            root = GfMul(root, 0x02);
        }
        return poly;
    }

    private static byte[] RsRemainder(byte[] data, int offset, int length, byte[] gen) {
        byte[] rem = new byte[gen.Length];
        for (int i = 0; i < length; i++) {
            byte factor = (byte)(data[offset + i] ^ rem[0]);
            Array.Copy(rem, 1, rem, 0, rem.Length - 1);
            rem[rem.Length - 1] = 0;
            for (int j = 0; j < gen.Length; j++) {
                rem[j] ^= GfMul(gen[j], factor);
            }
        }
        return rem;
    }

    private static void AddBits(List<bool> bits, int val, int len) {
        for (int i = len - 1; i >= 0; i--) bits.Add(((val >> i) & 1) != 0);
    }

    private static void SetFunction(bool[,] mod, bool[,] isFunc, int r, int c, bool dark) {
        mod[r, c] = dark;
        isFunc[r, c] = true;
    }

    private static void DrawFinder(bool[,] mod, bool[,] isFunc, int size, int cr, int cc) {
        for (int dr = -4; dr <= 4; dr++) {
            for (int dc = -4; dc <= 4; dc++) {
                int r = cr + dr, c = cc + dc;
                if (r < 0 || r >= size || c < 0 || c >= size) continue;
                int dist = Math.Max(Math.Abs(dr), Math.Abs(dc));
                bool dark = (dist != 2 && dist != 4);
                SetFunction(mod, isFunc, r, c, dark);
            }
        }
    }

    private static void DrawAlignment(bool[,] mod, bool[,] isFunc, int cr, int cc) {
        for (int dr = -2; dr <= 2; dr++) {
            for (int dc = -2; dc <= 2; dc++) {
                int dist = Math.Max(Math.Abs(dr), Math.Abs(dc));
                SetFunction(mod, isFunc, cr + dr, cc + dc, dist != 1);
            }
        }
    }

    private static void DrawFormat(bool[,] mod, bool[,] isFunc, int size, int ecFormatBits, int mask) {
        int data = (ecFormatBits << 3) | mask;
        int rem = data;
        for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        int bits = ((data << 10) | rem) ^ 0x5412;

        // Copia 1 (arriba-izquierda)
        for (int i = 0; i <= 5; i++) SetFunction(mod, isFunc, 8, i, ((bits >> (14 - i)) & 1) != 0);
        SetFunction(mod, isFunc, 8, 7, ((bits >> 8) & 1) != 0);
        SetFunction(mod, isFunc, 8, 8, ((bits >> 7) & 1) != 0);
        SetFunction(mod, isFunc, 7, 8, ((bits >> 6) & 1) != 0);
        for (int i = 0; i <= 5; i++) SetFunction(mod, isFunc, 5 - i, 8, ((bits >> (5 - i)) & 1) != 0);

        // Copia 2 (abajo-izquierda y arriba-derecha)
        for (int i = 0; i <= 6; i++) SetFunction(mod, isFunc, size - 1 - i, 8, ((bits >> (14 - i)) & 1) != 0);
        for (int i = 0; i <= 7; i++) SetFunction(mod, isFunc, 8, size - 8 + i, ((bits >> (7 - i)) & 1) != 0);
    }

    private static bool MaskBit(int mask, int r, int c) {
        switch (mask) {
            case 0: return ((r + c) & 1) == 0;
            case 1: return (r & 1) == 0;
            case 2: return (c % 3) == 0;
            case 3: return ((r + c) % 3) == 0;
            case 4: return (((r / 2) + (c / 3)) & 1) == 0;
            case 5: return ((r * c) % 2 + (r * c) % 3) == 0;
            case 6: return ((((r * c) % 2) + ((r * c) % 3)) % 2) == 0;
            default: return ((((r + c) % 2) + ((r * c) % 3)) % 2) == 0;
        }
    }

    private static int Penalty(bool[,] m, int size) {
        int score = 0;
        for (int r = 0; r < size; r++) {
            int run = 1;
            for (int c = 1; c < size; c++) {
                if (m[r, c] == m[r, c - 1]) { run++; if (run == 5) score += 3; else if (run > 5) score += 1; }
                else run = 1;
            }
        }
        for (int c = 0; c < size; c++) {
            int run = 1;
            for (int r = 1; r < size; r++) {
                if (m[r, c] == m[r - 1, c]) { run++; if (run == 5) score += 3; else if (run > 5) score += 1; }
                else run = 1;
            }
        }
        for (int r = 0; r < size - 1; r++) {
            for (int c = 0; c < size - 1; c++) {
                bool b = m[r, c];
                if (b == m[r, c + 1] && b == m[r + 1, c] && b == m[r + 1, c + 1]) score += 3;
            }
        }
        int dark = 0;
        for (int r = 0; r < size; r++) for (int c = 0; c < size; c++) if (m[r, c]) dark++;
        int k = Math.Abs(dark * 20 - size * size * 10) / (size * size);
        score += k * 10;
        return score;
    }

    public static bool[,] EncodeMatrix(string text) {
        byte[] payload = Encoding.UTF8.GetBytes(text);
        Spec chosen = default(Spec);
        bool found = false;
        foreach (Spec s in Specs) {
            if (payload.Length <= s.DataCodewords - 2) { chosen = s; found = true; break; }
        }
        if (!found) throw new ArgumentException("Texto demasiado largo para QR.");

        List<bool> bits = new List<bool>(chosen.DataCodewords * 8);
        AddBits(bits, 0x4, 4); // Modo byte
        AddBits(bits, payload.Length, 8);
        foreach (byte b in payload) AddBits(bits, b, 8);

        int capBits = chosen.DataCodewords * 8;
        int term = Math.Min(4, capBits - bits.Count);
        AddBits(bits, 0, term);
        while ((bits.Count & 7) != 0) bits.Add(false);
        byte[] pad = new byte[] { 0xEC, 0x11 };
        int pIdx = 0;
        while (bits.Count < capBits) { AddBits(bits, pad[pIdx++ & 1], 8); }

        byte[] dataCw = new byte[chosen.DataCodewords];
        for (int i = 0; i < dataCw.Length; i++) {
            int val = 0;
            for (int j = 0; j < 8; j++) val = (val << 1) | (bits[i * 8 + j] ? 1 : 0);
            dataCw[i] = (byte)val;
        }

        int blockDataLen = chosen.DataCodewords / chosen.NumBlocks;
        byte[] gen = RsGenerator(chosen.EcPerBlock);
        byte[][] ecBlocks = new byte[chosen.NumBlocks][];
        for (int b = 0; b < chosen.NumBlocks; b++) {
            ecBlocks[b] = RsRemainder(dataCw, b * blockDataLen, blockDataLen, gen);
        }

        List<byte> allCw = new List<byte>(chosen.DataCodewords + chosen.NumBlocks * chosen.EcPerBlock);
        for (int i = 0; i < blockDataLen; i++) {
            for (int b = 0; b < chosen.NumBlocks; b++) allCw.Add(dataCw[b * blockDataLen + i]);
        }
        for (int i = 0; i < chosen.EcPerBlock; i++) {
            for (int b = 0; b < chosen.NumBlocks; b++) allCw.Add(ecBlocks[b][i]);
        }

        int size = chosen.Version * 4 + 17;
        bool[,] baseMod = new bool[size, size];
        bool[,] isFunc  = new bool[size, size];

        // Timing
        for (int i = 0; i < size; i++) {
            SetFunction(baseMod, isFunc, 6, i, (i & 1) == 0);
            SetFunction(baseMod, isFunc, i, 6, (i & 1) == 0);
        }
        // Finders
        DrawFinder(baseMod, isFunc, size, 3, 3);
        DrawFinder(baseMod, isFunc, size, 3, size - 4);
        DrawFinder(baseMod, isFunc, size, size - 4, 3);
        // Alignment (v2..v6)
        if (chosen.AlignCoord > 0) DrawAlignment(baseMod, isFunc, chosen.AlignCoord, chosen.AlignCoord);
        // Dark module
        SetFunction(baseMod, isFunc, size - 8, 8, true);
        // Reserva formato
        DrawFormat(baseMod, isFunc, size, chosen.EcFormatBits, 0);

        // Colocar datos en zigzag
        int bitIdx = 0;
        int totalBits = allCw.Count * 8;
        bool upward = true;
        for (int right = size - 1; right >= 1; right -= 2) {
            if (right == 6) right = 5;
            for (int step = 0; step < size; step++) {
                int r = upward ? (size - 1 - step) : step;
                for (int dx = 0; dx < 2; dx++) {
                    int c = right - dx;
                    if (!isFunc[r, c]) {
                        bool dark = false;
                        if (bitIdx < totalBits) {
                            dark = ((allCw[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) != 0;
                            bitIdx++;
                        }
                        baseMod[r, c] = dark;
                    }
                }
            }
            upward = !upward;
        }

        // Elegir la mejor mascara
        bool[,] best = null;
        int bestScore = int.MaxValue;
        for (int mask = 0; mask < 8; mask++) {
            bool[,] cand = (bool[,])baseMod.Clone();
            for (int r = 0; r < size; r++) {
                for (int c = 0; c < size; c++) {
                    if (!isFunc[r, c] && MaskBit(mask, r, c)) cand[r, c] = !cand[r, c];
                }
            }
            DrawFormat(cand, isFunc, size, chosen.EcFormatBits, mask);
            int sc = Penalty(cand, size);
            if (sc < bestScore) { bestScore = sc; best = cand; }
        }
        return best;
    }

    public static Bitmap RenderBitmap(string text, int pixelSize) {
        bool[,] mat = EncodeMatrix(text);
        int n = mat.GetLength(0);
        int quiet = 4;
        int total = n + quiet * 2;
        int scale = Math.Max(2, pixelSize / total);
        int imgDim = total * scale;
        Bitmap bmp = new Bitmap(imgDim, imgDim);
        using (Graphics g = Graphics.FromImage(bmp)) {
            g.Clear(Color.White);
            for (int r = 0; r < n; r++) {
                for (int c = 0; c < n; c++) {
                    if (mat[r, c]) {
                        g.FillRectangle(Brushes.Black, (c + quiet) * scale, (r + quiet) * scale, scale, scale);
                    }
                }
            }
        }
        return bmp;
    }
}
'@
if (-not ('LocalQrCode' -as [type])) {
    Add-Type -TypeDefinition $qrSource -ReferencedAssemblies System.Drawing
}

# ---------------- Configuracion ----------------
$Root        = $PSScriptRoot
$Port        = 4567
$MobilePort  = 4568
$DataDir     = Join-Path $env:LOCALAPPDATA 'Tachidesk'
$InstallRoot = Join-Path $env:USERPROFILE 'Suwayomi'
$SleepBackup = Join-Path $DataDir 'tailscale-sleep-backup.txt'

$script:Busy         = $false
$script:CancelFlow   = $false
$script:LastQrUrl    = ''
$script:CurrentUrl   = ''
$script:UseMobileUi  = $true

function Start-MobileServer {
    if (Test-LocalPort $MobilePort) { return $true }
    $srv = Join-Path $Root 'mobile-server.ps1'
    if (-not (Test-Path $srv)) { return $false }
    try {
        Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $srv -WindowStyle Hidden
        return $true
    } catch { return $false }
}

function Ensure-MobileServeRoute($ts) {
    if (-not $ts) { return }
    try {
        & $ts serve --bg --set-path /movil "http://127.0.0.1:$MobilePort" 2>$null | Out-Null
    } catch { }
}

# ---------------- Utilidades ----------------
function Find-Tailscale {
    $p = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (Test-Path $p) { return $p }
    $c = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return $null
}

function Get-TsStatus($ts) {
    if (-not $ts) { return $null }
    try {
        $txt = & $ts status --json 2>$null | Out-String
        if ($txt -and $txt.Trim()) { return ($txt | ConvertFrom-Json) }
    } catch { }
    return $null
}

function Get-TsServeStatus($ts) {
    if (-not $ts) { return $null }
    try {
        $txt = & $ts serve status --json 2>$null | Out-String
        if ($txt -and $txt.Trim()) { return ($txt | ConvertFrom-Json) }
    } catch { }
    return $null
}

function Test-LocalPort($portNum) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $portNum, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(350) -and $c.Connected
        $c.Close()
        return $ok
    } catch { return $false }
}

function Get-SuwayomiLauncher {
    if (-not (Test-Path $InstallRoot)) { return $null }
    Get-ChildItem -Path $InstallRoot -Filter 'Suwayomi-Launcher.jar' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Start-SuwayomiServer {
    Start-MobileServer | Out-Null
    $launcher = Get-SuwayomiLauncher
    if (-not $launcher) { return $false }
    $dir = $launcher.DirectoryName
    $java = $null
    $jre = Join-Path $dir 'jre\bin\javaw.exe'
    if (Test-Path $jre) { $java = $jre }
    else {
        $cmd = Get-Command javaw.exe -ErrorAction SilentlyContinue
        if ($cmd) { $java = $cmd.Source }
    }
    if (-not $java) { return $false }
    $serverJar = Join-Path $dir 'bin\Suwayomi-Server.jar'
    if (Test-Path $serverJar) {
        Start-Process -FilePath $java -ArgumentList `
            '-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false', `
            '-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false', `
            '-jar', 'bin\Suwayomi-Server.jar' -WorkingDirectory $dir -WindowStyle Hidden
    } else {
        Start-Process -FilePath $java -ArgumentList '--add-exports=java.desktop/sun.awt=ALL-UNNAMED', '-jar', 'Suwayomi-Launcher.jar' -WorkingDirectory $dir -WindowStyle Hidden
    }
    return $true
}

function Get-AcSleepMinutes {
    # Lee el tiempo de suspension enchufado (AC) en cualquier idioma de Windows.
    try {
        $out = (& powercfg /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null) -join "`n"
        $matchesHex = [regex]::Matches($out, '0x([0-9a-fA-F]{8})')
        if ($matchesHex.Count -ge 2) {
            # Penultimo valor = AC (enchufado), ultimo = DC (bateria)
            $secs = [Convert]::ToInt32($matchesHex[$matchesHex.Count - 2].Groups[1].Value, 16)
            return [int][Math]::Round($secs / 60.0)
        }
    } catch { }
    return -1
}

function Get-SavedSleepMinutes {
    if (Test-Path $SleepBackup) {
        try {
            $v = [int]((Get-Content $SleepBackup -Raw).Trim())
            if ($v -gt 0) { return $v }
        } catch { }
    }
    return 30
}

function Get-MobileState {
    $ts = Find-Tailscale
    $installed = [bool]$ts
    $st = if ($installed) { Get-TsStatus $ts } else { $null }
    $loggedIn = ($st -and $st.BackendState -eq 'Running')

    $dns = ''
    $peerCount = 0
    $onlinePeers = 0
    if ($loggedIn) {
        if ($st.Self -and $st.Self.DNSName) {
            $dns = "$($st.Self.DNSName)".TrimEnd('.')
        }
        if ($st.Peer) {
            foreach ($prop in $st.Peer.PSObject.Properties) {
                $peerCount++
                if ($prop.Value.Online) { $onlinePeers++ }
            }
        }
    }

    $serveActive = $false
    $mobileRouteActive = $false
    $funnelActive = $false
    $serveUrl = ''
    if ($loggedIn) {
        $sv = Get-TsServeStatus $ts
        if ($sv) {
            if ($sv.AllowFunnel) {
                foreach ($fp in $sv.AllowFunnel.PSObject.Properties) {
                    if ($fp.Value -eq $true) { $funnelActive = $true }
                }
            }
            if ($sv.Web) {
                foreach ($wp in $sv.Web.PSObject.Properties) {
                    $hostPort = $wp.Name
                    $handlers = $wp.Value.Handlers
                    if ($handlers) {
                        foreach ($hp in $handlers.PSObject.Properties) {
                            $proxy = "$($hp.Value.Proxy)"
                            if ($proxy -match ":$Port(/|$)") {
                                $serveActive = $true
                                $hostOnly = ($hostPort -split ':')[0]
                                $serveUrl = "https://$hostOnly/"
                            }
                            if ($hp.Name -match '^/movil' -and $proxy -match ":$MobilePort(/|$)") {
                                $mobileRouteActive = $true
                            }
                        }
                    }
                }
            }
        }
    }

    if (-not $serveUrl -and $dns) { $serveUrl = "https://$dns/" }
    $mobileUrl = if ($serveUrl) { ($serveUrl.TrimEnd('/')) + '/movil/' } else { '' }
    $activeUrl = if ($serveActive) { if ($script:UseMobileUi) { $mobileUrl } else { $serveUrl } } else { '' }

    return [pscustomobject]@{
        TailscaleExe      = $ts
        Installed         = $installed
        LoggedIn          = $loggedIn
        DnsName           = $dns
        PeerCount         = $peerCount
        OnlinePeers       = $onlinePeers
        ServeActive       = $serveActive
        MobileRouteActive = $mobileRouteActive
        MobileServerUp    = (Test-LocalPort $MobilePort)
        FunnelActive      = $funnelActive
        BaseUrl           = if ($serveActive) { $serveUrl } else { '' }
        Url               = $activeUrl
        SuwayomiUp        = (Test-LocalPort $Port)
        SuwayomiInst      = [bool](Get-SuwayomiLauncher)
        AcSleepMin        = (Get-AcSleepMinutes)
    }
}

if ($SelfTest) {
    $st = Get-MobileState
    $bmp = [LocalQrCode]::RenderBitmap('https://example.tail00000.ts.net/', 168)
    Write-Output ("SELFTEST_OK Installed={0} LoggedIn={1} ServeActive={2} Funnel={3} AcSleepMin={4} QrDim={5}x{6}" -f `
        $st.Installed, $st.LoggedIn, $st.ServeActive, $st.FunnelActive, $st.AcSleepMin, $bmp.Width, $bmp.Height)
    $bmp.Dispose()
    exit 0
}

# ---------------- Interfaz ----------------
$cGreen  = [System.Drawing.Color]::FromArgb(30, 140, 60)
$cAmber  = [System.Drawing.Color]::FromArgb(200, 120, 0)
$cRed    = [System.Drawing.Color]::FromArgb(190, 40, 40)
$cBlue   = [System.Drawing.Color]::FromArgb(30, 100, 190)
$cGray   = [System.Drawing.Color]::FromArgb(110, 110, 110)
$cBgCard = [System.Drawing.Color]::White

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Suwayomi - Acceso desde el movil (Tailscale)'
$form.ClientSize = New-Object System.Drawing.Size(560, 654)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

function Add-Section($text, $y) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.Location = New-Object System.Drawing.Point(20, $y)
    $l.Size = New-Object System.Drawing.Size(520, 18)
    $l.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $l.ForeColor = [System.Drawing.Color]::Gray
    $form.Controls.Add($l)
}

function Add-FlatBtn($parent, $text, $x, $y, $w, $h, $color) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text
    $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, $h)
    $b.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    $b.FlatStyle = 'Flat'
    $b.Cursor = 'Hand'
    if ($color) { $b.BackColor = $color; $b.ForeColor = [System.Drawing.Color]::White }
    $parent.Controls.Add($b)
    return $b
}

# Cabecera de estado
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(20, 10)
$lblStatus.Size = New-Object System.Drawing.Size(520, 38)
$lblStatus.TextAlign = 'MiddleCenter'
$lblStatus.Font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($lblStatus)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Location = New-Object System.Drawing.Point(20, 48)
$lblSub.Size = New-Object System.Drawing.Size(520, 20)
$lblSub.TextAlign = 'MiddleCenter'
$lblSub.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
$lblSub.ForeColor = $cGray
$lblSub.Text = 'Acceso privado por HTTPS: no abre puertos en el router ni publica nada en Internet.'
$form.Controls.Add($lblSub)

# Tarjeta de lista de comprobacion
Add-Section 'ESTADO ACTUAL' 76
$pnlCheck = New-Object System.Windows.Forms.Panel
$pnlCheck.Location = New-Object System.Drawing.Point(20, 96)
$pnlCheck.Size = New-Object System.Drawing.Size(520, 108)
$pnlCheck.BackColor = $cBgCard
$pnlCheck.BorderStyle = 'FixedSingle'
$form.Controls.Add($pnlCheck)

function Add-CheckRow($y) {
    $l = New-Object System.Windows.Forms.Label
    $l.Location = New-Object System.Drawing.Point(12, $y)
    $l.Size = New-Object System.Drawing.Size(494, 22)
    $l.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    $pnlCheck.Controls.Add($l)
    return $l
}

$lblStep1 = Add-CheckRow 8
$lblStep2 = Add-CheckRow 32
$lblStep3 = Add-CheckRow 56
$lblStep4 = Add-CheckRow 80

# Botones principales
$btnAction  = Add-FlatBtn $form 'Activar acceso desde el movil' 20  214 340 42 $cBlue
$btnDisable = Add-FlatBtn $form 'Desactivar acceso'             370 214 170 42 $null

# Tarjeta "En tu movil" con QR
Add-Section 'EN TU MOVIL (ANDROID O IPHONE)' 268
$pnlPhone = New-Object System.Windows.Forms.Panel
$pnlPhone.Location = New-Object System.Drawing.Point(20, 288)
$pnlPhone.Size = New-Object System.Drawing.Size(520, 198)
$pnlPhone.BackColor = $cBgCard
$pnlPhone.BorderStyle = 'FixedSingle'
$form.Controls.Add($pnlPhone)

$picQr = New-Object System.Windows.Forms.PictureBox
$picQr.Location = New-Object System.Drawing.Point(12, 14)
$picQr.Size = New-Object System.Drawing.Size(168, 168)
$picQr.SizeMode = 'CenterImage'
$picQr.BorderStyle = 'FixedSingle'
$picQr.BackColor = [System.Drawing.Color]::FromArgb(248, 248, 248)
$pnlPhone.Controls.Add($picQr)

$lblQrPlaceholder = New-Object System.Windows.Forms.Label
$lblQrPlaceholder.Location = New-Object System.Drawing.Point(16, 18)
$lblQrPlaceholder.Size = New-Object System.Drawing.Size(160, 160)
$lblQrPlaceholder.TextAlign = 'MiddleCenter'
$lblQrPlaceholder.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
$lblQrPlaceholder.ForeColor = $cGray
$lblQrPlaceholder.BackColor = [System.Drawing.Color]::FromArgb(248, 248, 248)
$lblQrPlaceholder.Text = "El codigo QR aparecera aqui al activar el acceso."
$pnlPhone.Controls.Add($lblQrPlaceholder)
$lblQrPlaceholder.BringToFront()

$lblUrlCap = New-Object System.Windows.Forms.Label
$lblUrlCap.Location = New-Object System.Drawing.Point(194, 10)
$lblUrlCap.Size = New-Object System.Drawing.Size(145, 18)
$lblUrlCap.Font = New-Object System.Drawing.Font('Segoe UI', 8.5, [System.Drawing.FontStyle]::Bold)
$lblUrlCap.Text = 'Tu enlace privado:'
$pnlPhone.Controls.Add($lblUrlCap)

$chkMobileUi = New-Object System.Windows.Forms.CheckBox
$chkMobileUi.Location = New-Object System.Drawing.Point(344, 9)
$chkMobileUi.Size = New-Object System.Drawing.Size(166, 20)
$chkMobileUi.Font = New-Object System.Drawing.Font('Segoe UI', 8)
$chkMobileUi.Text = 'Lector movil (estilo app)'
$chkMobileUi.Checked = $true
$pnlPhone.Controls.Add($chkMobileUi)
$chkMobileUi.Add_CheckedChanged({
    $script:UseMobileUi = $chkMobileUi.Checked
    Update-Ui
})

$txtUrl = New-Object System.Windows.Forms.TextBox
$txtUrl.Location = New-Object System.Drawing.Point(194, 32)
$txtUrl.Size = New-Object System.Drawing.Size(314, 24)
$txtUrl.ReadOnly = $true
$txtUrl.Font = New-Object System.Drawing.Font('Consolas', 9)
$txtUrl.BackColor = [System.Drawing.Color]::FromArgb(248, 248, 248)
$pnlPhone.Controls.Add($txtUrl)

$btnCopy = Add-FlatBtn $pnlPhone 'Copiar enlace' 194 62 152 30 $null
$btnTest = Add-FlatBtn $pnlPhone 'Probar aqui'   356 62 152 30 $null

$lblStepsPhone = New-Object System.Windows.Forms.Label
$lblStepsPhone.Location = New-Object System.Drawing.Point(194, 100)
$lblStepsPhone.Size = New-Object System.Drawing.Size(314, 90)
$lblStepsPhone.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
$lblStepsPhone.ForeColor = [System.Drawing.Color]::FromArgb(55, 55, 55)
$lblStepsPhone.Text = "1. Instala la app Tailscale en tu movil.`r`n" +
                      "2. Entra con la MISMA cuenta y conectalo.`r`n" +
                      "3. Escanea el QR (o abre el enlace) con WiFi o datos.`r`n" +
                      "Consejo: en el navegador usa 'Anadir a pantalla de inicio'."
$pnlPhone.Controls.Add($lblStepsPhone)

# Tarjeta de suspension de Windows
Add-Section 'SUSPENSION DEL PC (SI SE DUERME, SE CORTA EL ACCESO)' 496
$pnlSleep = New-Object System.Windows.Forms.Panel
$pnlSleep.Location = New-Object System.Drawing.Point(20, 516)
$pnlSleep.Size = New-Object System.Drawing.Size(520, 62)
$pnlSleep.BackColor = $cBgCard
$pnlSleep.BorderStyle = 'FixedSingle'
$form.Controls.Add($pnlSleep)

$lblSleep = New-Object System.Windows.Forms.Label
$lblSleep.Location = New-Object System.Drawing.Point(12, 10)
$lblSleep.Size = New-Object System.Drawing.Size(310, 20)
$lblSleep.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$pnlSleep.Controls.Add($lblSleep)

$lblSleepNote = New-Object System.Windows.Forms.Label
$lblSleepNote.Location = New-Object System.Drawing.Point(12, 34)
$lblSleepNote.Size = New-Object System.Drawing.Size(310, 18)
$lblSleepNote.Font = New-Object System.Drawing.Font('Segoe UI', 8)
$lblSleepNote.ForeColor = $cGray
$lblSleepNote.Text = 'La pantalla podra seguir apagandose normalmente.'
$pnlSleep.Controls.Add($lblSleepNote)

$btnSleep = Add-FlatBtn $pnlSleep 'Evitar suspension' 332 13 176 34 $null

# Registro breve abajo
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(20, 588)
$txtLog.Size = New-Object System.Drawing.Size(520, 54)
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.BackColor = [System.Drawing.Color]::White
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 8.5)
$form.Controls.Add($txtLog)

function Write-Log($text) {
    $txtLog.AppendText(("[{0}] {1}`r`n" -f (Get-Date -Format 'HH:mm:ss'), $text))
    $txtLog.SelectionStart = $txtLog.TextLength
    $txtLog.ScrollToCaret()
}

function Show-Msg($text, $icon = 'Information') {
    [void][System.Windows.Forms.MessageBox]::Show($form, $text, 'Suwayomi - Acceso movil', 'OK', $icon)
}

function Ask-YesNo($text) {
    $r = [System.Windows.Forms.MessageBox]::Show($form, $text, 'Suwayomi - Acceso movil', 'YesNo', 'Question')
    return ($r -eq 'Yes')
}

function Wait-Ui($ms) {
    $until = (Get-Date).AddMilliseconds($ms)
    while ((Get-Date) -lt $until) {
        [System.Windows.Forms.Application]::DoEvents()
        if ($script:CancelFlow -or -not $form.Visible) { return }
        Start-Sleep -Milliseconds 60
    }
}

function Set-Row($label, $ok, $text, $warn = $false) {
    if ($ok) {
        $label.Text = "[OK]  $text"
        $label.ForeColor = $cGreen
    } elseif ($warn) {
        $label.Text = "[!]   $text"
        $label.ForeColor = $cRed
    } else {
        $label.Text = "[ ]   $text"
        $label.ForeColor = $cGray
    }
}

function Update-Ui {
    $st = Get-MobileState

    # Checklist
    Set-Row $lblStep1 $st.Installed $(if ($st.Installed) { '1. Tailscale instalado en este PC' } else { '1. Tailscale no instalado todavia' })

    $peerTxt = ''
    if ($st.LoggedIn) {
        if ($st.PeerCount -gt 0) {
            $peerTxt = " ($($st.PeerCount) dispositivo(s) mas en tu cuenta)"
        } else {
            $peerTxt = ' (aun sin movil conectado a tu cuenta)'
        }
    }
    Set-Row $lblStep2 $st.LoggedIn $(if ($st.LoggedIn) { "2. Sesion iniciada$peerTxt" } else { '2. Falta iniciar sesion en Tailscale' })

    if ($st.FunnelActive) {
        Set-Row $lblStep3 $false '3. ATENCION: Funnel (acceso publico) esta activo - desactivalo' $true
    } elseif ($st.ServeActive) {
        Set-Row $lblStep3 $true '3. Acceso privado HTTPS activado (solo tus dispositivos)'
    } else {
        Set-Row $lblStep3 $false '3. Falta activar el acceso privado HTTPS'
    }

    Set-Row $lblStep4 $st.SuwayomiUp $(if ($st.SuwayomiUp) { '4. Suwayomi encendido y listo' } else { '4. Suwayomi apagado ahora mismo' })

    # Estado principal y boton
    if ($st.FunnelActive) {
        $lblStatus.Text = 'ATENCION: ACCESO PUBLICO'
        $lblStatus.ForeColor = $cRed
    } elseif ($st.ServeActive -and $st.SuwayomiUp) {
        $lblStatus.Text = 'LISTO PARA EL MOVIL'
        $lblStatus.ForeColor = $cGreen
    } elseif ($st.ServeActive) {
        $lblStatus.Text = 'CONFIGURADO (SUWAYOMI APAGADO)'
        $lblStatus.ForeColor = $cAmber
    } elseif ($st.Installed) {
        $lblStatus.Text = 'FALTA ACTIVAR'
        $lblStatus.ForeColor = $cAmber
    } else {
        $lblStatus.Text = 'NO CONFIGURADO'
        $lblStatus.ForeColor = $cGray
    }

    if (-not $script:Busy) {
        $btnAction.Enabled = $true
        if ($st.FunnelActive) {
            $btnAction.Text = 'Hacerlo privado (desactivar Funnel)'
            $btnAction.BackColor = $cRed
        } elseif ($st.ServeActive -and -not $st.SuwayomiUp) {
            $btnAction.Text = 'Encender Suwayomi ahora'
            $btnAction.BackColor = $cGreen
        } elseif ($st.ServeActive) {
            $btnAction.Text = 'Comprobar conexion'
            $btnAction.BackColor = $cGreen
        } else {
            $btnAction.Text = 'Activar acceso desde el movil'
            $btnAction.BackColor = $cBlue
        }
        $btnDisable.Enabled = ($st.ServeActive -or $st.FunnelActive)
    }

    # URL y QR
    $script:CurrentUrl = $st.Url
    if ($st.ServeActive -and $st.Url) {
        $txtUrl.Text = $st.Url
        $btnCopy.Enabled = $true
        $btnTest.Enabled = $true
        $lblQrPlaceholder.Visible = $false
        if ($script:LastQrUrl -ne $st.Url) {
            try {
                $old = $picQr.Image
                $picQr.Image = [LocalQrCode]::RenderBitmap($st.Url, 160)
                if ($old) { $old.Dispose() }
                $script:LastQrUrl = $st.Url
            } catch {
                $lblQrPlaceholder.Text = 'No se pudo generar el QR. Usa el enlace.'
                $lblQrPlaceholder.Visible = $true
            }
        }
    } else {
        $txtUrl.Text = '(aun no activado)'
        $btnCopy.Enabled = $false
        $btnTest.Enabled = $false
        $lblQrPlaceholder.Visible = $true
        if ($picQr.Image) { $picQr.Image.Dispose(); $picQr.Image = $null }
        $script:LastQrUrl = ''
    }

    # Suspension de Windows
    if ($st.AcSleepMin -eq 0) {
        $lblSleep.Text = 'Enchufado: no se suspende solo'
        $lblSleep.ForeColor = $cGreen
        $prev = Get-SavedSleepMinutes
        $btnSleep.Text = "Restaurar ($prev min)"
        $btnSleep.Enabled = (-not $script:Busy)
    } elseif ($st.AcSleepMin -gt 0) {
        $lblSleep.Text = "Enchufado: se suspende tras $($st.AcSleepMin) min"
        $lblSleep.ForeColor = $cAmber
        $btnSleep.Text = 'Evitar suspension enchufado'
        $btnSleep.Enabled = (-not $script:Busy)
    } else {
        $lblSleep.Text = 'Enchufado: no se pudo leer el ajuste'
        $lblSleep.ForeColor = $cGray
        $btnSleep.Text = 'Evitar suspension enchufado'
        $btnSleep.Enabled = (-not $script:Busy)
    }
}

function Run-TsAndCaptureUrl($tsExe, $argList, $urlPromptText, $successCheck) {
    $outFile = Join-Path $env:TEMP ('ts-step-' + [guid]::NewGuid().ToString('N') + '.out')
    $errFile = Join-Path $env:TEMP ('ts-step-' + [guid]::NewGuid().ToString('N') + '.err')
    $proc = $null
    try {
        $proc = Start-Process -FilePath $tsExe -ArgumentList $argList -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        $openedUrl = $false
        $deadline = (Get-Date).AddMinutes(5)
        while ((Get-Date) -lt $deadline) {
            Wait-Ui 1200
            if ($script:CancelFlow -or -not $form.Visible) { return $false }

            $txt = ''
            foreach ($f in @($outFile, $errFile)) {
                if (Test-Path $f) { $txt += (Get-Content $f -Raw -ErrorAction SilentlyContinue) }
            }
            if (-not $openedUrl -and $txt -match 'https://login\.tailscale\.com/\S+') {
                $authUrl = $Matches[0].TrimEnd('.', ',', ')', ']')
                $openedUrl = $true
                Write-Log 'Abriendo pagina de Tailscale en el navegador...'
                Start-Process $authUrl
                Show-Msg $urlPromptText 'Information'
            }

            if (& $successCheck) { return $true }
            if ($proc.HasExited) {
                # Ultima comprobacion tras salir el proceso
                Start-Sleep -Milliseconds 400
                if (& $successCheck) { return $true }
                if ($txt.Trim()) {
                    $firstLine = ($txt.Trim() -split "`r?`n")[0]
                    Write-Log "Tailscale respondio: $firstLine"
                }
                return $false
            }
        }
        return $false
    } finally {
        if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
        Remove-Item $outFile, $errFile -ErrorAction SilentlyContinue
    }
}

function Set-Busy($state) {
    $script:Busy = $state
    $script:CancelFlow = $false
    $btnAction.Enabled = -not $state
    $btnDisable.Enabled = -not $state
    $btnSleep.Enabled = -not $state
    if ($state) {
        $btnAction.Text = 'Configurando... espera'
    }
}

# ---------------- Acciones ----------------
$btnAction.Add_Click({
    if ($script:Busy) { return }
    $st = Get-MobileState

    # Caso especial: Funnel publico activo -> quitarlo
    if ($st.FunnelActive -and $st.TailscaleExe) {
        Set-Busy $true
        Write-Log 'Desactivando Funnel (acceso publico)...'
        try {
            & $st.TailscaleExe funnel --https=443 off 2>$null | Out-Null
            Write-Log 'Funnel desactivado. El acceso vuelve a ser solo privado.'
        } catch {
            Write-Log "Error desactivando Funnel: $($_.Exception.Message)"
        }
        Set-Busy $false
        Update-Ui
        return
    }

    # Caso: ya esta activo y solo falta encender Suwayomi
    if ($st.ServeActive -and -not $st.SuwayomiUp) {
        if (-not $st.SuwayomiInst) {
            Show-Msg 'Suwayomi no esta instalado todavia. Instala Suwayomi primero desde el panel principal.' 'Warning'
            return
        }
        Set-Busy $true
        Write-Log 'Encendiendo Suwayomi...'
        if (Start-SuwayomiServer) {
            for ($i = 0; $i -lt 30; $i++) {
                Wait-Ui 1000
                if (Test-LocalPort $Port) { break }
            }
            if (Test-LocalPort $Port) { Write-Log 'Suwayomi listo. Ya puedes abrir el enlace en el movil.' }
            else { Write-Log 'Suwayomi sigue iniciando. Espera unos segundos y prueba de nuevo.' }
        } else {
            Show-Msg 'No se pudo arrancar Suwayomi. Enciendelo desde el panel principal.' 'Warning'
        }
        Set-Busy $false
        Update-Ui
        return
    }

    # Caso: ya esta todo listo -> asegurar ruta /movil y servidor movil, comprobar y copiar
    if ($st.ServeActive -and $st.SuwayomiUp) {
        Start-MobileServer | Out-Null
        if (-not $st.MobileRouteActive -and $st.TailscaleExe) { Ensure-MobileServeRoute $st.TailscaleExe }
        try { Set-Clipboard -Value $st.Url } catch { }
        Write-Log "Todo correcto. Enlace privado copiado al portapapeles."
        Show-Msg ("Todo funciona y el acceso es privado.`n`n" +
                  "Enlace (copiado al portapapeles):`n$($st.Url)`n`n" +
                  "Escanea el codigo QR desde tu movil con Tailscale conectado.") 'Information'
        Update-Ui
        return
    }

    # Flujo guiado completo
    Set-Busy $true
    try {
        # Paso 1: Instalar Tailscale
        $ts = Find-Tailscale
        if (-not $ts) {
            $okInstall = Ask-YesNo ("Tailscale no esta instalado en este PC.`n`n" +
                                    "Es gratuito y crea una red privada entre tu PC y tu movil sin abrir puertos del router.`n" +
                                    "Windows puede pedir permiso de administrador.`n`n" +
                                    "Instalar Tailscale ahora?")
            if (-not $okInstall) {
                Write-Log 'Instalacion cancelada.'
                return
            }
            Write-Log 'Instalando Tailscale...'
            if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
                $p = Start-Process winget.exe -ArgumentList 'install', '--id', 'Tailscale.Tailscale', '-e', '--accept-source-agreements', '--accept-package-agreements' -PassThru
                while (-not $p.HasExited) { Wait-Ui 500; if (-not $form.Visible) { return } }
            }
            $ts = Find-Tailscale
            if (-not $ts) {
                Write-Log 'Abriendo la pagina oficial de descarga de Tailscale...'
                Start-Process 'https://tailscale.com/download/windows'
                Show-Msg ("No se pudo instalar automaticamente. Se ha abierto la web oficial de Tailscale.`n`n" +
                          "Descargalo, instalalo y pulsa Aceptar para continuar.") 'Information'
                $ts = Find-Tailscale
            }
            if (-not $ts) {
                Show-Msg 'Tailscale sigue sin detectarse. Cuando termines de instalarlo, vuelve a pulsar el boton.' 'Warning'
                return
            }
            Write-Log 'Tailscale instalado.'
            Update-Ui
        }

        # Paso 2: Asegurar servicio e iniciar sesion
        $tsStatus = Get-TsStatus $ts
        if (-not $tsStatus) {
            $gui = Join-Path (Split-Path $ts) 'tailscale-ipn.exe'
            if (Test-Path $gui) { Start-Process $gui }
            Write-Log 'Iniciando servicio de Tailscale...'
            for ($i = 0; $i -lt 12 -and -not $tsStatus; $i++) {
                Wait-Ui 1500
                $tsStatus = Get-TsStatus $ts
            }
        }
        if (-not $tsStatus) {
            Show-Msg 'No se pudo conectar con Tailscale. Si acabas de instalarlo, espera unos segundos o reinicia el PC y vuelve a pulsar el boton.' 'Warning'
            return
        }

        if ($tsStatus.BackendState -ne 'Running') {
            Write-Log 'Iniciando sesion en Tailscale...'
            $loginMsg = "Se ha abierto la pagina de Tailscale en tu navegador.`n`n" +
                        "1. Inicia sesion (usa la MISMA cuenta que pondras en tu movil).`n" +
                        "2. Pulsa 'Connect'.`n`n" +
                        "Pulsa Aceptar y esta ventana continuara automaticamente."
            $logged = Run-TsAndCaptureUrl $ts @('up') $loginMsg {
                $s = Get-TsStatus $ts
                return ($s -and $s.BackendState -eq 'Running')
            }
            if (-not $logged) {
                Show-Msg 'No se completo el inicio de sesion. Vuelve a intentarlo cuando termines en el navegador.' 'Warning'
                return
            }
            Write-Log 'Sesion iniciada correctamente.'
            Update-Ui
        }

        # Paso 3: Activar Tailscale Serve (HTTPS privado, SIN Funnel)
        Write-Log 'Activando acceso privado HTTPS (Tailscale Serve)...'
        $serveMsg = "Tailscale pide habilitar Serve/HTTPS una sola vez en tu cuenta.`n`n" +
                    "1. En la pagina que se ha abierto, pulsa 'Enable' para activar HTTPS privado.`n" +
                    "2. NO hace falta activar Funnel (eso daria acceso publico).`n`n" +
                    "Pulsa Aceptar y esta ventana terminara automaticamente."
        $served = Run-TsAndCaptureUrl $ts @('serve', '--bg', "http://127.0.0.1:$Port") $serveMsg {
            $cur = Get-MobileState
            return $cur.ServeActive
        }

        if (-not $served) {
            Show-Msg ("No se pudo activar el acceso HTTPS privado todavia.`n`n" +
                      "Si acabas de activar Serve en la web de Tailscale, espera 5 segundos y vuelve a pulsar 'Activar acceso desde el movil'.") 'Warning'
            return
        }

        # Registrar tambien la ruta /movil y arrancar servidor ligero de la interfaz movil
        Ensure-MobileServeRoute $ts
        Start-MobileServer | Out-Null

        # Verificar que Funnel no este activo
        $finalSt = Get-MobileState
        if ($finalSt.FunnelActive) {
            & $ts funnel --https=443 off 2>$null | Out-Null
            $finalSt = Get-MobileState
        }

        # Paso 4: Arrancar Suwayomi si estaba apagado
        if (-not $finalSt.SuwayomiUp -and $finalSt.SuwayomiInst) {
            Write-Log 'Encendiendo Suwayomi para que puedas probarlo...'
            if (Start-SuwayomiServer) {
                for ($i = 0; $i -lt 25; $i++) {
                    Wait-Ui 1000
                    if (Test-LocalPort $Port) { break }
                }
            }
            $finalSt = Get-MobileState
        }

        if ($finalSt.Url) {
            try { Set-Clipboard -Value $finalSt.Url } catch { }
            Write-Log "Listo. Acceso privado activo: $($finalSt.Url)"
            Show-Msg ("Acceso privado activado correctamente.`n`n" +
                      "Tu enlace (ya copiado al portapapeles):`n$($finalSt.Url)`n`n" +
                      "En tu movil:`n" +
                      "1. Instala Tailscale y entra con la misma cuenta.`n" +
                      "2. Activa la conexion VPN en Tailscale.`n" +
                      "3. Escanea el codigo QR de esta ventana.") 'Information'
        }
    } finally {
        Set-Busy $false
        Update-Ui
    }
})

$btnDisable.Add_Click({
    if ($script:Busy) { return }
    $ts = Find-Tailscale
    if (-not $ts) { return }
    if (-not (Ask-YesNo "Se desactivara el acceso a Suwayomi desde el movil.`n`nPodras volver a activarlo cuando quieras con un clic. Continuar?")) {
        return
    }
    Set-Busy $true
    Write-Log 'Desactivando acceso movil...'
    try {
        & $ts funnel --https=443 off 2>$null | Out-Null
        & $ts serve --https=443 --set-path /movil off 2>$null | Out-Null
        & $ts serve --https=443 off 2>$null | Out-Null
        Write-Log 'Acceso movil desactivado.'
    } catch {
        Write-Log "Error al desactivar: $($_.Exception.Message)"
    }
    Set-Busy $false
    Update-Ui
})

$btnCopy.Add_Click({
    if ($script:CurrentUrl) {
        try {
            Set-Clipboard -Value $script:CurrentUrl
            Write-Log 'Enlace copiado al portapapeles.'
            $btnCopy.Text = 'Copiado!'
            Wait-Ui 1200
            $btnCopy.Text = 'Copiar enlace'
        } catch {
            Show-Msg 'No se pudo copiar al portapapeles. Selecciona el texto y pulsa Ctrl+C.' 'Warning'
        }
    }
})

$btnTest.Add_Click({
    if ($script:CurrentUrl) {
        Start-Process $script:CurrentUrl
    }
})

$btnSleep.Add_Click({
    if ($script:Busy) { return }
    $cur = Get-AcSleepMinutes
    if ($cur -eq 0) {
        $prev = Get-SavedSleepMinutes
        if (Ask-YesNo "Restaurar la suspension automatica enchufado a $prev minutos?") {
            & powercfg /change standby-timeout-ac $prev
            Write-Log "Suspension enchufado restaurada a $prev minutos."
            Update-Ui
        }
    } else {
        $msg = "Mientras el PC este enchufado a la corriente, Windows dejara de suspenderse solo.`n" +
               "La pantalla podra seguir apagandose normalmente.`n" +
               "Podras restaurar tu ajuste anterior ($cur min) con este mismo boton.`n`n" +
               "Aplicar este cambio?"
        if (Ask-YesNo $msg) {
            if ($cur -gt 0) {
                New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
                Set-Content -Path $SleepBackup -Value "$cur" -Encoding ASCII
            }
            & powercfg /change standby-timeout-ac 0
            Write-Log 'Suspension automatica enchufado desactivada (la pantalla si se apagara).'
            Update-Ui
        }
    }
})

# ---------------- Arranque ----------------
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.Add_Tick({
    if (-not $script:Busy) { Update-Ui }
})

$form.Add_Shown({
    $st = Get-MobileState
    if ($st.ServeActive) {
        Start-MobileServer | Out-Null
        if (-not $st.MobileRouteActive -and $st.TailscaleExe) { Ensure-MobileServeRoute $st.TailscaleExe }
    }
    Update-Ui
    if ($st.ServeActive) {
        Write-Log 'Acceso privado activo. Escanea el QR para abrir el lector movil (estilo app).'
    } else {
        Write-Log 'Pulsa "Activar acceso desde el movil" para configurarlo paso a paso.'
    }
    $timer.Start()
})

$form.Add_FormClosing({
    $script:CancelFlow = $true
    $timer.Stop()
    if ($picQr.Image) { $picQr.Image.Dispose() }
})

[void]$form.ShowDialog()
