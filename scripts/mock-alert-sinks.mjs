// Local stand-in for alert destinations (never used in production): a webhook at /webhook and the
// Resend email API at /emails. Run: npm run mock:alerts; in Settings › Alerts use the webhook URL
// http://host.docker.internal:54997/webhook/<anything>, and set RESEND_API_URL=http://host.docker.internal:54997/emails
// in the functions env file. GET /__state shows what arrived; POST /__fail {on: true} answers 500.
import http from "node:http";

const PORT = Number(process.argv[2] ?? 54997);
const webhooks = [];
const emails = [];
let failing = false;

const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const body = data ? JSON.parse(data) : {};
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/__state") return send(res, 200, { failing, webhooks, emails });
      if (req.method === "POST" && path === "/__fail") {
        failing = body.on !== false;
        return send(res, 200, { failing });
      }
      if (failing) return send(res, 500, { error: "Mock sink failing" });
      if (req.method === "POST" && path.startsWith("/webhook")) {
        webhooks.push(body);
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && path === "/emails") {
        if (!/^Bearer \S+/.test(req.headers.authorization ?? "")) return send(res, 401, { error: "Missing API key" });
        emails.push(body);
        return send(res, 200, { id: `email-${emails.length}` });
      }
      return send(res, 404, { error: `No route ${req.method} ${path}` });
    });
  })
  .listen(PORT, () => console.log(`Mock alert sinks on http://localhost:${PORT}`));
