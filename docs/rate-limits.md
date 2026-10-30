# Rate limits and abuse protection

These limits protect Endpoint Inventory against too many requests (denial of service) and against guessing of sign-in
links. All the values are in **one file for each deployment**:

- `deploy/compose/rate-limits.env` (one host, Docker Compose)
- `deploy/k3s/app/rate-limits.env` (K3S)

Each variable is explained below, with the recommended number. The recommended numbers are for **a team of up to
about 50 users behind one office address**. The image has the same numbers as defaults, so the system is protected
even when the file is missing (the exception is `GOTRUE_RATE_LIMIT_HEADER`, see Auth).

## How to change a value

- **One host:** edit `deploy/compose/rate-limits.env`, then run `docker compose up -d` (`./update.sh` does it too).
- **K3S:** edit `deploy/k3s/app/rate-limits.env` and push to `main`. Kustomize makes the ConfigMap `rate-limits` from the file. The ConfigMap name contains a hash of the content, so Argo CD restarts the gateway, Auth and the Edge Functions by itself.

After a change, test the limits ([How to check](#how-to-check)).

## How the limits work

There are three layers. A request must pass all of them.

1. **Gateway** (nginx, in the web image). It sees every request from outside. It limits the requests **per client
   address**, the open connections, the size of the body and the time a slow client can take. A request over the
   limit gets **HTTP 429** (or 413 for a body that is too large). The gateway does not limit the calls between
   internal services (Edge Functions to the database API and to Auth, database jobs to Edge Functions). Those calls
   have no `X-Forwarded-For` header. Never add that header to an internal call.
2. **Auth** (GoTrue). It limits sign-in, code checks, session refresh and emails. Its per-address limits use the
   `X-Real-IP` header that the gateway sets.
3. **Edge Functions**. They limit what an admin can send (invitations).

The client address comes from `X-Forwarded-For`. The gateway trusts that header **only from private networks**
(the proxy in front of it: Caddy, Traefik or the `tls` container). A client cannot choose its own address.

## Gateway: rate and burst

The variables `RL_*_RATE` and `RL_*_BURST` come in pairs.

- **Rate** (`10r/m` means 10 requests each minute, `30r/s` means 30 requests each second): the speed that one
  address can keep for a long time.
- **Burst**: the number of requests above that speed that the gateway accepts at once, before it starts to answer
  429. A web page sends many requests together, so the burst must be large enough for one page load.

With `RL_REST_RATE=30r/s` and `RL_REST_BURST=120`, one address can send 120 requests at once, and then 30 each
second. Each address has its own counter.

| Variable | Recommended | Applies to | When to change it |
| --- | --- | --- | --- |
| `RL_AUTH_STRICT_RATE` | `10r/m` | `/auth/v1/otp`, `magiclink`, `signup`, `recover`, `resend`, `verify`: the requests that send a sign-in link or check a code | Raise it if many people sign in together from one address (for example, a team that starts work at the same time). Lower it if the app is open to the internet |
| `RL_AUTH_STRICT_BURST` | `10` | The same paths | Keep it near the number of people that can sign in at the same time from one address |
| `RL_AUTH_RATE` | `120r/m` | Other Auth calls (session refresh, user) and the `/mail/` page of Mailpit | Raise it if users see sign-out errors on a busy network |
| `RL_AUTH_BURST` | `60` | The same paths | The Mailpit page loads several files at once: keep at least `30` |
| `RL_REST_RATE` | `30r/s` | `/rest/v1/`: the database API that every screen uses | Raise it for a big office behind one address. A screen sends 10 to 30 requests at once |
| `RL_REST_BURST` | `120` | The same path | Keep it at least 4 times the number of users that open a page together |
| `RL_FUNCTIONS_RATE` | `10r/s` | `/functions/v1/`: Edge Functions: Sync now, Scan now, exports, policy evaluation | Raise it if scripts call the functions often. Calls from the database jobs do not count |
| `RL_FUNCTIONS_BURST` | `60` | The same path | Keep it large enough for a CSV export or a sync that makes several calls |

## Gateway: connections and size

| Variable | Recommended | What it does | When to change it |
| --- | --- | --- | --- |
| `RL_CONN_PER_IP` | `60` | The number of open connections from one address. It stops an address that opens thousands of connections | Raise it for a big office. A browser uses 6 to 10 connections for each tab |
| `RL_BODY_AUTH` | `64k` | The largest request body for the Auth paths. Above it: HTTP 413 | Keep it small. Sign-in bodies are less than 1 KB |
| `RL_BODY_REST` | `2m` | The largest body for the database API | Raise it only if a screen saves large data |
| `RL_BODY_FUNCTIONS` | `10m` | The largest body for the Edge Functions | Raise it only if you import a very large policy file |

Values use `k` (kilobyte) and `m` (megabyte). The gateway also sets fixed timeouts against slow clients:
15 seconds for the request header, 30 seconds for the body, and 30 seconds for an idle connection.

## Auth (GoTrue)

| Variable | Recommended | What it does | When to change it |
| --- | --- | --- | --- |
| `GOTRUE_RATE_LIMIT_HEADER` | `X-Real-IP` | The header that carries the client address. **Without it, GoTrue applies none of its per-address limits** (verified in the GoTrue source: it does no limiting when this value is empty) | Do not change it. The gateway sets `X-Real-IP` |
| `GOTRUE_RATE_LIMIT_OTP` | `10` | Sign-in and sign-up requests for one address in 5 minutes | Same reasons as `RL_AUTH_STRICT_RATE` |
| `GOTRUE_RATE_LIMIT_VERIFY` | `15` | Magic link and code checks for one address in 5 minutes | A user who clicks a link more than once uses more than one check |
| `GOTRUE_RATE_LIMIT_TOKEN_REFRESH` | `60` | Session refreshes for one address in 5 minutes. A browser refreshes about once an hour for each tab | Raise it for a big office |
| `GOTRUE_RATE_LIMIT_EMAIL_SENT` | `60` | Emails that Auth sends in **one hour for the whole app** (sign-in links and invitations). It is not per address | Raise it only if you have many users. Without a limit, an attacker can send many emails to your SMTP server |

### Invitations: `RL_INVITES_PER_HOUR`

- **What it does:** the function `manage-users` (Settings › Users and access) counts the invitations and sign-in links that **one admin** sends. Above the limit, it answers HTTP 429 with a message. The count comes from the audit log.
- **Unit:** emails for each admin in one hour. **Recommended:** `20`. **Default** when the variable is missing: `20`.
- **Raise it** only for a large onboarding. **Lower it** if you do not trust all the admins.

## Limits that are not in this file

These limits exist in the code and do not need a variable:

- The Sophos API budget for each tenant: 10 runs each minute and 1,000 runs each day, with a reserve for retries (Scans › API budget).
- A Hub sync that fails waits longer after each failure (5 minutes up to 6 hours).
- Calls to Sophos and to the Hub are repeated with a delay when the answer is 429 or 5xx (`_shared/http.ts`).

Local development (`supabase start`) uses the Supabase CLI gateway and `[auth.rate_limit]` in `supabase/config.toml`, not this file.

## How to check

1. **Check the client address.** Read the gateway log: `docker compose logs kong` (one host) or `kubectl -n inventory logs deploy/gateway` (K3S). It must show the **real public addresses** of your users. If every request shows one internal address, all users share one counter: fix the address first (a proxy in front that sends `X-Forwarded-For`, and no address translation before the gateway), or raise the values.
2. **See a limit work.** Send many requests quickly and look for HTTP 429. For example: `for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code} " -X POST https://<host>/auth/v1/otp; done`. The first requests pass and the last ones get 429. The log has the line `limiting requests`.
3. **A real user is blocked?** Look at the log for `limiting requests` with the address of the user. Raise the matching rate and burst, apply the change, and tell the user to wait one minute.

## Recommended numbers for other sizes

| Situation | Change |
| --- | --- |
| Lab or one user | The recommended numbers are fine. You may lower `RL_AUTH_STRICT_RATE` to `5r/m` |
| One office of 50 to 200 users behind one address | `RL_AUTH_STRICT_RATE=30r/m`, `RL_AUTH_STRICT_BURST=30`, `RL_REST_RATE=100r/s`, `RL_REST_BURST=400`, `RL_CONN_PER_IP=200`, `GOTRUE_RATE_LIMIT_OTP=30`, `GOTRUE_RATE_LIMIT_VERIFY=45`, `GOTRUE_RATE_LIMIT_TOKEN_REFRESH=200` |
| Open to the internet, few users | Lower `RL_AUTH_STRICT_RATE` to `5r/m`, `GOTRUE_RATE_LIMIT_EMAIL_SENT` to `20` and `RL_INVITES_PER_HOUR` to `10` |

Back to the [README](../README.md) or the [docs/operations.md](operations.md).
