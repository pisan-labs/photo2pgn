import { defineConfig } from "@playwright/test";

// The walkthrough runs against `vite preview` built without Supabase env, so
// sign-in is off and nothing touches the network: Anthropic is faked in-page.
export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  use: { baseURL: "http://localhost:4173", trace: "off" },
  webServer: {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" },
  },
});
