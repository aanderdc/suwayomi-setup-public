<#
.SYNOPSIS
    Servidor HTTP local ligero (solo 127.0.0.1:4568) para la interfaz movil (mobile/).
    No requiere permisos de administrador ni modifica archivos internos de Suwayomi.
#>
param(
    [int]$Port = 4568,
    [string]$WebRoot = (Join-Path $PSScriptRoot 'mobile')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $WebRoot)) { exit 1 }
$WebRoot = (Resolve-Path $WebRoot).Path

$cs = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public static class MobileStaticServer {
    private static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" },
        { ".css",  "text/css; charset=utf-8" },
        { ".js",   "application/javascript; charset=utf-8" },
        { ".json", "application/manifest+json; charset=utf-8" },
        { ".svg",  "image/svg+xml" },
        { ".png",  "image/png" },
        { ".ico",  "image/x-icon" }
    };

    public static void Run(string rootDir, int port) {
        string fullRoot = Path.GetFullPath(rootDir);
        if (!fullRoot.EndsWith(Path.DirectorySeparatorChar.ToString())) fullRoot += Path.DirectorySeparatorChar;

        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        while (true) {
            TcpClient client = listener.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(_ => Handle(client, fullRoot));
        }
    }

    private static void Handle(TcpClient client, string fullRoot) {
        using (client) {
            try {
                client.ReceiveTimeout = 5000;
                client.SendTimeout = 10000;
                using (NetworkStream ns = client.GetStream())
                using (StreamReader sr = new StreamReader(ns, Encoding.ASCII, false, 1024, true)) {
                    string reqLine = sr.ReadLine();
                    if (string.IsNullOrEmpty(reqLine)) return;
                    // Consumir cabeceras HTTP
                    string line;
                    while (!string.IsNullOrEmpty(line = sr.ReadLine())) { }

                    string[] parts = reqLine.Split(' ');
                    if (parts.Length < 2) return;
                    string method = parts[0];
                    string rawPath = parts[1];
                    int qIdx = rawPath.IndexOf('?');
                    if (qIdx >= 0) rawPath = rawPath.Substring(0, qIdx);
                    rawPath = Uri.UnescapeDataString(rawPath);

                    if (rawPath.StartsWith("/movil/", StringComparison.OrdinalIgnoreCase)) {
                        rawPath = rawPath.Substring(6);
                    } else if (string.Equals(rawPath, "/movil", StringComparison.OrdinalIgnoreCase)) {
                        rawPath = "/";
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
        string reason = status == 200 ? "OK" : "Not Found";
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
    [MobileStaticServer]::Run($WebRoot, $Port)
} catch [System.Net.Sockets.SocketException] {
    # Ya hay otra instancia escuchando en este puerto
    exit 0
}
