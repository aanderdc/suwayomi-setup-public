param(
    [string]$Server = "http://localhost:4567"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

$storeUrl = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"

function Wait-Server {
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "$Server/" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "El servidor no responde en $Server. Arranca el lanzador y pulsa Launch primero."
}

function Invoke-GraphQL([string]$query) {
    $client = New-Object System.Net.Http.HttpClient
    $body = @{ query = $query } | ConvertTo-Json -Compress
    $content = New-Object System.Net.Http.StringContent($body, [System.Text.Encoding]::UTF8, "application/json")
    $resp = $client.PostAsync("$Server/api/graphql", $content).Result
    $text = $resp.Content.ReadAsStringAsync().Result
    $client.Dispose()
    if (-not $resp.IsSuccessStatusCode) { throw "GraphQL HTTP $([int]$resp.StatusCode): $text" }
    return $text
}

Write-Host "Esperando al servidor en $Server ..."
Wait-Server

Write-Host "Anadiendo repositorio de extensiones Keiyoushi ..."
Invoke-GraphQL ("mutation { addExtensionStore(input:{indexUrl:`"" + $storeUrl + "`"}) { clientMutationId } }") | Out-Null

Write-Host ""
Write-Host "Listo. Repositorio de extensiones anadido. Abre $Server, ve a Browse/Explorar > Extensions e instala las fuentes que quieras."