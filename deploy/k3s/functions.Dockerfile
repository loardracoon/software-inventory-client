# Edge Functions image. Build from the repo root:
#   docker build -f deploy/k3s/functions.Dockerfile -t <image> .
# supabase/functions/.env is excluded by .dockerignore (and absent in CI, where it is never committed).
FROM public.ecr.aws/supabase/edge-runtime:v1.77.8
COPY supabase/functions /home/deno/functions
COPY deploy/k3s/functions/main /home/deno/functions/main
RUN find /home/deno/functions -name '*.test.ts' -delete
EXPOSE 9000
CMD ["start", "--main-service", "/home/deno/functions/main"]
