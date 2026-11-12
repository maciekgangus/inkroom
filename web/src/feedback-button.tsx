import { useEffect, useRef, useState } from "preact/hooks";
import { sendFeedback } from "./api";
import { Icon } from "./icon";

/**
 * The feedback button (R-062): an exclamation mark that opens a small form for a note. The note
 * goes to the server with the page and the size of the screen; who sent it is worked out there.
 */
export function FeedbackButton({ thanksMs = 7000 }: { thanksMs?: number }) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [thanks, setThanks] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	const close = () => {
		setOpen(false);
		setError("");
	};
	const submit = async (e: Event) => {
		e.preventDefault();
		if (!text.trim() || busy) return;
		setBusy(true);
		setError("");
		try {
			await sendFeedback({
				message: text.trim(),
				page: location.pathname,
				screen: `${innerWidth}x${innerHeight}`,
			});
			setText("");
			setOpen(false);
			setThanks(true);
			clearTimeout(timer.current);
			timer.current = setTimeout(() => setThanks(false), thanksMs);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Nie udało się wysłać");
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<button
				type="button"
				aria-label="Wyślij uwagę"
				title="Wyślij uwagę"
				class={open ? "active" : ""}
				onClick={() => {
					setThanks(false);
					setOpen(!open);
				}}
			>
				<Icon name="alert" />
			</button>
			{thanks && (
				<div class="feedback-thanks" role="status">
					<span class="feedback-check">
						<Icon name="check" />
					</span>
					<div>
						<strong>Dziękujemy za uwagę!</strong>
						<p>Zajmiemy się tym i poprawimy, co się da.</p>
					</div>
					<button
						type="button"
						class="feedback-thanks-close"
						aria-label="Zamknij"
						onClick={() => setThanks(false)}
					>
						<Icon name="close" />
					</button>
				</div>
			)}
			{open && (
				<form class="feedback-form" onSubmit={submit}>
					<label for="feedback-text">Co poprawić albo co nie działa?</label>
					<textarea
						id="feedback-text"
						value={text}
						maxLength={2000}
						rows={5}
						placeholder="Napisz własnymi słowami"
						// biome-ignore lint/a11y/noAutofocus: the person has just pressed the button to write
						autoFocus
						onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
						onKeyDown={(e) => e.key === "Escape" && close()}
					/>
					{error && (
						<p class="error" role="alert">
							{error}
						</p>
					)}
					<div class="row">
						<button type="button" onClick={close}>
							Anuluj
						</button>
						<button
							type="submit"
							class="primary"
							disabled={busy || !text.trim()}
						>
							Wyślij
						</button>
					</div>
				</form>
			)}
		</>
	);
}
