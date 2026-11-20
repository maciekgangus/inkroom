import { render } from "preact";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-ext-400.css";
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
