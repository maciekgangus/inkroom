import { defineConfig, devices } from "@playwright/test";

const PORT = 8199;
// E2E_ENGINE=webkit runs the same tests in WebKit (inside the Playwright container, see
// e2e/webkit.sh) against a server started on the host; the default is Chromium with a server of
// its own.
const engine = process.env.E2E_ENGINE === "webkit" ? "webkit" : "chromium";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// iPad profiles: screen size, touch and pixel ratio of an iPad (their user agent is Safari's, so
// Chromium gets a Chromium one).
const ipad = (name: string) => ({
	...devices[name],
	defaultBrowserType: engine,
	...(engine === "chromium"
		? { userAgent: devices["Desktop Chrome"].userAgent }
		: {}),
});

export default defineConfig({
	testDir: ".",
	testMatch: "*.spec.ts",
	fullyParallel: true,
	reporter: "list",
	use: { baseURL },
	projects: [
		{ name: "ipad-portrait", use: ipad("iPad Pro 11") },
		{ name: "ipad-landscape", use: ipad("iPad Pro 11 landscape") },
		{ name: "ipad-mini", use: ipad("iPad Mini") },
	],
	// A throwaway server with its own empty database (WebKit's run uses the one the script started).
	webServer: process.env.E2E_BASE_URL
		? undefined
		: {
				command: `npm run build --silent && cd ../server && DATA_DIR=$(mktemp -d) PORT=${PORT} STATIC_DIR=../web/dist go run ./cmd/server`,
				cwd: "..",
				url: `http://localhost:${PORT}/healthz`,
				reuseExistingServer: false,
				timeout: 120_000,
			},
});
