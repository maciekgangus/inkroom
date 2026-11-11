import { currentTheme, useTheme } from "./theme";

/**
 * The Inkroom logo (the nib and the name, brand/ has the originals): the version for light
 * backgrounds on the light theme and the one for dark backgrounds on the dark one.
 */
export function Logo({ height = 32 }: { height?: number }) {
	useTheme(); // the picture follows a switch of the theme
	const src =
		currentTheme() === "dark"
			? "/brand/logo-dark.svg"
			: "/brand/logo-light.svg";
	return <img class="brand-logo" src={src} alt="Inkroom" height={height} />;
}
