import { useEffect, useRef, useState } from "preact/hooks";
import { KEYED_TOOLS, resetShortcuts, setShortcut, toolKey } from "./shortcuts";

/**
 * The window of own shortcuts: each tool with its key. A click on a key waits for the next key
 * pressed and gives it to the tool, unless it is another tool's or does something else. The
 * choice stays on this device.
 */
export function ShortcutsDialog({
	onClose,
	onChange,
}: {
	onClose: () => void;
	/** Called after a key was changed or reset, so the tooltips of the toolbar follow. */
	onChange: () => void;
}) {
	const [waiting, setWaitingState] = useState<string | null>(null);
	/** The same, readable at once by the key listener (an effect would attach a moment late). */
	const waitingNow = useRef<string | null>(null);
	const setWaiting = (tool: string | null) => {
		waitingNow.current = tool;
		setWaitingState(tool);
	};
	const [error, setError] = useState("");
	const [, redraw] = useState(0);

	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			const waitingFor = waitingNow.current;
			if (!waitingFor) return;
			// Nothing else on the page may react to the key that is being chosen.
			e.preventDefault();
			e.stopPropagation();
			if (e.code === "Escape") {
				setWaiting(null);
				setError("");
				return;
			}
			const tool = KEYED_TOOLS.find((t) => t.tool === waitingFor)?.tool;
			if (!tool) return;
			const result = setShortcut(tool, e.code);
			if (result.ok) {
				setWaiting(null);
				setError("");
				onChange();
				redraw((n) => n + 1);
			} else if ("taken" in result) {
				const name = KEYED_TOOLS.find((t) => t.tool === result.taken)?.name;
				setError(`Ten klawisz ma już: ${name}`);
			} else {
				setError("Tego klawisza nie można użyć");
			}
		};
		addEventListener("keydown", key, true);
		return () => removeEventListener("keydown", key, true);
	}, [onChange]);

	return (
		<div class="shortcuts-backdrop">
			<div
				class="shortcuts-dialog"
				role="dialog"
				aria-label="Skróty klawiszowe"
			>
				<h2>Skróty klawiszowe</h2>
				<p class="muted">
					Kliknij klawisz narzędzia i naciśnij nowy. Esc zdejmuje zaznaczenie
					zawsze. Zapisuje się na tym urządzeniu.
				</p>
				{KEYED_TOOLS.map(({ tool, name }) => (
					<div class="shortcut-row" key={tool}>
						<span class="name">{name}</span>
						<button
							type="button"
							class={waiting === tool ? "waiting" : ""}
							onClick={() => {
								setWaiting(tool);
								setError("");
							}}
						>
							{waiting === tool ? "Naciśnij klawisz…" : toolKey(tool)?.label}
						</button>
					</div>
				))}
				{error && (
					<p class="shortcut-error" role="alert">
						{error}
					</p>
				)}
				<div class="row">
					<button
						type="button"
						class="shortcut-reset"
						onClick={() => {
							resetShortcuts();
							setWaiting(null);
							setError("");
							onChange();
							redraw((n) => n + 1);
						}}
					>
						Przywróć domyślne
					</button>
					<button type="button" class="shortcut-close" onClick={onClose}>
						Zamknij
					</button>
				</div>
			</div>
		</div>
	);
}
