import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import type { Settings } from "./board/controller";
import { SHAPE_GROUPS, SHAPES, saveShape } from "./board/shapes";
import { CustomColor } from "./custom-color";
import { closeOnDismiss } from "./dismiss";
import { getExtraColor, setExtraColor } from "./extra-color";
import { Icon } from "./icon";
import { ImageControls, type ImageControlsProps } from "./image-controls";
import { ShapeIcon } from "./shape-icon";
import { saveSnapShapes } from "./shape-snap";
import { toolKey } from "./shortcuts";
import { StrokeControls } from "./stroke-controls";
import { displayColor, useTheme } from "./theme";
import { rememberColor, rememberLineStyle, switchTool } from "./tool-style";
import { useToolbarLayout } from "./toolbar-layout";

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
	{ tool: "plane", label: "Układ współrzędnych" },
	{ tool: "text", label: "Tekst" },
	{ tool: "eraser", label: "Gumka" },
	{ tool: "pan", label: "Ręka" },
	{ tool: "laser", label: "Wskaźnik" },
];

/** Tools that draw something in the chosen colour. */
const colourTools: Settings["tool"][] = [
	"pen",
	"line",
	"shape",
	"text",
	"plane",
];

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
		const { tool, color, ...rest } = patch;
		Object.assign(settings, rest);
		if (tool) switchTool(settings, tool);
		// A colour picked together with a tool is the one chosen, not the one the tool had (R-097).
		if (color) {
			settings.color = color;
			rememberColor(settings.tool, color);
		}
		if (patch.lineStyle) rememberLineStyle(settings.tool, patch.lineStyle);
		if (patch.snapShapes !== undefined) saveSnapShapes(patch.snapShapes);
		rerender((n) => n + 1);
		if (patch.tool) onToolChange?.();
	};
	const layout = useToolbarLayout();
	const compact = layout !== "full";
	const [settingsOpen, setSettingsOpen] = useState(false);
	// The list of settings belongs to the narrow bar: Escape or a press outside closes it. Set up
	// at once (not after the next paint), so a key pressed right after it opens already counts.
	useLayoutEffect(() => {
		if (!compact || !settingsOpen) return;
		return closeOnDismiss(".settings-wrap", () => setSettingsOpen(false));
	}, [compact, settingsOpen]);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [shapesOpen, setShapesOpen] = useState(false);
	// The list belongs to the shape tool: leaving it closes the list.
	const listOpen = shapesOpen && settings.tool === "shape";
	useEffect(() => {
		if (!listOpen) return;
		return closeOnDismiss(".shape-wrap", () => setShapesOpen(false));
	}, [listOpen]);
	const theme = useTheme();
	const on = (active: boolean) => (active ? "active" : "");
	const drawing = colourTools.includes(settings.tool);
	const custom = !QUICK_COLORS.includes(settings.color);
	// Picking a colour while erasing or panning goes back to the pen; shapes and text stay.
	const pick = (color: string) => {
		// A colour from beyond the quick ones is kept in the fourth slot (R-079).
		if (!QUICK_COLORS.includes(color)) setExtraColor(color);
		set({
			color,
			tool: colourTools.includes(settings.tool) ? settings.tool : "pen",
		});
	};
	const extra = custom ? settings.color : getExtraColor();
	const swatch = (c: string, after?: () => void) => (
		<button
			type="button"
			key={c}
			aria-label={`color ${c}`}
			title={
				QUICK_COLORS.includes(c)
					? `Kolor ${QUICK_COLORS.indexOf(c) + 1} (klawisz ${QUICK_COLORS.indexOf(c) + 1})`
					: undefined
			}
			aria-pressed={drawing && settings.color === c}
			class={`swatch ${on(drawing && settings.color === c)}`}
			style={{ background: displayColor(c, theme) }}
			onClick={() => {
				pick(c);
				after?.();
			}}
		/>
	);

	// The tile for any other colour and its picker, in the palette and in the list of settings.
	const [picking, setPicking] = useState(false);
	useEffect(() => {
		if (!paletteOpen && !settingsOpen) setPicking(false);
	}, [paletteOpen, settingsOpen]);
	const customColor = (
		<CustomColor
			label="custom color"
			current={settings.color}
			own={![...COLORS, ...MORE_COLORS].includes(settings.color)}
			display={(c) => displayColor(c, theme)}
			open={picking}
			onToggle={() => setPicking(!picking)}
			onInput={pick}
			onChange={pick}
		/>
	);

	return (
		<div class={`toolbar ${layout === "rail" ? "rail" : ""}`}>
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
								toolKey(tool) ? `${label} (${toolKey(tool)?.label})` : label
							}
							class={`${on(settings.tool === tool)}${isShapeTool ? " has-list" : ""}`}
							onClick={() => {
								// The shape button opens its list when the tool is already on.
								if (isShapeTool && settings.tool === "shape") {
									setShapesOpen(!shapesOpen);
									return;
								}
								setShapesOpen(false);
								set({ tool });
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
															saveShape(s.kind);
															setShapesOpen(false);
															set({ shape: s.kind, tool: "shape" });
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
			{compact ? (
				<div class={`group${hasSelection ? " dimmed" : ""}`}>
					<div class="flyout-wrap settings-wrap">
						<button
							type="button"
							aria-label="pen settings"
							aria-expanded={settingsOpen}
							title="Kolor, grubość i styl"
							class={`has-list settings-button ${on(settingsOpen)}`}
							onClick={() => setSettingsOpen(!settingsOpen)}
						>
							<span
								class="settings-color"
								style={{ background: displayColor(settings.color, theme) }}
							/>
							<span
								class="settings-width"
								style={{ height: `${Math.min(8, settings.size * 2 + 1)}px` }}
							/>
						</button>
						{settingsOpen && (
							<div class="settings-list">
								<span class="settings-title">Kolor</span>
								<div class="settings-colors">
									{[...COLORS, ...MORE_COLORS].map((c) => swatch(c))}
									{customColor}
								</div>
								<span class="settings-title">Grubość</span>
								<StrokeControls settings={settings} onChange={set} inline />
							</div>
						)}
					</div>
				</div>
			) : (
				<>
					<div class={`group${hasSelection ? " dimmed" : ""}`}>
						{QUICK_COLORS.map((c) => swatch(c))}
						<button
							type="button"
							aria-label="more colors"
							aria-pressed={drawing && custom}
							aria-expanded={paletteOpen}
							title={
								extra
									? "Ostatni dodatkowy kolor (klawisz 4); jeszcze raz otwiera paletę"
									: "Więcej kolorów"
							}
							class={`swatch more ${on(drawing && custom)}`}
							style={
								extra ? { background: displayColor(extra, theme) } : undefined
							}
							onClick={() => {
								// The kept colour is picked first; pressed again, it opens the palette.
								if (!custom && extra) pick(extra);
								else setPaletteOpen(!paletteOpen);
							}}
						>
							{!extra && <Icon name="plus" />}
						</button>
						{paletteOpen && (
							<div class="palette">
								{[...COLORS.slice(3), ...MORE_COLORS].map((c) =>
									swatch(c, () => setPaletteOpen(false)),
								)}
								{customColor}
							</div>
						)}
					</div>
					<div class={`group${hasSelection ? " dimmed" : ""}`}>
						<StrokeControls settings={settings} onChange={set} />
					</div>
				</>
			)}
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
