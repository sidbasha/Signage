#!/usr/bin/env bash
# Restart the API in the background (Development). Logs: /tmp/api.log
set -e
(service postgresql status >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1) || true
cd "$(dirname "$0")/../backend"
[ -f /tmp/api.pid ] && kill "$(cat /tmp/api.pid)" 2>/dev/null || true
sleep 1
dotnet build --no-restore -nologo -v q 2>&1 | grep -E " error" | sed 's/\[.*//' | sort -u || true
cd src/SignageCms.Api
ASPNETCORE_ENVIRONMENT=Development setsid nohup dotnet bin/Debug/net8.0/SignageCms.Api.dll --urls http://0.0.0.0:5080 > /tmp/api.log 2>&1 < /dev/null &
echo $! > /tmp/api.pid
for i in $(seq 1 30); do curl -sf localhost:5080/health >/dev/null && { echo "API up"; exit 0; }; sleep 1; done
echo "API failed to start"; tail -30 /tmp/api.log; exit 1
