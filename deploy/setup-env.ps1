# Setup environment file for Docker deployment
# Run this script before running docker compose

Write-Host "Setting up environment files..." -ForegroundColor Green

# Copy .env from parent directory to deploy directory
$sourceEnv = Join-Path $PSScriptRoot ".." ".env"
$targetEnv = Join-Path $PSScriptRoot ".env"

if (Test-Path $sourceEnv) {
    Copy-Item -Path $sourceEnv -Destination $targetEnv -Force
    Write-Host "✓ Copied .env file to deploy directory" -ForegroundColor Green
} else {
    Write-Host "✗ .env file not found in parent directory" -ForegroundColor Red
    Write-Host "Please create .env file from .env.example first" -ForegroundColor Yellow
    exit 1
}

Write-Host "`nYou can now run: docker compose up -d --build" -ForegroundColor Cyan
