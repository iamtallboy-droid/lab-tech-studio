# Lab Tech Show Studio - Native PowerShell Web Server
# Allows running the stream overlays and controller dashboard on localhost to satisfy browser same-origin policies.
# No Node.js required! Run by launching START_SERVER.bat.

$port = 7335
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Cyan
Write-Host "   Labtechshow Studio - Live Overlay Web Server " -ForegroundColor Cyan
Write-Host "  ==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Listening on  http://localhost:$port" -ForegroundColor Green
Write-Host ""
Write-Host "  To open the Control Dashboard in Edge/Chrome:" -ForegroundColor Yellow
Write-Host "    http://localhost:$port/"
Write-Host "      -- or --"
Write-Host "    http://localhost:$port/dashboard.html"
Write-Host ""
Write-Host "  To add to vMix as Web Browser Input:" -ForegroundColor Yellow
Write-Host "    http://localhost:$port/overlay.html"
Write-Host ""
Write-Host "  Close this console window to stop the server." -ForegroundColor DarkGray
Write-Host ""

function Send-FileResponse {
    param($context, [string]$filePath)
    $response = $context.Response
    
    if (-not (Test-Path $filePath)) {
        $response.StatusCode = 404
        $response.ContentType = "text/plain"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("File Not Found: $(Split-Path -Leaf $filePath)")
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.OutputStream.Close()
        return
    }

    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
    $mimeType = switch ($ext) {
        ".html" { "text/html; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".js"   { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".png"  { "image/png" }
        ".jpg"  { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".gif"  { "image/gif" }
        ".svg"  { "image/svg+xml" }
        ".ico"  { "image/x-icon" }
        default { "application/octet-stream" }
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.StatusCode = 200
        $response.ContentType = $mimeType
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.OutputStream.Close()
    } catch {
        $response.StatusCode = 500
        $response.ContentType = "text/plain"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("Error reading file: $($_.Exception.Message)")
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
        $response.OutputStream.Close()
    }
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $reqPath = $ctx.Request.Url.AbsolutePath
        
        # Route empty path to dashboard.html
        if ($reqPath -eq "/" -or $reqPath -eq "/dashboard") {
            $targetFile = Join-Path $scriptDir "dashboard.html"
        } else {
            # Strip leading slash and map to local file
            $relPath = $reqPath.TrimStart('/')
            $targetFile = Join-Path $scriptDir $relPath
        }

        # Resolve paths securely within target folder
        $resolvedPath = [System.IO.Path]::GetFullPath($targetFile)
        if ($resolvedPath.StartsWith($scriptDir)) {
            Send-FileResponse $ctx $resolvedPath
        } else {
            # Directory traversal attempt
            $ctx.Response.StatusCode = 403
            $ctx.Response.Close()
        }
    } catch [System.Net.HttpListenerException] {
        break
    } catch {
        # Silent fail or log
        Write-Host "  Error processing request: $($_.Exception.Message)" -ForegroundColor Red
    }
}

$listener.Stop()
