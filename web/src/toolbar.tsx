import { useState } from "preact/hooks";
import type { Settings } from "./board/controller";

export const COLORS = ["#111111", "#d32f2f", "#1976d2", "#388e3c", "#f57c00"];
export const SIZES = [2, 5, 10];

interface Props {
	settings: Settings;
	onUndo: () => void;
	onRedo: () => void;
}

const TOOLS: { tool: Settings["tool"]; label: string }[] = [
	{ tool: "pen", label: "Pióro" },
	{ tool: "line", label: "Linia" },
	{ tool: "rect", label: "Prostokąt" },
	{ tool: "circle", label: "Okrąg" },
	{ tool: "text", label: "Tekst" },
	{ tool: "eraser", label: "Gumka" },
	{ tool: "pan", label: "Ręka" },
];

/** Tools that draw something in the chosen colour. */
const colourTools: Settings["tool"][] = [
	"pen",
	"line",
	"rect",
	"circle",
	"text",
];

/** Tool palette: tools, color, size, undo/redo. Mutates `settings` in place. */
export function Toolbar({ settings, onUndo, onRedo }: Props) {
	const [, rerender] = useState(0);
	const set = (patch: Partial<Settings>) => {
		Object.assign(settings, patch);
		rerender((n) => n + 1);
	};
	const on = (active: boolean) => (active ? "active" : "");
	const drawing = colourTools.includes(settings.tool);

	return (
		<div class="toolbar">
			{TOOLS.map(({ tool, label }) => (
				<button
					type="button"
					key={tool}
					aria-label={tool}
					class={on(settings.tool === tool)}
					onClick={() => set({ tool })}
				>
					{label}
				</button>
			))}
			{COLORS.map((c) => (
				<button
					type="button"
					key={c}
					aria-label={`color ${c}`}
					class={`swatch ${on(drawing && settings.color === c)}`}
					style={{ background: c }}
					// Picking a colour while erasing or panning goes back to the pen; shapes and text stay.
					onClick={() =>
						set({
							color: c,
							tool: colourTools.includes(settings.tool) ? settings.tool : "pen",
						})
					}
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
