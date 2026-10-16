FROM node:24-bookworm
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm rebuild esbuild workerd && npm run build:cloudflare
ENV WRANGLER_SEND_METRICS=false
ENV WRANGLER_LOG_PATH=/app/.wrangler/logs
EXPOSE 8787
CMD ["npx", "wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787", "--persist-to", "/app/.wrangler/state"]
