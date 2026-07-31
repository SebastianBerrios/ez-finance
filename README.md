# ez finance

Finanzas personales y compartidas 50/30/20

## Dev Setup

Development runs against a **local** Supabase stack in Docker. Nothing here
touches the shared hosted project — see [Environments](#environments).

```bash
pnpm install
pnpm exec playwright install chromium

pnpm exec supabase start          # needs Docker running
cp .env.example .env.local        # then fill it from the values `supabase start` printed
pnpm dev                          # http://localhost:3000
```

`supabase start` prints `API_URL`, `PUBLISHABLE_KEY` and `SERVICE_ROLE_KEY`; those
are what `.env.local` needs. Re-print them any time with `supabase status`.

> **The variable is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.** Supabase's dashboard
> "Connect" snippet emits `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead. Pasting it
> verbatim leaves the app unable to boot, and the error names the missing variable
> without hinting that the _name_ is what is wrong.

Mail sent by the app (signup confirmation, password recovery, email change) is
captured locally at **http://127.0.0.1:54334** — nothing leaves your machine.

### Environments

| File                | Points at                                                       | Loaded by                          |
| ------------------- | --------------------------------------------------------------- | ---------------------------------- |
| `.env.local`        | local stack                                                     | `dev`, `build`, `start`            |
| `.env.remote.local` | shared hosted `mvp-lab`                                         | `dev:remote` / `start:remote` only |
| `.env`              | _not the app_ — Supabase CLI reads it for `config.toml` `env()` | `supabase start`                   |

`.env.remote.local` does not exist by default and Next never auto-loads it
(`remote` is not a `NODE_ENV`), so reaching the shared project is always a
deliberate act. `dev:remote` fails loudly if the file is missing rather than
silently falling back to local.

Why it matters: `mvp-lab` is **one** Postgres and **one** `auth.users` pool shared
with the other demo apps in the fleet. See `../mvp-lab-infra/OPERATIONS.md`.

## Tests

```bash
pnpm test                 # unit + component. No stack needed.
pnpm test:integration     # needs the local stack; skips silently without it
pnpm test:e2e             # needs the local stack; starts its own server
```

The e2e suite pins the app under test to whatever the CLI reports as the local
stack and never reuses a server you started, so a stray `pnpm dev` pointed
somewhere else cannot corrupt a run.

## Before the first deploy

Three things are configured OUTSIDE this repo, and each one fails silently if
skipped — no build error, no runtime error, just users stuck. Do them in order.

**1. Custom SMTP on the hosted project.** Blocking. Email confirmation is
required (`enable_confirmations`, see `supabase/config.toml` for why), and until
custom SMTP is configured Supabase Auth _"will refuse to deliver messages to
addresses that are not part of the project's team"_. Every outside signup stalls
at "check your inbox" with no inbox. Password recovery and email change go the
same way — they mail unconditionally, so without SMTP they silently do nothing.
Configure under **Authentication → Emails → SMTP Settings**; afterwards the
default auth-email limit is 30 new users/hour, tunable under
**Auth → Rate Limits**.

> **Pick a provider that verifies a single SENDER, not a whole domain**, unless
> you own a domain. Resend requires a verified domain — its `resend.dev` fallback
> only delivers to your own account address, which is the same dead end as having
> no SMTP at all. Brevo's free tier verifies one address (300/day) and SendGrid's
> does too (100/day). Without domain authentication expect some mail to land in
> spam: fine for a demo, not for real customers — which is the point at which the
> app should be graduating to its own project anyway.

**2. The deployment URL in the redirect allow-list.** Every auth email is built
from the _request_ origin, because the shared project's Site URL belongs to no app
in particular. An origin missing from the allow-list is not rejected — Supabase
substitutes the Site URL and mails that. Add under
**Authentication → URL Configuration → Redirect URLs**:

```
https://<project>.vercel.app/**
https://<project>-*.vercel.app/**    # previews; without this every preview breaks
http://localhost:3000/**
```

**3. `enable_confirmations` on the hosted project.** `supabase/config.toml`
governs the local stack only. Set the hosted value to match under
**Authentication → Providers → Email**; left off, the register form leaks which
addresses are already taken.

### Verifying

**None of the three has an automated check**, because all three are dashboard
state and `tests/e2e/auth-email-redirects.spec.ts` runs against the local stack —
it proves the _code_ passes a correct redirect, not that the hosted project
accepts it. Verify by hand on the first deployment:

| Step | How you know it worked                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | A signup from an address outside the org receives the mail at all                                                                                   |
| 2    | That mail's link contains `redirect_to=https://<your-deployment>/...` — if it shows the Site URL instead, the origin is missing from the allow-list |
| 3    | Registering an address that already exists says the same thing as a fresh one                                                                       |

Step 2 is the one worth being careful about: a wrong allow-list produces a
perfectly deliverable email that sends your user to a different app.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- `../mvp-lab-infra/OPERATIONS.md` — the shared-fleet contract: migrations,
  auth-is-not-membership, graduation.
