/** What the browser tells the server about an error (R-098); the server logs one line for it. */
export interface ErrorReport {
	message: string;
	source?: string;
	line?: number;
	col?: number;
	stack?: string;
	page: string;
	screen: string;
	release?: string;
}

interface Options {
	/** Where reports go; the default sends them to the server. Tests replace it. */
	send?: (report: ErrorReport) => void;
	/** The most different errors reported in one session (a loop must not flood the server). */
	max?: number;
	target?: Window;
}

const ENDPOINT = "/api/client-error";

/** Errors browsers raise on their own and that nobody can act on. */
function isNoise(message: string): boolean {
	return (
		message === "" ||
		message.startsWith("ResizeObserver loop") ||
		message === "Script error."
	);
}

function sendToServer(report: ErrorReport): void {
	const body = JSON.stringify(report);
	if (typeof navigator.sendBeacon === "function") {
		const blob = new Blob([body], { type: "application/json" });
		if (navigator.sendBeacon(ENDPOINT, blob)) return;
	}
	void fetch(ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		keepalive: true,
	}).catch(() => {});
}

/**
 * Reports uncaught errors and unhandled promise rejections to the server so they show up in the
 * logs (R-098). It adds no library, reports the same error once per session and at most `max`
 * different ones, ignores browser noise, and never throws. Returns a function that stops it.
 */
export function installErrorReporting(opts: Options = {}): () => void {
	const target = opts.target ?? window;
	const send = opts.send ?? sendToServer;
	const max = opts.max ?? 10;
	const seen = new Set<string>();

	const report = (
		message: string,
		source?: string,
		line?: number,
		col?: number,
		stack?: string,
	) => {
		try {
			if (isNoise(message)) return;
			const key = `${message}|${source ?? ""}|${line ?? 0}|${col ?? 0}`;
			if (seen.has(key) || seen.size >= max) return;
			seen.add(key);
			send({
				message,
				source,
				line,
				col,
				stack,
				page: location.pathname,
				screen: `${innerWidth}x${innerHeight}`,
				release: import.meta.env.VITE_RELEASE,
			});
		} catch {
			// reporting an error must never cause one
		}
	};

	const onError = (e: Event) => {
		const ev = e as ErrorEvent;
		const err = ev.error as Error | null | undefined;
		report(ev.message, ev.filename, ev.lineno, ev.colno, err?.stack);
	};
	const onRejection = (e: Event) => {
		const reason = (e as Event & { reason?: unknown }).reason;
		if (reason instanceof Error) {
			report(
				reason.message || reason.name,
				undefined,
				undefined,
				undefined,
				reason.stack,
			);
		} else {
			report(String(reason));
		}
	};
	target.addEventListener("error", onError);
	target.addEventListener("unhandledrejection", onRejection);
	return () => {
		target.removeEventListener("error", onError);
		target.removeEventListener("unhandledrejection", onRejection);
	};
}
