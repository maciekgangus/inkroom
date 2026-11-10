import { render } from "preact";
import "./style.css";
import { App } from "./app";
import { initTheme } from "./theme";

initTheme();
const root = document.getElementById("app");
if (root) render(<App />, root);
