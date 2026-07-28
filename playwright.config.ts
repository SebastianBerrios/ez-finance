// Playwright configuration.
//
// THE ENV BLOCK BELOW IS A SAFETY DEVICE, NOT CONVENIENCE. `pnpm start` reads
// .env.local, and what that file points at is a CONVENTION, not a guarantee —
// it has pointed at the SHARED hosted mvp-lab project before, which is one
// auth.users pool for every app in the fleet. tests/e2e/account-lifecycle.spec
// and tests/e2e/password-recovery.spec register users, erase them and write
// deletion-request rows, and their SQL helpers reach into the LOCAL docker
// container. If the browser drove an app wired to the hosted project, they
// would create real accounts there and clean up nothing.
//
// So the server under test is pinned to whatever the CLI reports as the local
// stack, and it is never reused: an already-running `pnpm dev` is a process
// whose credentials this config cannot vouch for. The gated specs additionally
// prove — with psql — that the row they just created is in the local container.
import { execFileSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

/** Somewhere nothing is listening — a stack-less run must not fall back to .env.local. */
const UNREACHABLE_URL = "http://127.0.0.1:1";

interface LocalStack {
  url: string;
  publishableKey: string;
  /** Where the local stack captures outgoing mail. Empty when unavailable. */
  mailpitUrl: string;
}

function probeLocalStack(): LocalStack | null {
  try {
    const raw = execFileSync(
      "pnpm",
      ["exec", "supabase", "status", "-o", "json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: true,
        timeout: 120_000,
        env: {
          ...process.env,
          // The CLI refuses to read config.toml without these.
          SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: "dummy",
          SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: "dummy",
        },
      },
    );

    // The CLI prints a "Stopped services: [...]" line before the JSON.
    const status = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<
      string,
      string
    >;
    const url = status["API_URL"];
    const publishableKey = status["PUBLISHABLE_KEY"] ?? status["ANON_KEY"];
    // Older CLIs called it Inbucket. password-recovery.spec skips without it.
    const mailpitUrl = status["MAILPIT_URL"] ?? status["INBUCKET_URL"] ?? "";

    if (!url || !publishableKey) return null;
    return { url, publishableKey, mailpitUrl };
  } catch {
    // No stack, no CLI, no docker. The gated specs skip themselves.
    return null;
  }
}

/**
 * Resolved once in the main process and cached in the environment, which the
 * test workers inherit — they re-import this config and would otherwise each
 * pay for another CLI round trip.
 */
function localStack(): LocalStack | null {
  const cachedUrl = process.env["E2E_SUPABASE_URL"];

  if (cachedUrl !== undefined) {
    return cachedUrl === ""
      ? null
      : {
          url: cachedUrl,
          publishableKey: process.env["E2E_SUPABASE_KEY"] ?? "",
          mailpitUrl: process.env["E2E_MAILPIT_URL"] ?? "",
        };
  }

  const stack = probeLocalStack();
  process.env["E2E_SUPABASE_URL"] = stack?.url ?? "";
  process.env["E2E_SUPABASE_KEY"] = stack?.publishableKey ?? "";
  process.env["E2E_MAILPIT_URL"] = stack?.mailpitUrl ?? "";
  return stack;
}

const stack = localStack();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  ...(process.env["CI"] ? { workers: 1 as const } : {}),
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 5"],
      },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    // NEVER reuse. A server this config did not start is a server whose
    // Supabase credentials it cannot vouch for.
    reuseExistingServer: false,
    timeout: 300_000,
    // Real process env beats .env files in Next.js (@next/env leaves anything
    // already defined alone), so these win over .env.local at build AND at run.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: stack?.url ?? UNREACHABLE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        stack?.publishableKey ?? "no-local-stack",
    },
  },
});
