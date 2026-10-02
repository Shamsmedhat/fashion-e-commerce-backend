#!/usr/bin/env bash
# Read-only smoke test of the three live deployments (API, storefront, dashboard).
# Run after every deploy:  ./scripts/smoke-live.sh
# Override a target with:  API_URL=... STOREFRONT_URL=... DASHBOARD_URL=... ./scripts/smoke-live.sh
set -u

API_URL="${API_URL:-https://fashion-ecommerce-backend-teal.vercel.app/api/v1}"
STOREFRONT_URL="${STOREFRONT_URL:-https://fashion-e-commerce-frontend-pi.vercel.app}"
DASHBOARD_URL="${DASHBOARD_URL:-https://fashion-ecommerce-dashboard.vercel.app}"

pass=0
fail=0

check() { # check "<description>" "<actual>" "<expected>"
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1))
    printf '  ok    %s\n' "$1"
  else
    fail=$((fail + 1))
    printf '  FAIL  %s (expected %s, got %s)\n' "$1" "$3" "$2"
  fi
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { curl -s "$1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const d=JSON.parse(s);console.log($2)}catch{console.log('invalid-json')}})"; }

echo "API  $API_URL"
check "main categories respond" "$(status "$API_URL/categories/main")" 200
check "main-categories total counts main categories only" "$(json "$API_URL/categories/main" 'd.total===d.results')" true
check "unknown query params do not empty the product list" "$(json "$API_URL/products?utm_source=smoke" 'd.results>0')" true
check "product total reflects the filters" "$(json "$API_URL/products?variants.color=black&limit=100" 'd.total===d.results')" true
check "size filter matches stored sizes" "$(json "$API_URL/products?variants.size=M" 'd.results>0')" true
check "invalid page is a 400" "$(status "$API_URL/products?page=-1")" 400
check "invalid id is a 400" "$(status "$API_URL/products/not-an-id")" 400
check "garbage token is a 401" "$(status -H 'Authorization: Bearer null' "$API_URL/bags/me")" 401
check "wrong credentials are a 401" "$(status -X POST -H 'Content-Type: application/json' -d '{"email":"smoke@example.com","password":"Wrong@123"}' "$API_URL/users/login")" 401
check "catalogue writes need a login" "$(status -X POST -H 'Content-Type: application/json' -d '{}' "$API_URL/products")" 401
check "CORS allows the dashboard" "$(curl -s -o /dev/null -w '%header{access-control-allow-origin}' -X OPTIONS -H "Origin: $DASHBOARD_URL" -H 'Access-Control-Request-Method: POST' "$API_URL/users/login")" "$DASHBOARD_URL"

echo "Storefront  $STOREFRONT_URL"
check "home page renders" "$(status -L "$STOREFRONT_URL/en")" 200
check "new arrivals render" "$(status -L "$STOREFRONT_URL/en/new")" 200
check "tracking params do not break the listing" "$(status -L "$STOREFRONT_URL/en/new?utm_source=smoke")" 200
check "revalidate endpoint rejects anonymous calls" "$(status -X POST -H 'Content-Type: application/json' -d '{"tags":["products"]}' "$STOREFRONT_URL/api/revalidate")" 401
check "revalidate endpoint allows the dashboard origin" "$(curl -s -o /dev/null -w '%header{access-control-allow-origin}' -X OPTIONS -H "Origin: $DASHBOARD_URL" -H 'Access-Control-Request-Method: POST' "$STOREFRONT_URL/api/revalidate")" "$DASHBOARD_URL"

echo "Dashboard  $DASHBOARD_URL"
check "dashboard loads" "$(status "$DASHBOARD_URL/")" 200
check "deep links are served by the SPA" "$(status "$DASHBOARD_URL/dashboard/products")" 200
# The API URL is inlined at build time into one of the code-split chunks, so every chunk the
# entry file references is scanned.
bundle_has_api=false
entry=$(curl -s "$DASHBOARD_URL/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
assets=$( { echo "$entry"; curl -s "$DASHBOARD_URL$entry" | grep -oE 'assets/[A-Za-z0-9_.-]+\.js' | sed 's#^#/#'; } | sort -u)
for asset in $assets; do
  if curl -s "$DASHBOARD_URL$asset" | grep -q "$API_URL"; then bundle_has_api=true; break; fi
done
check "dashboard build has the API URL baked in" "$bundle_has_api" true

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
