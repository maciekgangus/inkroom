import { useTheme } from "./theme";

/**
 * The mark of Inkroom in the top left corner of a board; pressing it goes back to the main menu,
 * the boards (the app's home page). The version for the theme in use (brand/ has the originals).
 */
export function BrandLink() {
	const theme = useTheme();
	const src =
		theme === "dark"
			? "/brand/icon-dark-small.svg"
			: "/brand/icon-light-small.svg";
	return (
		<a
			class="brand-corner"
			href="/"
			aria-label="Inkroom: wróć do tablic"
			title="Wróć do tablic"
		>
			<img src={src} alt="" width="40" height="40" />
		</a>
	);
}
