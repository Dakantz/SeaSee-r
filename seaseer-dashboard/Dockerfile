# Frontend container with Node.js & Nginx for in-container client generation and SPA serving
FROM node:22-alpine

# Install Nginx and wget
RUN apk add --no-cache nginx wget

WORKDIR /app

# Copy package manifests and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy full frontend source code (src/client is excluded via .dockerignore)
COPY . .

# Copy Nginx SPA reverse proxy configuration
RUN mkdir -p /etc/nginx/http.d /run/nginx /usr/share/nginx/html && rm -rf /etc/nginx/conf.d
COPY nginx.conf /etc/nginx/http.d/default.conf

# Environment variables for API, TUSD, and OpenAPI schema resolution
ENV VITE_API_URL=""
ENV VITE_TUS_URL=""
ENV OPENAPI_INPUT="http://backend:8000/openapi.json"

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]

