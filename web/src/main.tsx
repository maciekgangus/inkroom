import { render } from "preact";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-ext-400.css";
// The real semibold for names and headings, so the browser does not fake a bold from the 400.
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-ext-600.css";
// The other text fonts (R-101) and the italics: the browser fetches a file only when a text uses it.
import "@fontsource/inter/latin-400-italic.css";
import "@fontsource/inter/latin-ext-400-italic.css";
import "@fontsource/inter/latin-600-italic.css";
import "@fontsource/inter/latin-ext-600-italic.css";
import "@fontsource/lora/latin-400.css";
import "@fontsource/lora/latin-ext-400.css";
import "@fontsource/lora/latin-400-italic.css";
import "@fontsource/lora/latin-ext-400-italic.css";
import "@fontsource/lora/latin-700.css";
import "@fontsource/lora/latin-ext-700.css";
import "@fontsource/lora/latin-700-italic.css";
import "@fontsource/lora/latin-ext-700-italic.css";
import "@fontsource/caveat/latin-400.css";
import "@fontsource/caveat/latin-ext-400.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/caveat/latin-ext-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-ext-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/latin-ext-700.css";
import "./style.css";
import { App } from "./app";
import { installErrorReporting } from "./error-report";
import { installPenClick } from "./pen-click";
import { initTheme } from "./theme";

initTheme();
installPenClick();
installErrorReporting();
const root = document.getElementById("app");
if (root) render(<App />, root);
