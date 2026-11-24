<#
.SYNOPSIS
    Servidor HTTP local ligero (solo 127.0.0.1:4568) para la interfaz movil (mobile/).
    No requiere permisos de administrador ni modifica archivos internos de Suwayomi.
    Incluye accion privada POST /movil/__action__/clear-history para borrar historial desde el movil.
#>
param(
    [int]$Port = 4568,
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
    private static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" },
        { ".css",  "text/css; charset=utf-8" },
        { ".js",   "application/javascript; charset=utf-8" },
        { ".json", "application/manifest+json; charset=utf-8" },
        { ".svg",  "image/svg+xml" },
        { ".png",  "image/png" },
        { ".ico",  "image/x-icon" }
    };

    public static void Run(string rootDir, string repoDir, int port) {
        string fullRoot = Path.GetFullPath(rootDir);
        if (!fullRoot.EndsWith(Path.DirectorySeparatorChar.ToString())) fullRoot += Path.DirectorySeparatorChar;
        string fullRepo = Path.GetFullPath(repoDir);

        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        while (true) {
            TcpClient client = listener.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(_ => Handle(client, fullRoot, fullRepo));
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

                    // Reiniciar Suwayomi siempre para dejar el servidor disponible
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

    private static void Handle(TcpClient client, string fullRoot, string fullRepo) {
        using (client) {
            try {
                client.ReceiveTimeout = 10000;
                client.SendTimeout = 45000;
                using (NetworkStream ns = client.GetStream())
                using (StreamReader sr = new StreamReader(ns, Encoding.ASCII, false, 1024, true)) {
                    string reqLine = sr.ReadLine();
                    if (string.IsNullOrEmpty(reqLine)) return;

                    string actionHeader = "";
                    string line;
                    while (!string.IsNullOrEmpty(line = sr.ReadLine())) {
                        int colon = line.IndexOf(':');
                        if (colon > 0) {
                            string k = line.Substring(0, colon).Trim();
                            if (string.Equals(k, "X-Suwayomi-Action", StringComparison.OrdinalIgnoreCase)) {
                                actionHeader = line.Substring(colon + 1).Trim();
                            }
                        }
                    }

                    string[] parts = reqLine.Split(' ');
                    if (parts.Length < 2) return;
                    string method = parts[0];
                    string rawPath = parts[1];
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

                    // Accion privada: borrar historial de lectura (completo o de un manga)
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

                    if (string.IsNullOrEmpty(rawPath) || rawPath == "/") rawPath = "/index.html";

                    string rel = rawPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string candidate = Path.GetFullPath(Path.Combine(fullRoot, rel));
                    if (!candidate.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate)) {
                        SendResponse(ns, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), method == "HEAD");
                        return;
                    }

                    string ext = Path.GetExtension(candidate);
                    string contentType;
                    if (!Mime.TryGetValue(ext, out contentType)) contentType = "application/octet-stream";
                    byte[] body = File.ReadAllBytes(candidate);
                    SendResponse(ns, 200, contentType, body, method == "HEAD");
                }
            } catch { }
        }
    }

    private static void SendResponse(NetworkStream ns, int status, string contentType, byte[] body, bool headOnly) {
        string reason = status == 200 ? "OK" : (status == 400 ? "Bad Request" : (status == 403 ? "Forbidden" : (status == 404 ? "Not Found" : "Internal Server Error")));
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
    [MobileStaticServer]::Run($WebRoot, $RepoRoot, $Port)
} catch [System.Net.Sockets.SocketException] {
    # Ya hay otra instancia escuchando en este puerto
    exit 0
}
