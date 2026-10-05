#!/bin/sh
set -e

echo "==> SeaSee-r Frontend Container Starting..."

OPENAPI_URL="${OPENAPI_INPUT:-http://backend:8000/openapi.json}"
echo "==> Checking backend OpenAPI specification at: $OPENAPI_URL"

# Wait for backend OpenAPI endpoint to be accessible (retry up to 30 times, 2s interval)
RETRIES=30
until wget -q --spider "$OPENAPI_URL" || [ $RETRIES -eq 0 ]; do
  echo "==> Waiting for backend OpenAPI ($OPENAPI_URL)... ($RETRIES retries remaining)"
  RETRIES=$((RETRIES - 1))
  sleep 2
done

if [ $RETRIES -eq 0 ]; then
  echo "==> ERROR: Backend OpenAPI endpoint ($OPENAPI_URL) could not be reached."
  exit 1
fi

echo "==> Generating OpenAPI client files..."
npm run generate-client

echo "==> Building Vite production bundle..."
npm run build

echo "==> Preparing Nginx web root..."
mkdir -p /usr/share/nginx/html
rm -rf /usr/share/nginx/html/*
cp -r /app/dist/* /usr/share/nginx/html/

echo "==> Starting Nginx server..."
exec nginx -g "daemon off;"
