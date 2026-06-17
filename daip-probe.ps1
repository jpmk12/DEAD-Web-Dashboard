<#
  daip-probe.ps1 — capture DAIP (Department of Defense Aeronautical Information Portal)
  endpoint responses for the DEAD dashboard FIR/Fuel/GPS integration.

  Run this on a machine that can reach https://www.daip.jcs.mil directly
  (i.e. NOT behind the Claude sandbox egress proxy). The DAIP mobile
  endpoints used here are public read endpoints (no login required).

  Works in Windows PowerShell 5.1 AND PowerShell 7+.

  Usage:
      powershell -ExecutionPolicy Bypass -File .\daip-probe.ps1
      # or in pwsh:
      pwsh ./daip-probe.ps1

  Output: a folder .\daip-capture-<timestamp>\ with one file per request,
  a manifest.json, and a single zipped file .\daip-capture-<timestamp>.zip
  Hand me that .zip (or the manifest.json + the *_FUEL_*/*_GPS_*/*nfir* bodies).

  NOTE on TLS: DAIP serves a DoD PKI certificate. If your machine doesn't
  trust the DoD root chain you'd normally get a cert error. This script
  bypasses certificate validation (read-only capture of public data) so it
  works on any machine. If you ARE on a DoD/CAC machine that trusts DoD PKI,
  it still works.
#>

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'DAIP probe'

# --- TLS / cert setup --------------------------------------------------------
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 }
catch { try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {} }

$IsPS7 = $PSVersionTable.PSVersion.Major -ge 6

if (-not $IsPS7) {
    # Windows PowerShell 5.1: disable cert validation via callback
    Add-Type @"
using System.Net;
using System.Security.Cryptography.X509Certificates;
public class DaipCertPolicy : ICertificatePolicy {
    public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
    [System.Net.ServicePointManager]::CertificatePolicy = New-Object DaipCertPolicy
}

# --- output dir --------------------------------------------------------------
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir  = Join-Path (Get-Location) "daip-capture-$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$bodyDir = Join-Path $outDir 'bodies'
New-Item -ItemType Directory -Path $bodyDir -Force | Out-Null

$BASE = 'https://www.daip.jcs.mil'
$manifest = New-Object System.Collections.ArrayList
$idx = 0

function Invoke-Daip {
    param(
        [string]$Name,
        [string]$Method = 'GET',
        [string]$Path,
        $Body = $null,                 # string (form) or hashtable (-> JSON)
        [string]$ContentType = $null
    )
    $script:idx++
    $url = if ($Path -match '^https?://') { $Path } else { "$BASE$Path" }
    $safeName = ('{0:000}-{1}' -f $script:idx, ($Name -replace '[^A-Za-z0-9_.-]','_'))

    $bodyStr = $null
    if ($Body -ne $null) {
        if ($Body -is [hashtable]) {
            $bodyStr = ($Body | ConvertTo-Json -Compress)
            if (-not $ContentType) { $ContentType = 'application/json' }
        } else {
            $bodyStr = [string]$Body
            if (-not $ContentType) { $ContentType = 'application/x-www-form-urlencoded' }
        }
    }

    $params = @{
        Uri             = $url
        Method          = $Method
        UserAgent       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        TimeoutSec      = 60
        UseBasicParsing = $true
        Headers         = @{
            'Accept'           = 'application/json, text/javascript, text/html, */*'
            'X-Requested-With' = 'XMLHttpRequest'
        }
    }
    if ($bodyStr) { $params.Body = $bodyStr; $params.ContentType = $ContentType }
    if ($IsPS7)   { $params.SkipCertificateCheck = $true; $params.SkipHttpErrorCheck = $true }

    $status = $null; $ctype = $null; $content = $null; $errMsg = $null
    try {
        $resp    = Invoke-WebRequest @params
        $status  = [int]$resp.StatusCode
        $content = $resp.Content
        try { $ctype = $resp.Headers['Content-Type'] } catch {}
        if ($ctype -is [array]) { $ctype = $ctype -join ', ' }
    } catch {
        $errMsg = $_.Exception.Message
        $resp2  = $_.Exception.Response
        if ($resp2) {
            try { $status = [int]$resp2.StatusCode } catch {}
            try {
                $sr = New-Object System.IO.StreamReader($resp2.GetResponseStream())
                $content = $sr.ReadToEnd(); $sr.Close()
            } catch {}
        }
    }

    $ext = if ($ctype -match 'json') { 'json' } elseif ($ctype -match 'html') { 'html' } elseif ($ctype -match 'javascript') { 'js' } else { 'txt' }
    $bodyFile = "$safeName.$ext"
    if ($content -ne $null) {
        Set-Content -Path (Join-Path $bodyDir $bodyFile) -Value $content -Encoding UTF8
    }

    $len     = if ($content) { $content.Length } else { 0 }
    $preview = if ($content) { $content.Substring(0, [Math]::Min(300, $content.Length)) } else { '' }
    $looksJson = ($content -ne $null) -and ($content.TrimStart().StartsWith('{') -or $content.TrimStart().StartsWith('['))

    [void]$manifest.Add([pscustomobject]@{
        n           = $script:idx
        name        = $Name
        method      = $Method
        url         = $url
        requestBody = $bodyStr
        status      = $status
        contentType = $ctype
        length      = $len
        looksJson   = $looksJson
        bodyFile    = "bodies/$bodyFile"
        error       = $errMsg
        preview     = $preview
    })

    $flag = if ($looksJson -and $len -gt 50) { 'JSON' } elseif ($status -eq 200) { 'ok' } else { '--' }
    Write-Host ('  [{0,4}] {1,-44} {2,5} {3,8}b  {4}' -f $status, $Name, $flag, $len, $url)
}

Write-Host "DAIP probe -> $outDir`n"

# ============================================================================
# 1) DISCOVERY: index HTML + the JS files that define the real endpoints
# ============================================================================
Write-Host '== discovery (HTML + JS) =='
Invoke-Daip -Name 'index'            -Path '/daip/mobile/index'
Invoke-Daip -Name 'js_index'         -Path '/daip/js/index.js'
Invoke-Daip -Name 'js_adv'           -Path '/daip/js/adv.js'
Invoke-Daip -Name 'js_common'        -Path '/daip/js/common.js'
Invoke-Daip -Name 'js_candidate'     -Path '/daip/js/candidate_notam.js'
Invoke-Daip -Name 'js_templates'     -Path '/daip/js/templates.js'
Invoke-Daip -Name 'js_resources'     -Path '/daip/js/resources.js'

# ============================================================================
# 2) CONFIRMED CONTRACT: FIR / airspace NOTAMs (GET /daip/mobile/nfir)
#    ZNY = NY ARTCC (guaranteed data). Conflict-overflight FIRs included.
# ============================================================================
Write-Host '== FIR NOTAMs (confirmed nfir contract) =='
$firCodes = @{
    'nfir_ZNY_NY-ARTCC'     = 'ZNY'    # guaranteed data
    'nfir_OSTT_Damascus'    = 'OSTT'
    'nfir_UUWV_Moscow'      = 'UUWV'
    'nfir_ORBB_Baghdad'     = 'ORBB'
    'nfir_OIIX_Tehran'      = 'OIIX'
    'nfir_UKBV_Kyiv'        = 'UKBV'
}
foreach ($k in $firCodes.Keys) {
    $loc = $firCodes[$k]
    Invoke-Daip -Name $k -Path "/daip/mobile/nfir?type=FIR_ARTCC&locs=$loc&radius=10&sort=Criticality"
}
# wildcard (may be large) + a couple of facet probes via acode
Invoke-Daip -Name 'nfir_ALL_wildcard'   -Path '/daip/mobile/nfir?type=FIR_ARTCC&locs=*&radius=10&sort=Criticality'
Invoke-Daip -Name 'nfir_ZNY_acode_TFR'  -Path '/daip/mobile/nfir?type=FIR_ARTCC&locs=ZNY&radius=10&sort=Criticality&acode=TFR'
Invoke-Daip -Name 'nfir_ZNY_acode_MOA'  -Path '/daip/mobile/nfir?type=FIR_ARTCC&locs=ZNY&radius=10&sort=Criticality&acode=MOA'

# ============================================================================
# 3) CONFIRMED CONTRACT: Location query (POST /daip/mobile/query)
#    KADW = Joint Base Andrews (DoD), KCHS = Charleston (C-17).
#    Capture both "locations":[...] (current code) and "locs":"..." (HTML form).
# ============================================================================
Write-Host '== Location query (POST /daip/mobile/query) =='
Invoke-Daip -Name 'query_LOCATION_json_locations' -Method POST -Path '/daip/mobile/query' -Body @{ type='LOCATION'; locations=@('KADW','KCHS') }
Invoke-Daip -Name 'query_LOCATION_json_locs'      -Method POST -Path '/daip/mobile/query' -Body @{ type='LOCATION'; locs='KADW KCHS' }
Invoke-Daip -Name 'query_LOCATION_form'           -Method POST -Path '/daip/mobile/query' -Body 'type=LOCATION&locs=KADW+KCHS' -ContentType 'application/x-www-form-urlencoded'

# Route of flight (KCHS -> EDDF Ramstein-area, alternate EGUN Mildenhall)
Invoke-Daip -Name 'query_ROUTE_json' -Method POST -Path '/daip/mobile/query' -Body @{ type='ROUTE_OF_FLIGHT'; pod='KCHS'; poa='ETAR'; alternates='EDDF'; radius='10'; airportType='B' }

# ============================================================================
# 4) DISCOVERY MATRIX: FUEL_NOTAMS & GPS_WAAS endpoint+method
#    We don't yet know the path/method, so try the plausible combinations.
#    Whichever returns a {group:[...]} / list[] JSON body is the winner.
# ============================================================================
Write-Host '== Fuel / GPS endpoint discovery matrix =='
$targets = @('FUEL_NOTAMS','GPS_WAAS')
foreach ($t in $targets) {
    # POST /query as JSON (most likely - mirrors LOCATION)
    Invoke-Daip -Name "matrix_${t}_query_json"       -Method POST -Path '/daip/mobile/query' -Body @{ type=$t }
    # POST /query as form
    Invoke-Daip -Name "matrix_${t}_query_form"       -Method POST -Path '/daip/mobile/query' -Body "type=$t" -ContentType 'application/x-www-form-urlencoded'
    # GET /query
    Invoke-Daip -Name "matrix_${t}_query_get"        -Path "/daip/mobile/query?type=$t"
    # POST /adv as form (advform)
    Invoke-Daip -Name "matrix_${t}_adv_form"         -Method POST -Path '/daip/mobile/adv' -Body "type=$t" -ContentType 'application/x-www-form-urlencoded'
    # GET /adv
    Invoke-Daip -Name "matrix_${t}_adv_get"          -Path "/daip/mobile/adv?type=$t"
    # nfir with the type (in case fuel/gps ride the nfir endpoint)
    Invoke-Daip -Name "matrix_${t}_nfir_get"         -Path "/daip/mobile/nfir?type=$t&locs=*&radius=10"
    # GET /index with type (advform action="" -> current page)
    Invoke-Daip -Name "matrix_${t}_index_get"        -Path "/daip/mobile/index?type=$t"
}

# ============================================================================
# 5) LIGHTER PROBES: the other advanced-search type codes (POST /query JSON)
# ============================================================================
Write-Host '== other type codes (POST /query JSON) =='
$otherTypes = @('ATTENTION_NOTICES','FDC_NOTICES','FDC_SPECIAL_NOTICES','DAFIF_FLIP_CHART_NOTICES','PACIFIC_TRACKS','ARTCC_TFRS','PRESIDENTIAL_TFRS','EUROPEAN_RVSM','MOA')
foreach ($t in $otherTypes) {
    Invoke-Daip -Name "type_${t}_query_json" -Method POST -Path '/daip/mobile/query' -Body @{ type=$t }
}

# ============================================================================
# 6) TFA / Area Briefing / Birdtams / misc
# ============================================================================
Write-Host '== TFA / area briefing / misc =='
Invoke-Daip -Name 'tfaprint'             -Path '/daip/mobile/tfaprint'
Invoke-Daip -Name 'candidatenotam_get'   -Path '/daip/mobile/candidatenotam'
Invoke-Daip -Name 'tfa_query_json'       -Method POST -Path '/daip/mobile/query' -Body @{ type='CANDIDATE' }
Invoke-Daip -Name 'tfa_query_json2'      -Method POST -Path '/daip/mobile/query' -Body @{ type='TFA' }
# Area briefing - lat/long box around Damascus (guess at params; JS will confirm)
Invoke-Daip -Name 'areabrief_query_json' -Method POST -Path '/daip/mobile/query' -Body @{ type='AREA_BRIEFING'; lat1='34'; lng1='35'; lat2='37'; lng2='39'; latdir='N'; longdir='E'; radius='50' }
Invoke-Daip -Name 'birdtam'              -Path '/daip/birdtam.do'

# ============================================================================
# write manifest + zip
# ============================================================================
$manifestPath = Join-Path $outDir 'manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

# quick summary of the winners (JSON bodies)
$winners = $manifest | Where-Object { $_.looksJson -and $_.length -gt 50 }
Write-Host "`n== JSON responses captured (likely useful) =="
$winners | ForEach-Object { Write-Host ('  {0}  ({1}b)  {2}' -f $_.name, $_.length, $_.url) }

$zipPath = "$outDir.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
try {
    Compress-Archive -Path "$outDir\*" -DestinationPath $zipPath -Force
    Write-Host "`nDONE. Hand me this file:`n  $zipPath"
} catch {
    Write-Host "`nDONE (zip failed, hand me the folder instead):`n  $outDir`n  ($($_.Exception.Message))"
}
