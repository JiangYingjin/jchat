#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

docker build -t jchat:latest -f "$PROJECT_ROOT/Dockerfile" "$PROJECT_ROOT"
cd "$PROJECT_ROOT" && bash "$SCRIPT_DIR/restart.sh"
