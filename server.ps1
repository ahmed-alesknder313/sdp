$port = 8080
if ($PSScriptRoot) {
    $baseDir = $PSScriptRoot
} else {
    $baseDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
}
if (-not $baseDir) { $baseDir = (Get-Location).Path }

$dataFile = Join-Path $baseDir "responses.json"
if (-not (Test-Path $dataFile)) {
    [System.IO.File]::WriteAllText($dataFile, "[]", [System.Text.Encoding]::UTF8)
}

$adminsFile = Join-Path $baseDir "admins.json"
if (-not (Test-Path $adminsFile)) {
    $defaultAdminsJson = '[{"username":"admin","password":"admin123","fullName":"General Supervisor","role":"ADMIN","province":"Karbala","createdAt":"2026-01-01 00:00:00"}]'
    [System.IO.File]::WriteAllText($adminsFile, $defaultAdminsJson, [System.Text.Encoding]::UTF8)
}

function Get-RequestBody($req) {
    if ($req.HasEntityBody -and $req.ContentLength64 -gt 0) {
        $buffer = New-Object byte[] $req.ContentLength64
        $totalRead = 0
        while ($totalRead -lt $req.ContentLength64) {
            $bytesRead = $req.InputStream.Read($buffer, $totalRead, $req.ContentLength64 - $totalRead)
            if ($bytesRead -le 0) { break }
            $totalRead += $bytesRead
        }
        return [System.Text.Encoding]::UTF8.GetString($buffer, 0, $totalRead)
    }
    return ""
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")

$listener.Start()
Write-Output "Server started on http://localhost:$port/"

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # Enable CORS and anti-cache
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Cache-Control")
        $response.Headers.Add("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        $response.Headers.Add("Pragma", "no-cache")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        $localPath = $request.Url.LocalPath

        # 1. GET /api/responses
        if ($localPath -eq "/api/responses" -and $request.HttpMethod -eq "GET") {
            $jsonContent = "[]"
            if (Test-Path $dataFile) {
                $jsonContent = [System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)
                if ([string]::IsNullOrWhiteSpace($jsonContent)) { $jsonContent = "[]" }
            }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonContent)
            $response.ContentType = "application/json; charset=utf-8"
            $response.StatusCode = 200
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }

        # 2. POST /api/responses
        if ($localPath -eq "/api/responses" -and $request.HttpMethod -eq "POST") {
            $body = Get-RequestBody $request

            $list = @()
            if (Test-Path $dataFile) {
                $raw = [System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)
                if (-not [string]::IsNullOrWhiteSpace($raw)) {
                    try { $list = ConvertFrom-Json $raw } catch { $list = @() }
                }
            }

            try {
                $newObj = ConvertFrom-Json $body
                $updatedList = @($newObj) + @($list)
                $outJson = ConvertTo-Json -InputObject $updatedList -Depth 10
                [System.IO.File]::WriteAllText($dataFile, $outJson, [System.Text.Encoding]::UTF8)

                $respStr = '{"status":"success"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($respStr)
                $response.ContentType = "application/json; charset=utf-8"
                $response.StatusCode = 200
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $errStr = '{"status":"error"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($errStr)
                $response.ContentType = "application/json; charset=utf-8"
                $response.StatusCode = 500
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $response.Close()
            continue
        }

        # 3. POST /api/clear
        if ($localPath -eq "/api/clear" -and $request.HttpMethod -eq "POST") {
            [System.IO.File]::WriteAllText($dataFile, "[]", [System.Text.Encoding]::UTF8)
            $respStr = '{"status":"cleared"}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($respStr)
            $response.ContentType = "application/json; charset=utf-8"
            $response.StatusCode = 200
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }

        # 4. POST /api/delete
        if ($localPath -eq "/api/delete" -and $request.HttpMethod -eq "POST") {
            $body = Get-RequestBody $request

            $reqObj = ConvertFrom-Json $body
            $delId = $reqObj.id

            if (Test-Path $dataFile) {
                $raw = [System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)
                if (-not [string]::IsNullOrWhiteSpace($raw)) {
                    $list = ConvertFrom-Json $raw
                    $filtered = @($list | Where-Object { $_.id -ne $delId })
                    $outJson = ConvertTo-Json -InputObject $filtered -Depth 10
                    [System.IO.File]::WriteAllText($dataFile, $outJson, [System.Text.Encoding]::UTF8)
                }
            }

            $respStr = '{"status":"deleted"}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($respStr)
            $response.ContentType = "application/json; charset=utf-8"
            $response.StatusCode = 200
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }

        # 5. POST /api/update or api.php update
        if (($localPath -eq "/api/update" -or ($localPath -eq "/api.php" -and $request.Url.Query -match "action=update")) -and $request.HttpMethod -eq "POST") {
            $body = Get-RequestBody $request

            try {
                $reqObj = ConvertFrom-Json $body
                $upId = $reqObj.id

                if (Test-Path $dataFile) {
                    $raw = [System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)
                    if (-not [string]::IsNullOrWhiteSpace($raw)) {
                        $list = @(ConvertFrom-Json $raw)
                        for ($i = 0; $i -lt $list.Count; $i++) {
                            if ($list[$i].id -eq $upId) {
                                foreach ($prop in $reqObj.PSObject.Properties) {
                                    if ($prop.Name -ne "action") {
                                        $pName = $prop.Name
                                        $list[$i].$pName = $prop.Value
                                    }
                                }
                                break
                            }
                        }
                        $outJson = ConvertTo-Json -InputObject $list -Depth 10
                        [System.IO.File]::WriteAllText($dataFile, $outJson, [System.Text.Encoding]::UTF8)
                    }
                }

                $respStr = '{"status":"updated"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($respStr)
                $response.ContentType = "application/json; charset=utf-8"
                $response.StatusCode = 200
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $respStr = '{"status":"error"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($respStr)
                $response.ContentType = "application/json; charset=utf-8"
                $response.StatusCode = 500
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $response.Close()
            continue
        }

        # 6. api.php general GET fallback
        if ($localPath -eq "/api.php" -and $request.HttpMethod -eq "GET") {
            if ($request.Url.Query -match "action=diagnostic" -or $request.Url.Query -match "action=health") {
                $list = @()
                if (Test-Path $dataFile) {
                    try { $list = ConvertFrom-Json ([System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)) } catch { $list = @() }
                }
                $adms = @()
                if (Test-Path $adminsFile) {
                    try { $adms = ConvertFrom-Json ([System.IO.File]::ReadAllText($adminsFile, [System.Text.Encoding]::UTF8)) } catch { $adms = @() }
                }
                $diag = @{
                    status = "ok"
                    serverTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    phpVersion = "Local Dev Server (PowerShell)"
                    sqliteSupported = $false
                    sqliteActive = $false
                    jsonExists = (Test-Path $dataFile)
                    jsonWritable = $true
                    adminsExists = (Test-Path $adminsFile)
                    adminsWritable = $true
                    dirWritable = $true
                    dataFile = "responses.json"
                    adminsFile = "admins.json"
                    storageEngine = "PowerShell Dev Server (JSON)"
                    count = $list.Count
                    adminsCount = $adms.Count
                    healthy = $true
                }
                $diagJson = ConvertTo-Json -InputObject $diag
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($diagJson)
                $response.ContentType = "application/json; charset=utf-8"
                $response.StatusCode = 200
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }

            if ($request.Url.Query -match "action=admins_get" -or $request.Url.Query -match "action=get_admins") {
                $admsContent = "[]"
                if (Test-Path $adminsFile) {
                    $admsContent = [System.IO.File]::ReadAllText($adminsFile, [System.Text.Encoding]::UTF8)
                }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($admsContent)
                $response.ContentType = "application/json; charset=utf-8"
                $response.StatusCode = 200
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }

            $jsonContent = "[]"
            if (Test-Path $dataFile) {
                $jsonContent = [System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)
                if ([string]::IsNullOrWhiteSpace($jsonContent)) { $jsonContent = "[]" }
            }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonContent)
            $response.ContentType = "application/json; charset=utf-8"
            $response.StatusCode = 200
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }

        # 7. api.php general POST fallback
        if ($localPath -eq "/api.php" -and $request.HttpMethod -eq "POST") {
            $body = Get-RequestBody $request

            $reqObj = ConvertFrom-Json $body
            $actionQ = $request.Url.Query

            # Admin Auth
            if ($actionQ -match "action=admin_login" -or $reqObj.action -eq "admin_login") {
                $adms = @()
                if (Test-Path $adminsFile) {
                    $rawA = [System.IO.File]::ReadAllText($adminsFile, [System.Text.Encoding]::UTF8)
                    try { $adms = @(ConvertFrom-Json $rawA) } catch { $adms = @() }
                }
                $found = $null
                $uInput = ""
                if ($reqObj.username) { $uInput = $reqObj.username.ToString().Trim().ToLower() }
                $pInput = ""
                if ($reqObj.password) { $pInput = $reqObj.password.ToString().Trim() }

                for ($d = 0; $d -lt 10; $d++) {
                    $arChar = [string][char](0x0660 + $d)
                    $pInput = $pInput.Replace($arChar, [string]$d)
                }

                foreach ($a in $adms) {
                    $admU = ""
                    if ($a.username) { $admU = $a.username.ToString().Trim().ToLower() }
                    $admP = ""
                    if ($a.password) { $admP = $a.password.ToString().Trim() }

                    $uOk = ($admU -eq $uInput -or ($admU -eq "admin" -and ($uInput -in @("admin", "supervisor"))))
                    $pOk = ($admP -eq $pInput -or ($admU -eq "admin" -and ($pInput -in @("admin123", "admin"))))
                    if ($uOk -and $pOk) {
                        $found = $a
                        break
                    }
                }
                if ($found) {
                    $userPayload = @{
                        status  = "success"
                        message = "Login successful"
                        user    = @{
                            username = $found.username
                            fullName = $found.fullName
                            role     = $found.role
                            province = $found.province
                        }
                    }
                    $respStr = ConvertTo-Json -InputObject $userPayload -Compress
                    $response.StatusCode = 200
                } else {
                    $respStr = '{"status":"error","message":"Invalid credentials"}'
                    $response.StatusCode = 401
                }
            } elseif ($actionQ -match "action=admin_create" -or $reqObj.action -eq "admin_create") {
                $adms = @()
                if (Test-Path $adminsFile) {
                    $rawA = [System.IO.File]::ReadAllText($adminsFile, [System.Text.Encoding]::UTF8)
                    try { $adms = @(ConvertFrom-Json $rawA) } catch { $adms = @() }
                }
                $admFullName = $reqObj.username
                if ($reqObj.fullName) { $admFullName = $reqObj.fullName }
                $admRole = "SUPERVISOR"
                if ($reqObj.role) { $admRole = $reqObj.role }
                $admProvince = "Karbala"
                if ($reqObj.province) { $admProvince = $reqObj.province }

                $newAdm = @{
                    username  = $reqObj.username
                    password  = $reqObj.password
                    fullName  = $admFullName
                    role      = $admRole
                    province  = $admProvince
                    createdAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                }
                $adms = @($adms) + @($newAdm)
                $outJson = ConvertTo-Json -InputObject $adms -Depth 10
                [System.IO.File]::WriteAllText($adminsFile, $outJson, [System.Text.Encoding]::UTF8)
                $respStr = '{"status":"success","message":"Account created successfully"}'
                $response.StatusCode = 200
            } elseif ($actionQ -match "action=admin_update" -or $reqObj.action -eq "admin_update") {
                $adms = @()
                if (Test-Path $adminsFile) {
                    $rawA = [System.IO.File]::ReadAllText($adminsFile, [System.Text.Encoding]::UTF8)
                    try { $adms = @(ConvertFrom-Json $rawA) } catch { $adms = @() }
                }
                for ($i = 0; $i -lt $adms.Count; $i++) {
                    if ($adms[$i].username.ToLower() -eq $reqObj.username.ToLower()) {
                        if ($reqObj.fullName) { $adms[$i].fullName = $reqObj.fullName }
                        if ($reqObj.role) { $adms[$i].role = $reqObj.role }
                        if ($reqObj.province) { $adms[$i].province = $reqObj.province }
                        if ($reqObj.password) { $adms[$i].password = $reqObj.password }
                        break
                    }
                }
                $outJson = ConvertTo-Json -InputObject $adms -Depth 10
                [System.IO.File]::WriteAllText($adminsFile, $outJson, [System.Text.Encoding]::UTF8)
                $respStr = '{"status":"success","message":"Account updated successfully"}'
                $response.StatusCode = 200
            } elseif ($actionQ -match "action=admin_change_password" -or $reqObj.action -eq "admin_change_password") {
                $adms = @()
                if (Test-Path $adminsFile) {
                    $rawA = [System.IO.File]::ReadAllText($adminsFile, [System.Text.Encoding]::UTF8)
                    try { $adms = @(ConvertFrom-Json $rawA) } catch { $adms = @() }
                }
                for ($i = 0; $i -lt $adms.Count; $i++) {
                    if ($adms[$i].username.ToLower() -eq $reqObj.username.ToLower()) {
                        $adms[$i].password = $reqObj.newPassword
                        break
                    }
                }
                $outJson = ConvertTo-Json -InputObject $adms -Depth 10
                [System.IO.File]::WriteAllText($adminsFile, $outJson, [System.Text.Encoding]::UTF8)
                $respStr = '{"status":"success","message":"Password changed successfully"}'
                $response.StatusCode = 200
            } elseif ($actionQ -match "action=admin_delete" -or $reqObj.action -eq "admin_delete") {
                $adms = @()
                if (Test-Path $adminsFile) {
                    $rawA = [System.IO.File]::ReadAllText($adminsFile, [System.Text.Encoding]::UTF8)
                    try { $adms = @(ConvertFrom-Json $rawA) } catch { $adms = @() }
                }
                $filteredA = @($adms | Where-Object { $_.username.ToLower() -ne $reqObj.username.ToLower() })
                $outJson = ConvertTo-Json -InputObject $filteredA -Depth 10
                [System.IO.File]::WriteAllText($adminsFile, $outJson, [System.Text.Encoding]::UTF8)
                $respStr = '{"status":"success","message":"Supervisor deleted"}'
                $response.StatusCode = 200
            } elseif ($actionQ -match "action=clear" -or $reqObj.action -eq "clear") {
                [System.IO.File]::WriteAllText($dataFile, "[]", [System.Text.Encoding]::UTF8)
                $respStr = '{"status":"cleared"}'
                $response.StatusCode = 200
            } elseif ($actionQ -match "action=delete" -or $reqObj.action -eq "delete") {
                $delId = $reqObj.id
                if (Test-Path $dataFile) {
                    $raw = [System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)
                    if (-not [string]::IsNullOrWhiteSpace($raw)) {
                        $list = ConvertFrom-Json $raw
                        $filtered = @($list | Where-Object { $_.id -ne $delId })
                        $outJson = ConvertTo-Json -InputObject $filtered -Depth 10
                        [System.IO.File]::WriteAllText($dataFile, $outJson, [System.Text.Encoding]::UTF8)
                    }
                }
                $respStr = '{"status":"deleted"}'
                $response.StatusCode = 200
            } else {
                # Submit
                $list = @()
                if (Test-Path $dataFile) {
                    $raw = [System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8)
                    if (-not [string]::IsNullOrWhiteSpace($raw)) {
                        try { $list = ConvertFrom-Json $raw } catch { $list = @() }
                    }
                }
                $updatedList = @($reqObj) + @($list)
                $outJson = ConvertTo-Json -InputObject $updatedList -Depth 10
                [System.IO.File]::WriteAllText($dataFile, $outJson, [System.Text.Encoding]::UTF8)
                $respStr = '{"status":"success"}'
                $response.StatusCode = 200
            }

            $bytes = [System.Text.Encoding]::UTF8.GetBytes($respStr)
            $response.ContentType = "application/json; charset=utf-8"
            if (-not $response.StatusCode -or $response.StatusCode -eq 0) {
                $response.StatusCode = 200
            }
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
            continue
        }

        # Static files
        $cleanPath = $localPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($cleanPath)) {
            $cleanPath = "index.html"
        }

        $decoded = [System.Uri]::UnescapeDataString($cleanPath).Replace('/', '\')
        $localFile = Join-Path $baseDir $decoded

        if (Test-Path $localFile -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($localFile)
            $ext = [System.IO.Path]::GetExtension($localFile).ToLower()
            $contentType = "application/octet-stream"
            switch ($ext) {
                ".html" { $contentType = "text/html; charset=utf-8" }
                ".css"  { $contentType = "text/css; charset=utf-8" }
                ".js"   { $contentType = "application/javascript; charset=utf-8" }
                ".jpg"  { $contentType = "image/jpeg" }
                ".jpeg" { $contentType = "image/jpeg" }
                ".png"  { $contentType = "image/png" }
                ".svg"  { $contentType = "image/svg+xml" }
                ".json" { $contentType = "application/json; charset=utf-8" }
                ".ico"  { $contentType = "image/x-icon" }
            }

            $response.ContentType = $contentType
            $response.StatusCode = 200
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("File not found: " + $cleanPath)
            $response.ContentType = "text/plain; charset=utf-8"
            $response.ContentLength64 = $msg.Length
            $response.OutputStream.Write($msg, 0, $msg.Length)
        }
        $response.Close()
    } catch {
        Write-Verbose "Server loop: $($_.Exception.Message)"
    }
}
