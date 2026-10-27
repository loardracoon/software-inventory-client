# syntax=docker/dockerfile:1

# Front end only. The backend (Postgres, Auth, PostgREST, Edge Functions, Studio)
# runs as the Supabase local stack started by `npm run db:start`.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the Supabase CLI binary download; the CLI runs on the host.
RUN npm ci --ignore-scripts --no-audit --no-fund

# Dev server with hot reload; the source is bind-mounted by docker-compose.yml.
FROM deps AS dev
ENV VITE_USE_POLLING=true
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM deps AS build
# VITE_* values are baked into the bundle at build time. Anon key only.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
COPY . .
RUN npm run build

# Static build served by nginx, for a production-like local check.
FROM nginx:1.29-alpine AS prod
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
