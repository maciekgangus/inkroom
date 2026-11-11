import { useEffect, useRef } from "preact/hooks";

/** The part of Cloudflare's Turnstile script this app uses. */
interface TurnstileApi {
	render(
		el: HTMLElement,
		options: {
			sitekey: string;
			callback: (token: string) => void;
			"expired-callback"?: () => void;
			"error-callback"?: () => void;
		},
	): string;
	reset(widgetId?: string): void;
	remove(widgetId: string): void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

const SCRIPT =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once and resolves with its API. */
function loadTurnstile(): Promise<TurnstileApi> {
	if (window.turnstile) return Promise.resolve(window.turnstile);
	loading ??= new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = SCRIPT;
		script.async = true;
		script.onload = () =>
			window.turnstile
				? resolve(window.turnstile)
				: reject(new Error("no widget"));
		script.onerror = () => {
			loading = null;
			reject(new Error("Nie udało się wczytać captchy"));
		};
		document.head.append(script);
	});
	return loading;
}

interface Props {
	siteKey: string;
	/** Called with a fresh token when the challenge is solved, and with "" when it expires or fails. */
	onToken: (token: string) => void;
	/** Raising it starts the widget over: a token is good for one registration only. */
	attempt?: number;
}

/** The Cloudflare Turnstile captcha widget (R-054). */
export function Captcha({ siteKey, onToken, attempt = 0 }: Props) {
	const box = useRef<HTMLDivElement>(null);
	const id = useRef<string | null>(null);
	const api = useRef<TurnstileApi | null>(null);
	const onTokenRef = useRef(onToken);
	onTokenRef.current = onToken;

	useEffect(() => {
		let gone = false;
		loadTurnstile().then(
			(t) => {
				if (gone || !box.current) return;
				api.current = t;
				id.current = t.render(box.current, {
					sitekey: siteKey,
					callback: (token) => onTokenRef.current(token),
					"expired-callback": () => onTokenRef.current(""),
					"error-callback": () => onTokenRef.current(""),
				});
			},
			() => onTokenRef.current(""),
		);
		return () => {
			gone = true;
			if (id.current && api.current) api.current.remove(id.current);
			id.current = null;
		};
	}, [siteKey]);

	const first = useRef(true);
	useEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		if (id.current) api.current?.reset(id.current);
	}, [attempt]);

	return <div ref={box} class="captcha" />;
}
