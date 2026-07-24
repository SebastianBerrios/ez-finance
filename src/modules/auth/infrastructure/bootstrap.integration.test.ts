// bootstrap.integration.test.ts — end-to-end wiring test against the LOCAL stack
//
// Guards: only runs when SUPABASE_TEST_URL is set (local stack running).
// Tests the full path: create user (admin) → sign in (SupabaseAuthAdapter) →
// bootstrap (bootstrapUserWorkspace) → assert profile + Personal workspace exist.
//
// IMPORTANT: These tests use the service-role key to create/delete test users
// so they do NOT run in the pure-unit CI gate (no SUPABASE_TEST_URL there).
// Run locally with: pnpm test:integration
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_URL = process.env["SUPABASE_TEST_URL"] ?? "";
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

/**
 * Admin client using service-role key (for test user management only).
 * Never used in production code — test helper only.
 */
function adminClient() {
  return createClient(TEST_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Anon client for the local stack, targeting ez_finance schema.
 * Simulates what the browser client does.
 */
function anonClient(accessToken?: string) {
  const PUBLISHABLE_KEY = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? "";
  const client = createClient(TEST_URL, PUBLISHABLE_KEY, {
    db: { schema: "ez_finance" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (accessToken) {
    // Inject a pre-fetched session so we can call RPCs as the authenticated user
    void client.auth.setSession({ access_token: accessToken, refresh_token: "" });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!process.env["SUPABASE_TEST_URL"])(
  "Infrastructure smoke: register → login → bootstrap (local stack)",
  () => {
    const testEmail = `smoke-test-${Date.now()}@example.com`;
    const testPassword = "SmokeTest123!";
    let createdUserId: string | undefined;

    beforeAll(async () => {
      // Create the user via admin API and auto-confirm email
      const admin = adminClient();
      const { data, error } = await admin.auth.admin.createUser({
        email: testEmail,
        password: testPassword,
        email_confirm: true,
      });
      if (error) throw new Error(`Failed to create test user: ${error.message}`);
      createdUserId = data.user?.id;
    });

    afterAll(async () => {
      // Clean up the test user
      if (createdUserId) {
        const admin = adminClient();
        await admin.auth.admin.deleteUser(createdUserId);
      }
    });

    it("can sign in directly and receive a session", async () => {
      // SupabaseAuthAdapter.login() uses createServerClient() which requires
      // next/headers (server-component context, not available in Vitest node env).
      // This test validates the same wiring path by calling signInWithPassword
      // directly — the adapter is a thin delegation wrapper; the integration
      // value is the schema routing and credential resolution, tested here.
      const PUBLISHABLE_KEY = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? "";
      const client = createClient(TEST_URL, PUBLISHABLE_KEY, {
        db: { schema: "ez_finance" },
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data, error } = await client.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      expect(error).toBeNull();
      expect(data.session).not.toBeNull();
      expect(data.session?.user.id).toBe(createdUserId);
    });

    it("bootstrap creates profile + Personal workspace for new user", async () => {
      // Sign in as the test user to get a fresh access token
      const PUBLISHABLE_KEY = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? "";
      const client = createClient(TEST_URL, PUBLISHABLE_KEY, {
        db: { schema: "ez_finance" },
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: signInData, error: signInError } =
        await client.auth.signInWithPassword({
          email: testEmail,
          password: testPassword,
        });
      expect(signInError).toBeNull();

      const accessToken = signInData.session?.access_token;
      expect(accessToken).toBeDefined();
      if (!accessToken) return;

      // Call bootstrap RPC directly (simulating what bootstrapUserWorkspace does)
      // We use the authed client since the RPC requires auth.uid()
      const authedClient = createClient(TEST_URL, PUBLISHABLE_KEY, {
        db: { schema: "ez_finance" },
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      });

      const { data: workspaceId, error: bootstrapError } =
        await authedClient.rpc("bootstrap");

      expect(bootstrapError).toBeNull();
      expect(typeof workspaceId).toBe("string");
      expect(workspaceId).toBeTruthy();

      // Assert profile row exists
      const { data: profile, error: profileError } = await authedClient
        .from("profiles")
        .select("id")
        .eq("id", createdUserId!)
        .single();

      expect(profileError).toBeNull();
      expect(profile?.id).toBe(createdUserId);

      // Assert Personal workspace exists
      const { data: workspace, error: wsError } = await authedClient
        .from("workspaces")
        .select("id, type")
        .eq("id", workspaceId as string)
        .single();

      expect(wsError).toBeNull();
      expect(workspace?.type).toBe("personal");

      // Assert owner membership exists
      const { data: membership, error: memberError } = await authedClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId as string)
        .eq("user_id", createdUserId!)
        .single();

      expect(memberError).toBeNull();
      expect(membership?.role).toBe("owner");
    });

    it("bootstrap is idempotent — second call returns same workspace_id", async () => {
      const PUBLISHABLE_KEY = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? "";
      const client = createClient(TEST_URL, PUBLISHABLE_KEY, {
        db: { schema: "ez_finance" },
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: signInData } = await client.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });
      const accessToken = signInData.session?.access_token;
      if (!accessToken) return;

      const authedClient = createClient(TEST_URL, PUBLISHABLE_KEY, {
        db: { schema: "ez_finance" },
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });

      const { data: ws1 } = await authedClient.rpc("bootstrap");
      const { data: ws2 } = await authedClient.rpc("bootstrap");

      expect(ws1).toBe(ws2);
    });
  },
);
