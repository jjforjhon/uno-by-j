import path from "node:path";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import {
  defineWorkersProject,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

  const unit: ViteUserConfig = {
    test: {
      name: "unit",
      include: ["test/unit/**/*.test.ts"],
    },
  };

  const integration = defineWorkersProject({
    test: {
      name: "integration",
      include: ["test/integration/**/*.test.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            d1Databases: ["DB"],
            bindings: {
              TEST_MIGRATIONS: migrations,
              JWT_SECRET: "integration-test-secret-0123456789",
            },
          },
        },
      },
    },
  });

  return { test: { globals: true, projects: [unit, integration] } };
});
