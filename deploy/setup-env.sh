#!/bin/bash
# Setup environment file for Docker deployment
# Run this script before running docker compose

echo "Setting up environment files..."

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE_ENV="$SCRIPT_DIR/../.env"
TARGET_ENV="$SCRIPT_DIR/.env"

if [ -f "$SOURCE_ENV" ]; then
    cp "$SOURCE_ENV" "$TARGET_ENV"
    echo "✓ Copied .env file to deploy directory"
else
    echo "✗ .env file not found in parent directory"
    echo "Please create .env file from .env.example first"
    exit 1
fi

echo ""
echo "You can now run: docker compose up -d --build"
