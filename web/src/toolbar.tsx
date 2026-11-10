import { useEffect, useState } from "preact/hooks";
import type { Settings } from "./board/controller";
import { SHAPE_GROUPS, SHAPES, saveShape } from "./board/shapes";
import { Icon } from "./icon";
import { ImageControls, type ImageControlsProps } from "./image-controls";
import { ShapeIcon } from "./shape-icon";
import { selectTool, TOOL_KEYS } from "./shortcuts";
import { StrokeControls } from "./stroke-controls";
import { displayColor, useTheme } from "./theme";

export const COLORS = ["#111111", "#d32f2f", "#1976d2", "#388e3c", "#f57c00"];
/** The colours at hand in the bar; the rest of COLORS and MORE_COLORS are behind the plus. */
export const QUICK_COLORS = COLORS.slice(0, 3);
/** Extra colours behind the palette button (R-025). */
export const MORE_COLORS = [
	"#6b7280",
	"#8d5a2b",
	"#e91e63",
	"#c026d3",
	"#7c3aed",
	"#3f51b5",
	"#0ea5e9",
	"#0d9488",
	"#22c55e",
	"#84cc16",
	"#eab308",
	"#ff7043",
];
export { SIZES } from "./stroke-controls";

interface Props {
	settings: Settings;
	/** True while something is selected: the properties panel then owns colour and size. */
	hasSelection?: boolean;
	/** The image group (add, and on a tablet paste and delete); left out, there is none. */
	images?: ImageControlsProps;
	/** Called after the tool changed, so the board can show the matching cursor at once. */
	onToolChange?: () => void;
	onUndo: () => void;
	onRedo: () => void;
}

const TOOLS: { tool: Settings["tool"]; label: string }[] = [
	{ tool: "select", label: "Zaznacz" },
	{ tool: "pen", label: "Pióro" },
	{ tool: "line", label: "Linia" },
	{ tool: "shape", label: "Kształty" },
	{ tool: "text", label: "Tekst" },
	{ tool: "eraser", label: "Gumka" },
	{ tool: "pan", label: "Ręka" },
];

/** Tools that draw something in the chosen colour. */
const colourTools: Settings["tool"][] = ["pen", "line", "shape", "text"];

/** Tool palette: tools, color, size, undo/redo. Mutates `settings` in place. */
export function Toolbar({
	settings,
	hasSelection = false,
	images,
	onToolChange,
	onUndo,
	onRedo,
}: Props) {
	const [, rerender] = useState(0);
	const set = (patch: Partial<Settings>) => {
		Object.assign(settings, patch);
		rerender((n) => n + 1);
		if (patch.tool) onToolChange?.();
	};
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [shapesOpen, setShapesOpen] = useState(false);
	// The list belongs to the shape tool: leaving it closes the list.
	const listOpen = shapesOpen && settings.tool === "shape";
	useEffect(() => {
		if (!listOpen) return;
		const close = () => setShapesOpen(false);
		const key = (e: KeyboardEvent) => e.key === "Escape" && close();
		const outside = (e: Event) => {
			if (!(e.target as HTMLElement).closest?.(".shape-wrap")) close();
		};
		addEventListener("keydown", key);
		addEventListener("pointerdown", outside, true);
		return () => {
			removeEventListener("keydown", key);
			removeEventListener("pointerdown", outside, true);
		};
	}, [listOpen]);
	const theme = useTheme();
	const on = (active: boolean) => (active ? "active" : "");
	const drawing = colourTools.includes(settings.tool);
	const custom = !QUICK_COLORS.includes(settings.color);
	// Picking a colour while erasing or panning goes back to the pen; shapes and text stay.
	const pick = (color: string) =>
		set({
			color,
			tool: colourTools.includes(settings.tool) ? settings.tool : "pen",
		});
	const swatch = (c: string, after?: () => void) => (
		<button
			type="button"
			key={c}
			aria-label={`color ${c}`}
			aria-pressed={drawing && settings.color === c}
			class={`swatch ${on(drawing && settings.color === c)}`}
			style={{ background: displayColor(c, theme) }}
			onClick={() => {
				pick(c);
				after?.();
			}}
		/>
	);

	return (
		<div class="toolbar">
			<div class="group">
				{TOOLS.map(({ tool, label }) => {
					const isShapeTool = tool === "shape";
					const current =
						SHAPES.find((s) => s.kind === (settings.shape ?? "rect")) ??
						SHAPES[0];
					const button = (
						<button
							type="button"
							key={tool}
							aria-label={tool}
							aria-pressed={settings.tool === tool}
							aria-expanded={isShapeTool ? listOpen : undefined}
							title={
								TOOL_KEYS[tool] ? `${label} (${TOOL_KEYS[tool]?.label})` : label
							}
							class={`${on(settings.tool === tool)}${isShapeTool ? " has-list" : ""}`}
							onClick={() => {
								// The shape button opens its list when the tool is already on.
								if (isShapeTool && settings.tool === "shape") {
									setShapesOpen(!shapesOpen);
									return;
								}
								selectTool(settings, tool);
								setShapesOpen(false);
								rerender((n) => n + 1);
								onToolChange?.();
							}}
						>
							{isShapeTool ? (
								<ShapeIcon kind={current.kind} />
							) : (
								<Icon name={tool} />
							)}
						</button>
					);
					if (!isShapeTool) return button;
					return (
						<div class="shape-wrap" key={tool}>
							{button}
							{listOpen && (
								<div class="shape-list" role="menu">
									{SHAPE_GROUPS.map((group) => (
										<div class="shape-group" key={group.title}>
											<div class="shape-group-title">{group.title}</div>
											<div class="shape-grid">
												{group.shapes.map((s) => (
													<button
														type="button"
														role="menuitem"
														key={s.kind}
														aria-label={`shape ${s.kind}`}
														title={s.label}
														class={on(s.kind === current.kind)}
														onClick={() => {
															settings.shape = s.kind;
															saveShape(s.kind);
															selectTool(settings, "shape");
															setShapesOpen(false);
															rerender((n) => n + 1);
															onToolChange?.();
														}}
													>
														<ShapeIcon kind={s.kind} />
													</button>
												))}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>
			{
				<div class={`group${hasSelection ? " dimmed" : ""}`}>
					{QUICK_COLORS.map((c) => swatch(c))}
					<button
						type="button"
						aria-label="more colors"
						aria-pressed={drawing && custom}
						aria-expanded={paletteOpen}
						title="Więcej kolorów"
						class={`swatch more ${on(drawing && custom)}`}
						style={
							custom
								? { background: displayColor(settings.color, theme) }
								: undefined
						}
						onClick={() => setPaletteOpen(!paletteOpen)}
					>
						{!custom && <Icon name="plus" />}
					</button>
					{paletteOpen && (
						<div class="palette">
							{[...COLORS.slice(3), ...MORE_COLORS].map((c) =>
								swatch(c, () => setPaletteOpen(false)),
							)}
							<label class="custom">
								Własny kolor
								<input
									type="color"
									aria-label="custom color"
									value={custom ? settings.color : "#5b5bf0"}
									onInput={(e) =>
										pick((e.currentTarget as HTMLInputElement).value)
									}
								/>
							</label>
						</div>
					)}
				</div>
			}
			<div class={`group${hasSelection ? " dimmed" : ""}`}>
				<StrokeControls settings={settings} onChange={set} />
			</div>
			{images && <ImageControls {...images} />}
			<div class="group">
				<button type="button" aria-label="undo" title="Cofnij" onClick={onUndo}>
					<Icon name="undo" />
				</button>
				<button type="button" aria-label="redo" title="Ponów" onClick={onRedo}>
					<Icon name="redo" />
				</button>
			</div>
		</div>
	);
}
