import { defineConfig, devices } from "@playwright/test";

const PORT = 8199;

// Chromium with iPad Pro profiles: screen size, touch and pixel ratio of an iPad. WebKit would be
// closer to Safari, but Playwright's build does not run on Fedora (see ADR 0012).
const ipad = (name: string) => ({
	...devices[name],
	defaultBrowserType: "chromium" as const,
});

export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	fullyParallel: true,
	reporter: "list",
	use: { baseURL: `http://localhost:${PORT}` },
	projects: [
		{ name: "ipad-portrait", use: ipad("iPad Pro 11") },
		{ name: "ipad-landscape", use: ipad("iPad Pro 11 landscape") },
		{ name: "ipad-mini", use: ipad("iPad Mini") },
	],
	// A throwaway server with its own empty database.
	webServer: {
		command: `npm run build --silent && cd ../server && DATA_DIR=$(mktemp -d) PORT=${PORT} STATIC_DIR=../web/dist go run ./cmd/server`,
		cwd: "..",
		url: `http://localhost:${PORT}/healthz`,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
