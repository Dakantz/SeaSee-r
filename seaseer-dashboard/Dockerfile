# Stage 1: Build the React/Vite application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy full frontend source code
COPY . .

# Build arguments for API & TUSD endpoints (defaults to relative paths for Nginx reverse-proxy)
ARG VITE_API_URL=/api/
ARG VITE_TUS_URL=/files/
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_TUS_URL=${VITE_TUS_URL}

# Run production build
RUN npm run build

# Stage 2: Serve static bundle via Nginx
FROM nginx:alpine

# Copy Nginx SPA reverse proxy configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
