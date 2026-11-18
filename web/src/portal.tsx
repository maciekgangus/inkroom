import { type ComponentChildren, render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * Draws its children in a node of their own on the page, outside the element they are written
 * in (a window that must not be clipped or moved by its parent). It is a separate tree, so events
 * do not bubble through the parent; `preact/compat` has a portal too, but it changes how every
 * `onChange` on a field behaves.
 */
export function Portal({ children }: { children: ComponentChildren }) {
	const node = useRef<HTMLDivElement | null>(null);
	if (!node.current) node.current = document.createElement("div");
	useLayoutEffect(() => {
		const el = node.current as HTMLDivElement;
		document.body.appendChild(el);
		return () => {
			render(null, el);
			el.remove();
		};
	}, []);
	useLayoutEffect(() => {
		render(<>{children}</>, node.current as HTMLDivElement);
	});
	return null;
}
