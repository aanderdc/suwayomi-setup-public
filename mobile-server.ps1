<#
.SYNOPSIS
    Servidor HTTP local ligero (solo 127.0.0.1:4568) para la interfaz movil (mobile/).
    No requiere permisos de administrador ni modifica archivos internos de Suwayomi.
    Incluye:
      - Accion privada POST /movil/__action__/clear-history
      - Instancia aislada bajo demanda para la boveda secreta (/movil/__vault__/* -> 127.0.0.1:4569, datos en %LOCALAPPDATA%\Tachidesk-Vault)
#>
param(
    [int]$Port = 4568,
    [int]$VaultPort = 4569,
    [string]$WebRoot = (Join-Path $PSScriptRoot 'mobile')
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
if (-not (Test-Path $WebRoot)) { exit 1 }
$WebRoot = (Resolve-Path $WebRoot).Path

$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public static class MobileStaticServer {
    private static readonly object ActionLock = new object();
    private static readonly object VaultLock = new object();
    private static int VaultPid = 0;

    private static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" },
        { ".css",  "text/css; charset=utf-8" },
        { ".js",   "application/javascript; charset=utf-8" },
        { ".json", "application/manifest+json; charset=utf-8" },
        { ".svg",  "image/svg+xml" },
        { ".png",  "image/png" },
        { ".ico",  "image/x-icon" }
    };

    public static void Run(string rootDir, string repoDir, int port, int vaultPort) {
        string fullRoot = Path.GetFullPath(rootDir);
        if (!fullRoot.EndsWith(Path.DirectorySeparatorChar.ToString())) fullRoot += Path.DirectorySeparatorChar;
        string fullRepo = Path.GetFullPath(repoDir);

        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        while (true) {
            TcpClient client = listener.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(_ => Handle(client, fullRoot, fullRepo, vaultPort));
        }
    }

    private static string JsonEscape(string s) {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
    }

    private static bool TestPort(int port) {
        try {
            using (TcpClient c = new TcpClient()) {
                IAsyncResult iar = c.BeginConnect("127.0.0.1", port, null, null);
                bool ok = iar.AsyncWaitHandle.WaitOne(350) && c.Connected;
                if (ok) c.EndConnect(iar);
                return ok;
            }
        } catch { return false; }
    }

    private static string FindSuwayomiDir() {
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string[] parents = new string[] { Path.Combine(home, "Suwayomi"), Path.Combine(home, "Downloads") };
        foreach (string parent in parents) {
            if (!Directory.Exists(parent)) continue;
            string[] dirs = Directory.GetDirectories(parent, "Suwayomi-Server-*-windows-x64");
            Array.Sort(dirs, StringComparer.OrdinalIgnoreCase);
            Array.Reverse(dirs);
            foreach (string d in dirs) {
                if (File.Exists(Path.Combine(d, "bin", "Suwayomi-Server.jar"))) return d;
            }
        }
        return null;
    }

    private static string GetVaultDataDir() {
        string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localApp, "Tachidesk-Vault");
    }

    private static void RestartSuwayomi() {
        string dir = FindSuwayomiDir();
        if (string.IsNullOrEmpty(dir)) return;
        string javaw = Path.Combine(dir, "jre", "bin", "javaw.exe");
        if (!File.Exists(javaw)) javaw = "javaw.exe";
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = javaw;
        psi.WorkingDirectory = dir;
        psi.Arguments = "-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false " +
                        "-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false " +
                        "-jar bin\\Suwayomi-Server.jar";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi);

        for (int i = 0; i < 30; i++) {
            if (TestPort(4567)) break;
            Thread.Sleep(1000);
        }
    }

    private static void EnsureVaultDefaultRepo(int vaultPort) {
        try {
            string marker = Path.Combine(GetVaultDataDir(), ".repo-init");
            if (File.Exists(marker)) return;
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + vaultPort + "/api/graphql");
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Timeout = 8000;
            byte[] payload = Encoding.UTF8.GetBytes("{\"query\":\"mutation { addExtensionStore(input:{indexUrl:\\\"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json\\\"}) { clientMutationId } }\"}");
            using (Stream st = req.GetRequestStream()) st.Write(payload, 0, payload.Length);
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {
                if ((int)resp.StatusCode == 200) File.WriteAllText(marker, "ok");
            }
        } catch { }
    }

    private static bool StartVaultServer(int vaultPort, out string error) {
        error = null;
        lock (VaultLock) {
            if (TestPort(vaultPort)) {
                EnsureVaultDefaultRepo(vaultPort);
                return true;
            }
            string dir = FindSuwayomiDir();
            if (string.IsNullOrEmpty(dir)) {
                error = "No se encuentra la instalacion de Suwayomi.";
                return false;
            }
            string vaultDir = GetVaultDataDir();
            Directory.CreateDirectory(vaultDir);

            string javaw = Path.Combine(dir, "jre", "bin", "javaw.exe");
            if (!File.Exists(javaw)) javaw = "javaw.exe";

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = javaw;
            psi.WorkingDirectory = dir;
            psi.Arguments = "\"-Dsuwayomi.tachidesk.config.server.rootDir=" + vaultDir + "\" " +
                            "-Dsuwayomi.tachidesk.config.server.ip=127.0.0.1 " +
                            "-Dsuwayomi.tachidesk.config.server.port=" + vaultPort + " " +
                            "-Dsuwayomi.tachidesk.config.server.webUIEnabled=false " +
                            "-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false " +
                            "-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false " +
                            "-jar bin\\Suwayomi-Server.jar";
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process proc = Process.Start(psi);
            if (proc != null) VaultPid = proc.Id;

            for (int i = 0; i < 40; i++) {
                if (TestPort(vaultPort)) {
                    EnsureVaultDefaultRepo(vaultPort);
                    return true;
                }
                Thread.Sleep(500);
            }
            error = "La boveda tardo demasiado en iniciar.";
            return false;
        }
    }

    private static void StopVaultServer() {
        lock (VaultLock) {
            if (VaultPid > 0) {
                try {
                    Process p = Process.GetProcessById(VaultPid);
                    if (!p.HasExited) p.Kill();
                } catch { }
                VaultPid = 0;
            }
            // Limpieza extra solo del proceso Java que use Tachidesk-Vault (nunca toca el Suwayomi normal)
            try {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = "-NoProfile -Command \"Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'java' -and $_.CommandLine -match 'Tachidesk-Vault' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\"";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                using (Process k = Process.Start(psi)) { k.WaitForExit(5000); }
            } catch { }
        }
    }

    private static void ProxyToVault(NetworkStream ns, string method, string targetPathAndQuery, string contentType, byte[] reqBody, int vaultPort) {
        if (!TestPort(vaultPort)) {
            SendResponse(ns, 503, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes("{\"errors\":[{\"message\":\"Boveda cerrada\"}]}"), false);
            return;
        }
        try {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + vaultPort + targetPathAndQuery);
            req.Method = method;
            req.Timeout = 30000;
            req.ReadWriteTimeout = 30000;
            if (!string.IsNullOrEmpty(contentType)) req.ContentType = contentType;
            if (reqBody != null && reqBody.Length > 0 && (method == "POST" || method == "PUT" || method == "PATCH")) {
                req.ContentLength = reqBody.Length;
                using (Stream st = req.GetRequestStream()) st.Write(reqBody, 0, reqBody.Length);
            }

            HttpWebResponse resp = null;
            try {
                resp = (HttpWebResponse)req.GetResponse();
            } catch (WebException wex) {
                resp = wex.Response as HttpWebResponse;
                if (resp == null) throw;
            }

            using (resp) {
                int status = (int)resp.StatusCode;
                string respType = string.IsNullOrEmpty(resp.ContentType) ? "application/octet-stream" : resp.ContentType;
                byte[] respBytes;
                using (MemoryStream ms = new MemoryStream()) {
                    Stream rs = resp.GetResponseStream();
                    if (rs != null) rs.CopyTo(ms);
                    respBytes = ms.ToArray();
                }
                SendResponse(ns, status, respType, respBytes, method == "HEAD");
            }
        } catch (Exception ex) {
            SendResponse(ns, 502, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes("{\"errors\":[{\"message\":\"" + JsonEscape(ex.Message) + "\"}]}"), false);
        }
    }

    private static int ParseQueryMangaId(string query) {
        if (string.IsNullOrEmpty(query)) return 0;
        foreach (string pair in query.Split('&')) {
            int eq = pair.IndexOf('=');
            if (eq <= 0) continue;
            string k = pair.Substring(0, eq);
            string v = pair.Substring(eq + 1);
            if (string.Equals(k, "mangaId", StringComparison.OrdinalIgnoreCase)) {
                int id;
                if (int.TryParse(v, out id) && id > 0) return id;
                return -1;
            }
        }
        return 0;
    }

    private static void HandleClearHistory(NetworkStream ns, string fullRepo, int mangaId) {
        string script = Path.Combine(fullRepo, "clear-history.ps1");
        if (!File.Exists(script)) {
            SendResponse(ns, 500, "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"No se encuentra clear-history.ps1\"}"), false);
            return;
        }

        lock (ActionLock) {
            try {
                string extra = mangaId > 0 ? (" -MangaId " + mangaId) : "";
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Force" + extra;
                psi.WorkingDirectory = fullRepo;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                using (Process p = Process.Start(psi)) {
                    string stdout = p.StandardOutput.ReadToEnd();
                    string stderr = p.StandardError.ReadToEnd();
                    p.WaitForExit(30000);
                    int code = p.HasExited ? p.ExitCode : -1;
                    if (!p.HasExited) { try { p.Kill(); } catch { } }

                    RestartSuwayomi();

                    if (code != 0) {
                        string err = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                        SendResponse(ns, 500, "application/json; charset=utf-8",
                            Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"" + JsonEscape(err.Trim()) + "\"}"), false);
                        return;
                    }
                }
                SendResponse(ns, 200, "application/json; charset=utf-8",
                    Encoding.UTF8.GetBytes("{\"ok\":true}"), false);
            } catch (Exception ex) {
                try { RestartSuwayomi(); } catch { }
                SendResponse(ns, 500, "application/json; charset=utf-8",
                    Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\"}"), false);
            }
        }
    }

    private static byte[] ReadHeaderBlock(NetworkStream ns, out byte[] leftover) {
        leftover = new byte[0];
        using (MemoryStream ms = new MemoryStream()) {
            byte[] buf = new byte[4096];
            while (ms.Length < 65536) {
                int n = ns.Read(buf, 0, buf.Length);
                if (n <= 0) break;
                ms.Write(buf, 0, n);
                byte[] arr = ms.ToArray();
                for (int i = 0; i <= arr.Length - 4; i++) {
                    if (arr[i] == 13 && arr[i + 1] == 10 && arr[i + 2] == 13 && arr[i + 3] == 10) {
                        int bodyStart = i + 4;
                        int extraLen = arr.Length - bodyStart;
                        if (extraLen > 0) {
                            leftover = new byte[extraLen];
                            Array.Copy(arr, bodyStart, leftover, 0, extraLen);
                        }
                        byte[] hdr = new byte[i];
                        Array.Copy(arr, 0, hdr, 0, i);
                        return hdr;
                    }
                }
            }
            return ms.ToArray();
        }
    }

    private static byte[] ReadExactBody(NetworkStream ns, byte[] leftover, int contentLength) {
        if (contentLength <= 0 || contentLength > 20 * 1024 * 1024) return new byte[0];
        byte[] body = new byte[contentLength];
        int copied = Math.Min(leftover.Length, contentLength);
        if (copied > 0) Array.Copy(leftover, 0, body, 0, copied);
        while (copied < contentLength) {
            int n = ns.Read(body, copied, contentLength - copied);
            if (n <= 0) break;
            copied += n;
        }
        return body;
    }

    private static void Handle(TcpClient client, string fullRoot, string fullRepo, int vaultPort) {
        using (client) {
            try {
                client.ReceiveTimeout = 15000;
                client.SendTimeout = 45000;
                using (NetworkStream ns = client.GetStream()) {
                    byte[] leftover;
                    byte[] hdrBytes = ReadHeaderBlock(ns, out leftover);
                    if (hdrBytes.Length == 0) return;

                    string hdrText = Encoding.ASCII.GetString(hdrBytes);
                    string[] lines = hdrText.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                    if (lines.Length == 0) return;

                    string actionHeader = "";
                    string contentType = "";
                    int contentLength = 0;
                    for (int i = 1; i < lines.Length; i++) {
                        int colon = lines[i].IndexOf(':');
                        if (colon <= 0) continue;
                        string k = lines[i].Substring(0, colon).Trim();
                        string v = lines[i].Substring(colon + 1).Trim();
                        if (string.Equals(k, "X-Suwayomi-Action", StringComparison.OrdinalIgnoreCase)) actionHeader = v;
                        else if (string.Equals(k, "Content-Type", StringComparison.OrdinalIgnoreCase)) contentType = v;
                        else if (string.Equals(k, "Content-Length", StringComparison.OrdinalIgnoreCase)) int.TryParse(v, out contentLength);
                    }

                    string[] parts = lines[0].Split(' ');
                    if (parts.Length < 2) return;
                    string method = parts[0];
                    string fullTarget = parts[1];
                    string rawPath = fullTarget;
                    string queryStr = "";
                    int qIdx = rawPath.IndexOf('?');
                    if (qIdx >= 0) {
                        queryStr = rawPath.Substring(qIdx + 1);
                        rawPath = rawPath.Substring(0, qIdx);
                    }
                    rawPath = Uri.UnescapeDataString(rawPath);

                    if (rawPath.StartsWith("/movil/", StringComparison.OrdinalIgnoreCase)) {
                        rawPath = rawPath.Substring(6);
                    } else if (string.Equals(rawPath, "/movil", StringComparison.OrdinalIgnoreCase)) {
                        rawPath = "/";
                    }

                    // --- Boveda aislada: start / stop / proxy API ---
                    if (string.Equals(rawPath, "/__vault__/start", StringComparison.OrdinalIgnoreCase)) {
                        if (!string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase) ||
                            !string.Equals(actionHeader, "vault", StringComparison.OrdinalIgnoreCase)) {
                            SendResponse(ns, 403, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":false}"), false);
                            return;
                        }
                        string err;
                        if (StartVaultServer(vaultPort, out err)) {
                            SendResponse(ns, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false);
                        } else {
                            SendResponse(ns, 500, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"" + JsonEscape(err) + "\"}"), false);
                        }
                        return;
                    }

                    if (string.Equals(rawPath, "/__vault__/stop", StringComparison.OrdinalIgnoreCase)) {
                        if (!string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase) ||
                            !string.Equals(actionHeader, "vault", StringComparison.OrdinalIgnoreCase)) {
                            SendResponse(ns, 403, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":false}"), false);
                            return;
                        }
                        StopVaultServer();
                        SendResponse(ns, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes("{\"ok\":true}"), false);
                        return;
                    }

                    if (rawPath.StartsWith("/__vault__/api/", StringComparison.OrdinalIgnoreCase)) {
                        string subPath = rawPath.Substring(10); // empieza en /api/...
                        if (!string.IsNullOrEmpty(queryStr)) subPath += "?" + queryStr;
                        byte[] body = contentLength > 0 ? ReadExactBody(ns, leftover, contentLength) : new byte[0];
                        ProxyToVault(ns, method, subPath, contentType, body, vaultPort);
                        return;
                    }

                    // --- Accion privada: borrar historial de lectura ---
                    if (string.Equals(rawPath, "/__action__/clear-history", StringComparison.OrdinalIgnoreCase)) {
                        if (!string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase) ||
                            !string.Equals(actionHeader, "clear-history", StringComparison.OrdinalIgnoreCase)) {
                            SendResponse(ns, 403, "application/json; charset=utf-8",
                                Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"Forbidden\"}"), false);
                            return;
                        }
                        int mangaId = ParseQueryMangaId(queryStr);
                        if (mangaId < 0) {
                            SendResponse(ns, 400, "application/json; charset=utf-8",
                                Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"Invalid mangaId\"}"), false);
                            return;
                        }
                        HandleClearHistory(ns, fullRepo, mangaId);
                        return;
                    }

                    // --- Archivos estaticos de mobile/ ---
                    if (string.IsNullOrEmpty(rawPath) || rawPath == "/") rawPath = "/index.html";
                    string rel = rawPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string candidate = Path.GetFullPath(Path.Combine(fullRoot, rel));
                    if (!candidate.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate)) {
                        SendResponse(ns, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), method == "HEAD");
                        return;
                    }

                    string ext = Path.GetExtension(candidate);
                    string mimeType;
                    if (!Mime.TryGetValue(ext, out mimeType)) mimeType = "application/octet-stream";
                    byte[] fileBody = File.ReadAllBytes(candidate);
                    SendResponse(ns, 200, mimeType, fileBody, method == "HEAD");
                }
            } catch { }
        }
    }

    private static void SendResponse(NetworkStream ns, int status, string contentType, byte[] body, bool headOnly) {
        string reason = status == 200 ? "OK"
            : (status == 400 ? "Bad Request"
            : (status == 403 ? "Forbidden"
            : (status == 404 ? "Not Found"
            : (status == 502 ? "Bad Gateway"
            : (status == 503 ? "Service Unavailable" : "Internal Server Error")))));
        string header = "HTTP/1.1 " + status + " " + reason + "\r\n" +
                        "Content-Type: " + contentType + "\r\n" +
                        "Content-Length: " + body.Length + "\r\n" +
                        "Cache-Control: no-cache\r\n" +
                        "Connection: close\r\n\r\n";
        byte[] hBytes = Encoding.ASCII.GetBytes(header);
        ns.Write(hBytes, 0, hBytes.Length);
        if (!headOnly && body.Length > 0) ns.Write(body, 0, body.Length);
        ns.Flush();
    }
}
'@

if (-not ('MobileStaticServer' -as [type])) {
    Add-Type -TypeDefinition $cs
}

try {
    [MobileStaticServer]::Run($WebRoot, $RepoRoot, $Port, $VaultPort)
} catch [System.Net.Sockets.SocketException] {
    exit 0
}
