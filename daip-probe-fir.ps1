<#
  daip-probe-fir.ps1 — v2, targeted capture for the DEAD dashboard airspace module.

  v1 (daip-probe.ps1) proved DAIP is one endpoint: POST /daip/mobile/query, the
  `type` field selects the class, every response shares the group->notams->list
  envelope. This v2 grabs the few things v1 missed:

    1. A REAL FIR_ARTCC response (v1 only hit the dead GET /nfir) — the fixture
       that finalizes the Crisis-map "Overflight" layer. Single FIR, conflict
       FIRs, multi-FIR-in-one-call, and the array-vs-string locs variants.
    2. Fresh GPS_WAAS (to extract Q-line lat/long for a future geographic GPS
       layer) and FUEL_NOTAMS (in case it has data now; was count 0).
    3. AREA_BRIEFING over a conflict box + the TFA candidate endpoint.

  Run on a machine with direct internet (NOT behind the Claude sandbox proxy):
      powershell -ExecutionPolicy Bypass -File ".\daip-probe-fir.ps1"
      # or:  pwsh ./daip-probe-fir.ps1
  Output: .\daip-fir-<timestamp>.zip  — send me that file.

  Works on Windows PowerShell 5.1 and PowerShell 7+. Bypasses cert validation
  (read-only capture of public data) so it works on any machine.
#>

$ErrorActionPreference = 'Stop'

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 }
catch { try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {} }

$IsPS7 = $PSVersionTable.PSVersion.Major -ge 6
if (-not $IsPS7) {
    Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class DaipFirCertPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object DaipFirCertPolicy
}

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir  = Join-Path (Get-Location) "daip-fir-$stamp"
$bodyDir = Join-Path $outDir 'bodies'
New-Item -ItemType Directory -Path $bodyDir -Force | Out-Null

$BASE = 'https://www.daip.jcs.mil'
$manifest = New-Object System.Collections.ArrayList
$idx = 0

function Invoke-Daip {
    param([string]$Name, [string]$Method = 'POST', [string]$Path = '/daip/mobile/query', $Body = $null)
    $script:idx++
    $url = "$BASE$Path"
    $safeName = ('{0:00}-{1}' -f $script:idx, ($Name -replace '[^A-Za-z0-9_.-]','_'))

    $bodyStr = $null; $ctype = $null
    if ($Body -ne $null) {
        if ($Body -is [hashtable]) { $bodyStr = ($Body | ConvertTo-Json -Compress); $ctype = 'application/json' }
        else { $bodyStr = [string]$Body; $ctype = 'application/x-www-form-urlencoded' }
    }

    $params = @{
        Uri = $url; Method = $Method; TimeoutSec = 60; UseBasicParsing = $true
        UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        Headers = @{ 'Accept' = 'application/json, text/javascript, */*'; 'X-Requested-With' = 'XMLHttpRequest' }
    }
    if ($bodyStr) { $params.Body = $bodyStr; $params.ContentType = $ctype }
    if ($IsPS7)   { $params.SkipCertificateCheck = $true; $params.SkipHttpErrorCheck = $true }

    $status = $null; $content = $null; $err = $null
    try {
        $resp = Invoke-WebRequest @params
        $status = [int]$resp.StatusCode; $content = $resp.Content
    } catch {
        $err = $_.Exception.Message
        $r2 = $_.Exception.Response
        if ($r2) {
            try { $status = [int]$r2.StatusCode } catch {}
            try { $sr = New-Object System.IO.StreamReader($r2.GetResponseStream()); $content = $sr.ReadToEnd(); $sr.Close() } catch {}
        }
    }

    $bodyFile = "$safeName.json"
    if ($content -ne $null) { Set-Content -Path (Join-Path $bodyDir $bodyFile) -Value $content -Encoding UTF8 }

    # quick parse: count + first group/notam to eyeball success
    $count = $null; $groups = $null; $firstGroup = $null
    try {
        $j = $content -replace '^\xEF\xBB\xBF',''  | ConvertFrom-Json
        $count = $j.count; if ($j.group) { $groups = @($j.group).Count; $firstGroup = @($j.group)[0].name }
    } catch {}

    [void]$manifest.Add([pscustomobject]@{
        n = $script:idx; name = $Name; method = $Method; requestBody = $bodyStr
        status = $status; length = ($(if ($content) { $content.Length } else { 0 }))
        count = $count; groups = $groups; firstGroup = $firstGroup; bodyFile = "bodies/$bodyFile"; error = $err
    })
    Write-Host ('  [{0,4}] {1,-34} count={2,-5} groups={3,-4} {4}' -f $status, $Name, $count, $groups, $firstGroup)
}

Write-Host "DAIP FIR probe -> $outDir`n== FIR_ARTCC (the priority) =="

# --- The critical FIR_ARTCC captures -----------------------------------------
Invoke-Daip -Name 'fir_ZNY'            -Body @{ type='FIR_ARTCC'; locs='ZNY';            radius='10'; sort='Criticality' }
Invoke-Daip -Name 'fir_OSTT_Damascus'  -Body @{ type='FIR_ARTCC'; locs='OSTT';           radius='10'; sort='Criticality' }
Invoke-Daip -Name 'fir_ORBB_Baghdad'   -Body @{ type='FIR_ARTCC'; locs='ORBB';           radius='10'; sort='Criticality' }
Invoke-Daip -Name 'fir_OIIX_Tehran'    -Body @{ type='FIR_ARTCC'; locs='OIIX';           radius='10'; sort='Criticality' }
Invoke-Daip -Name 'fir_multi_conflict' -Body @{ type='FIR_ARTCC'; locs='OSTT ORBB OIIX'; radius='10'; sort='Criticality' }
Invoke-Daip -Name 'fir_RU_UA'          -Body @{ type='FIR_ARTCC'; locs='UUWV UKBV';      radius='10'; sort='Criticality' }
# variant: array-form locations (confirm interchangeable with locs string)
Invoke-Daip -Name 'fir_ZNY_array'      -Body @{ type='FIR_ARTCC'; locations=@('ZNY');    radius='10'; sort='Criticality' }
# facet within a FIR (TFR only)
Invoke-Daip -Name 'fir_ZNY_acode_TFR'  -Body @{ type='FIR_ARTCC'; locs='ZNY'; acode='TFR'; radius='10'; sort='Criticality' }
# wildcard — may be large; capped by the 60s timeout, fine if it truncates
Invoke-Daip -Name 'fir_wildcard'       -Body @{ type='FIR_ARTCC'; locs='*';              radius='10'; sort='Criticality' }

Write-Host "`n== confirmations (GPS Q-line coords, fuel, area, TFA) =="
Invoke-Daip -Name 'gps_waas'           -Body @{ type='GPS_WAAS' }
Invoke-Daip -Name 'fuel_notams'        -Body @{ type='FUEL_NOTAMS' }
# AREA_BRIEFING over a Syria/Iraq box (compare vs FIR for overflight)
Invoke-Daip -Name 'area_syria_iraq'    -Body @{ type='AREA_BRIEFING'; lat1='32'; lng1='36'; lat2='37'; lng2='46'; latdir='N'; longdir='E'; radius='50' }
# TFA candidate NOTAMs (its own GET endpoint, per candidate_notam.js)
Invoke-Daip -Name 'tfaquery' -Method GET -Path '/daip/mobile/tfaquery'

# --- write manifest + zip ----------------------------------------------------
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $outDir 'manifest.json') -Encoding UTF8

Write-Host "`n== FIR captures that returned data =="
$manifest | Where-Object { $_.name -like 'fir_*' -and $_.count -gt 0 } |
    ForEach-Object { Write-Host ('  {0}: {1} NOTAMs in {2} group(s)' -f $_.name, $_.count, $_.groups) }
if (-not ($manifest | Where-Object { $_.name -like 'fir_*' -and $_.count -gt 0 })) {
    Write-Host '  (!) No FIR_ARTCC call returned data — send the zip anyway so I can see the raw responses.'
}

$zip = "$outDir.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
try { Compress-Archive -Path "$outDir\*" -DestinationPath $zip -Force; Write-Host "`nDONE. Send me:`n  $zip" }
catch { Write-Host "`nDONE (zip failed, send the folder):`n  $outDir`n  $($_.Exception.Message)" }
