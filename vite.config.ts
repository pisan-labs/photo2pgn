import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [react()];
  // The local /api server is only for `npm run dev`; Netlify serves it in production.
  if (command === "serve") {
    const { devApi } = await import("./dev/devApi");
    plugins.push(devApi());
  }
  return {
    plugins,
    build: { sourcemap: true },
  };
});
