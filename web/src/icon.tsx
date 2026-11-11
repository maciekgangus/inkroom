/** Icon outlines on a 24 by 24 grid, drawn as one stroked path each. */
const ICONS = {
	plain:
		"M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
	dots: "M7 7h.01M12 7h.01M17 7h.01M7 12h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01M17 17h.01",
	grid: "M4 9h16M4 15h16M9 4v16M15 4v16",
	lines: "M4 7h16M4 12h16M4 17h16",
	sun: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
	moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
	pen: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
	line: "M5 19 19 5",
	rect: "M6 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
	circle: "M12 6c5 0 9 2.7 9 6s-4 6-9 6s-9-2.7-9-6s4-6 9-6Z",
	text: "M5 7V4h14v3M12 4v16M9 20h6",
	eraser:
		"m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21M22 21H7M5 11l9 9",
	select: "M5 3l14 8-6.2 1.9L10 19Z",
	pan: "M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
	undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
	redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
	plus: "M12 5v14M5 12h14",
	map: "M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7ZM9 4v13M15 7v13",
	fit: "M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4",
	"no-fill":
		"M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM4.5 19.5l15-15",
	bucket:
		"M5 12 12 5l7 7-6.5 6.5a2 2 0 0 1-2.8 0ZM12 5 9 2M5 12h14M20.5 16s1.5 1.7 1.5 2.7a1.5 1.5 0 0 1-3 0c0-1 1.5-2.7 1.5-2.7Z",
	opacity:
		"M12 3s6.5 6.6 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3ZM12 8v12",
	width: "M4 6h16M4 11h16M4 17.5h16",
	wave: "M3 15c3-7 5-7 8-2.5s5 4.5 10-3",
	"style-solid": "M4 12h16",
	"style-dashed": "M3 12h4M10 12h4M17 12h4",
	"style-dotted": "M4 12h.01M8 12h.01M12 12h.01M16 12h.01M20 12h.01",
	sliders: "M4 8h16M4 16h16M9 5v6M15 13v6",
	trapezoid: "M8 6h8l4 12H4Z",
	rhombus: "M12 3l8 9-8 9-8-9Z",
	parallelogram: "M8 6h12l-4 12H4Z",
	link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
	close: "M6 6l12 12M18 6 6 18",
	tiles:
		"M5 4h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM14 4h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM5 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM14 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z",
	file: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM14 3v5h5M9 13h6M9 17h6",
	download: "M12 4v11M7 11l5 5 5-5M5 20h14",
	image:
		"M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8.5 10a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3ZM20 15l-5-5L5 20",
	paste:
		"M9 4h6v3H9ZM15 5.5h2a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h2",
	trash:
		"M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3",
	copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
	duplicate: "M8 8h12v12H8ZM4 16V4h12",
	front: "M9 3h11v11H9ZM4 9v11h11",
	back: "M4 3h11v11H4ZM9 9h11v11H9Z",
};

/** A line icon that takes the colour of the surrounding text. */
export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d={ICONS[name]} />
		</svg>
	);
}
