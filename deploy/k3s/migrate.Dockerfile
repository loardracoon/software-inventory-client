# Migration runner for the Argo CD PreSync Job. Build from the repo root:
#   docker build -f deploy/k3s/migrate.Dockerfile -t <image> .
FROM postgres:17-alpine
COPY supabase/migrations /migrations
COPY deploy/k3s/migrate.sh /usr/local/bin/migrate
RUN chmod 0755 /usr/local/bin/migrate
USER postgres
ENTRYPOINT ["/usr/local/bin/migrate"]
