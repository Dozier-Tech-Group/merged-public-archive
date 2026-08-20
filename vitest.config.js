import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/fleet-board.test.js"],
    exclude: ["test/contracts/**", "node_modules/**"],
  },
});
