# Production front end + gateway. Build from the repo root:
#   docker build -f deploy/k3s/web.Dockerfile --build-arg VITE_SUPABASE_URL=https://<host> \
#     --build-arg VITE_SUPABASE_ANON_KEY=<anon key> -t <image> .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN rm -f .env .env.local .env.*.local
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# The gateway is a template: the image's entrypoint writes /etc/nginx/conf.d/default.conf from it with the RL_*
# variables below (defaults; the deployment overrides them from rate-limits.env, README › Rate limits).
COPY deploy/k3s/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=^RL_ \
    RL_AUTH_STRICT_RATE=10r/m RL_AUTH_STRICT_BURST=10 \
    RL_AUTH_RATE=120r/m RL_AUTH_BURST=60 \
    RL_REST_RATE=30r/s RL_REST_BURST=120 \
    RL_FUNCTIONS_RATE=10r/s RL_FUNCTIONS_BURST=60 \
    RL_CONN_PER_IP=60 \
    RL_BODY_AUTH=64k RL_BODY_REST=2m RL_BODY_FUNCTIONS=10m
COPY --chmod=0755 deploy/k3s/env-js.sh /docker-entrypoint.d/40-env-js.sh
EXPOSE 8000
