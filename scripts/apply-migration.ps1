# ===========================================================================
# Applies a single migration file to the production Supabase database.
#
# The connection string lives in supabase/.env.prod.local (gitignored):
#   PROD_DB_URL=postgresql://...        <- Dashboard -> Connect -> Session pooler
#
# Uses psql from the cached Supabase Postgres Docker image, so no local psql
# install is needed. The file runs in ONE transaction with ON_ERROR_STOP: it
# either fully applies or changes nothing.
#
# Usage:
#   powershell -File scripts/apply-migration.ps1 supabase/migrations/0012_x.sql
#   ... -Force     # skip the confirmation prompt
# ===========================================================================
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$MigrationFile,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot "supabase\.env.prod.local"
$image = "public.ecr.aws/supabase/postgres:17.11.0.004"

if (-not (Test-Path -LiteralPath $MigrationFile)) {
  throw "Migration file not found: $MigrationFile"
}
$migrationPath = (Resolve-Path -LiteralPath $MigrationFile).Path

if (-not (Test-Path -LiteralPath $envFile)) {
  throw @"
Missing $envFile.
Create it with one line (Supabase Dashboard -> Connect -> Session pooler -> URI):
  PROD_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
"@
}

$line = Get-Content -LiteralPath $envFile |
  Where-Object { $_ -match '^\s*PROD_DB_URL\s*=' } |
  Select-Object -First 1
if (-not $line) { throw "PROD_DB_URL is not set in $envFile" }
$url = ($line -replace '^\s*PROD_DB_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
if (-not $url) { throw "PROD_DB_URL is empty in $envFile" }

# Never print the password; show the host so it's obvious which project changes.
$target = $url -replace '://[^@/]+@', '://***@'
$name = Split-Path -Leaf $migrationPath

if (-not $Force) {
  Write-Host "About to apply $name to:" -ForegroundColor Yellow
  Write-Host "  $target"
  $answer = Read-Host "Type 'yes' to continue"
  if ($answer -ne "yes") { Write-Host "Aborted."; exit 1 }
}

Write-Host "Applying $name ..."
docker run --rm -i `
  -v "${migrationPath}:/migration.sql:ro" `
  $image psql "$url" -w -v ON_ERROR_STOP=1 --single-transaction -f /migration.sql
if ($LASTEXITCODE -ne 0) {
  throw "Migration failed (exit code $LASTEXITCODE) - nothing was applied (single transaction)."
}

Write-Host "Applied $name successfully." -ForegroundColor Green
