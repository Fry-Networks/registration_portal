#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

./build.sh

sleep 5

ORIGIN_URL="http://127.0.0.1:3007"
CDN_URL="https://dashboard.frynetworks.com"
CONTAINER="fry-user-dashboard"

echo "$(date -Iseconds) Deploy gate: checking origin vs CDN..."

origin_code=$(curl -s -L -o /dev/null -w "%{http_code}" --max-time 15 "$ORIGIN_URL" || true)
if [[ "$origin_code" != "200" ]]; then
    echo "Origin health check failed: HTTP $origin_code"
    exit 1
fi

origin_build_id=$(docker exec "$CONTAINER" cat .next/BUILD_ID 2>/dev/null || true)
if [[ -z "$origin_build_id" ]]; then
    echo "Could not read origin build ID"
    exit 1
fi

cdn_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$CDN_URL" || true)
if [[ "$cdn_code" != "200" ]]; then
    echo "CDN health check failed: HTTP $cdn_code"
    exit 1
fi

cdn_html=$(curl -s -L --max-time 15 "$CDN_URL" || true)
cdn_build_id=$(echo "$cdn_html" | python3 -c "import sys,re,json; m=re.search(r'<script id="__NEXT_DATA__" type="application/json">(.+?)</script>',sys.stdin.read()); print(json.loads(m.group(1)).get('buildId','') if m else '')" 2>/dev/null || true)

if [[ "$origin_build_id" != "$cdn_build_id" ]]; then
    echo "Build ID mismatch: origin=$origin_build_id cdn=$cdn_build_id"
    exit 1
fi

mapfile -t assets < <(echo "$cdn_html" | grep -oE '/_next/static/[^"]+\.js' | head -5 | sort -u || true)
for asset in "${assets[@]}"; do
    aurl="${CDN_URL}${asset}"
    acode=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$aurl" || true)
    if [[ "$acode" != "200" ]]; then
        echo "Static asset failed: $aurl HTTP $acode"
        exit 1
    fi
done

echo "$(date -Iseconds) Deploy gate PASSED"
