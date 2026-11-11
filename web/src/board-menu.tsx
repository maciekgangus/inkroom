import type { MenuItem } from "./context-menu";
import { Icon } from "./icon";

/** What the board menu can ask for. */
export type BoardAction = "png-view" | "png-board" | "pdf-board";

/** Where the menu should open (client pixels), taken from the button that was pressed. */
export interface MenuAt {
	x: number;
	y: number;
}

/** The entries of the board menu (export, R-014). */
export function boardMenuItems(onPick: (a: BoardAction) => void): MenuItem[] {
	return [
		{ label: "PNG: widok", icon: "image", onSelect: () => onPick("png-view") },
		{
			label: "PNG: cała tablica",
			icon: "image",
			onSelect: () => onPick("png-board"),
		},
		{
			label: "PDF: cała tablica",
			icon: "download",
			onSelect: () => onPick("pdf-board"),
		},
	];
}

/**
 * The button at the end of the top bar. The menu itself is drawn by the board view, outside the
 * bar: the bar is transformed, which would make `position: fixed` relative to it.
 */
export function BoardMenuButton({ onOpen }: { onOpen: (at: MenuAt) => void }) {
	return (
		<button
			type="button"
			class="board-menu"
			aria-label="board menu"
			title="Pobierz tablicę"
			onClick={(e) => {
				const r = e.currentTarget.getBoundingClientRect();
				onOpen({ x: r.right - 220, y: r.bottom + 8 });
			}}
		>
			<Icon name="download" />
		</button>
	);
}
