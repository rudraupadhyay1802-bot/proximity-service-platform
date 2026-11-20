# ============================================================
# Multi-stage Dockerfile for MapLibre Client
# Stage 1: Build / Lint / Verification
# Stage 2: Minimal Production Runtime (nginx:alpine)
# ============================================================

# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
# Verify assets exist
RUN test -f index.html && test -f app.js && test -f style.css

# Stage 2: Production Runtime
FROM nginx:1.27-alpine
LABEL maintainer="WebGIS Student Project"

# Remove default nginx html
RUN rm -rf /usr/share/nginx/html/*

# Copy custom nginx configuration for HTTP byte-ranges
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static map client and data from builder stage
COPY --from=builder /app /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
