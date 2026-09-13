# Run this file in a terminal. Passwords are read securely and never echoed.
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $OutputEncoding
$backendDirectory = Join-Path $PSScriptRoot 'backend'
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$setupScript = Join-Path $backendDirectory 'scripts\setup-local.js'

function Invoke-SetupNode([string[]]$Arguments, [string]$InputText) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeExecutable
    $startInfo.Arguments = '"' + $setupScript + '" ' + ($Arguments -join ' ')
    $startInfo.WorkingDirectory = $backendDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $inputBytes = $null
    try {
        # StandardInputEncoding is unavailable in Windows PowerShell 5.1.
        if ($InputText) {
            $inputBytes = [System.Text.Encoding]::UTF8.GetBytes($InputText)
            $process.StandardInput.BaseStream.Write($inputBytes, 0, $inputBytes.Length)
            $process.StandardInput.BaseStream.Flush()
        }
        $process.StandardInput.Close()
        $process.WaitForExit()
        return $process.ExitCode
    } finally {
        if ($inputBytes) { [Array]::Clear($inputBytes, 0, $inputBytes.Length) }
        $InputText = $null
        $process.Dispose()
    }
}

function Read-PrivateText([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureValue.Dispose() }
}

try {
    Write-Host 'FLD Primary - Yerel Kurulum' -ForegroundColor Cyan
    Write-Host 'Mevcut yerel baglanti kontrol ediliyor...'
    $checkResult = Invoke-SetupNode @('--check') ''
    if ($checkResult -eq 0) {
        Write-Host 'Yerel kurulum zaten hazir. Site baslatiliyor...'
        $result = Invoke-SetupNode @('--start') ''
        if ($result -ne 0) { throw 'Site baslatilamadi.' }
    } elseif ($checkResult -eq 10) {
        Write-Host 'Sifreler yazarken ekranda gorunmez ve kayitlara yazilmaz.'
        $adminPassword = Read-PrivateText 'Site admin sifren (en az 12 karakter)'
        $adminConfirmation = Read-PrivateText 'Site admin sifreni tekrar yaz'
        if ($adminPassword -cne $adminConfirmation) { throw 'Admin sifreleri ayni degil. Tekrar baslatabilirsin.' }
        $payload = @{ adminPassword=$adminPassword } | ConvertTo-Json -Compress
        $result = Invoke-SetupNode @() $payload
        $payload = $null; $postgresPassword = $null; $adminPassword = $null; $adminConfirmation = $null
        if ($result -ne 0) { throw 'Kurulum tamamlanamadi. Yukaridaki mesaji kontrol et.' }
    } else { throw 'Mevcut ayarlar otomatik yerel kurulum icin uygun degil.' }
    Write-Host 'Hazir. Yerel admin e-postasi: admin@fld.local' -ForegroundColor Green
    Write-Host 'Site adresi kurulum ciktisinda yaziyor. Bu pencereyi kapatabilirsin.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    $payload = $null; $postgresPassword = $null; $adminPassword = $null; $adminConfirmation = $null
    [void](Read-Host 'Pencereyi kapatmak icin Enter')
}
