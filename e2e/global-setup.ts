import { chromium, type FullConfig } from "@playwright/test";

// Signs in once with a magic link read from Mailpit and saves the browser session for the tests.
// The stack's site_url must be the app under test, so the link lands there.
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:55321";
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:55324";
const EMAIL = process.env.E2E_EMAIL ?? "admin.screens@example.com";
// The Supabase CLI's local demo anon key (public; the same on every local stack).
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

type MailpitList = { messages: { ID: string; To: { Address: string }[]; Created: string }[] };

async function magicLink(): Promise<string> {
  const requestedAt = Date.now();
  const otp = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, create_user: false }),
  });
  if (!otp.ok) throw new Error(`Magic link request failed: HTTP ${otp.status} ${await otp.text()}`);

  for (let i = 0; i < 20; i++) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as MailpitList;
    const message = list.messages.find((m) => m.To.some((t) => t.Address === EMAIL) && Date.parse(m.Created) >= requestedAt - 2000);
    if (message) {
      const { Text } = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json()) as { Text: string };
      const link = Text.match(/https?:\/\/\S+verify\S+/)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No magic link for ${EMAIL} in Mailpit (${MAILPIT_URL})`);
}

export default async function globalSetup(config: FullConfig) {
  const { baseURL, storageState } = config.projects[0].use;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto(await magicLink());
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor({ timeout: 15_000 });
  await page.context().storageState({ path: storageState as string });
  await browser.close();
}
