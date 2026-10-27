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
COPY deploy/k3s/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 deploy/k3s/env-js.sh /docker-entrypoint.d/40-env-js.sh
EXPOSE 8000
