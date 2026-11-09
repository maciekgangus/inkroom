import { useState } from "preact/hooks";
import type { Settings } from "./board/controller";

export const COLORS = ["#111111", "#d32f2f", "#1976d2", "#388e3c", "#f57c00"];
export const SIZES = [2, 5, 10];

interface Props {
	settings: Settings;
	onUndo: () => void;
	onRedo: () => void;
}

/** Tool palette: pen/eraser, color, size, undo/redo. Mutates `settings` in place. */
export function Toolbar({ settings, onUndo, onRedo }: Props) {
	const [, rerender] = useState(0);
	const set = (patch: Partial<Settings>) => {
		Object.assign(settings, patch);
		rerender((n) => n + 1);
	};
	const on = (active: boolean) => (active ? "active" : "");

	return (
		<div class="toolbar">
			<button
				type="button"
				aria-label="pen"
				class={on(settings.tool === "pen")}
				onClick={() => set({ tool: "pen" })}
			>
				Pióro
			</button>
			<button
				type="button"
				aria-label="eraser"
				class={on(settings.tool === "eraser")}
				onClick={() => set({ tool: "eraser" })}
			>
				Gumka
			</button>
			<button
				type="button"
				aria-label="pan"
				class={on(settings.tool === "pan")}
				onClick={() => set({ tool: "pan" })}
			>
				Ręka
			</button>
			{COLORS.map((c) => (
				<button
					type="button"
					key={c}
					aria-label={`color ${c}`}
					class={`swatch ${on(settings.tool === "pen" && settings.color === c)}`}
					style={{ background: c }}
					onClick={() => set({ color: c, tool: "pen" })}
				/>
			))}
			{SIZES.map((s) => (
				<button
					type="button"
					key={s}
					aria-label={`size ${s}`}
					class={on(settings.size === s)}
					onClick={() => set({ size: s })}
				>
					<span
						class="dot"
						style={{ width: `${s + 2}px`, height: `${s + 2}px` }}
					/>
				</button>
			))}
			<button type="button" aria-label="undo" onClick={onUndo}>
				↶
			</button>
			<button type="button" aria-label="redo" onClick={onRedo}>
				↷
			</button>
		</div>
	);
}
