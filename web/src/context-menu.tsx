import { useEffect } from "preact/hooks";
import { closeOnDismiss } from "./dismiss";
import { Icon } from "./icon";

export interface MenuItem {
	label: string;
	icon: Parameters<typeof Icon>[0]["name"];
	onSelect: () => void;
	disabled?: boolean;
}

interface Props {
	/** Where it opened, in client pixels. */
	x: number;
	y: number;
	items: MenuItem[];
	onClose: () => void;
}

const WIDTH = 220;
const ROW = 40;

/** The right-click menu: a list of actions that closes after one, on Escape or outside click. */
export function ContextMenu({ x, y, items, onClose }: Props) {
	useEffect(() => {
		const stop = closeOnDismiss(".context-menu", onClose);
		addEventListener("wheel", onClose, { passive: true });
		return () => {
			stop();
			removeEventListener("wheel", onClose);
		};
	}, [onClose]);

	// Keep it on screen when opened near the right or bottom edge.
	const left = Math.max(8, Math.min(x, innerWidth - WIDTH - 8));
	const top = Math.max(8, Math.min(y, innerHeight - items.length * ROW - 20));

	return (
		<div
			class="context-menu"
			role="menu"
			style={{ left: `${left}px`, top: `${top}px` }}
		>
			{items.map((item) => (
				<button
					type="button"
					role="menuitem"
					key={item.label}
					disabled={item.disabled}
					onClick={() => {
						item.onSelect();
						onClose();
					}}
				>
					<Icon name={item.icon} />
					{item.label}
				</button>
			))}
		</div>
	);
}
