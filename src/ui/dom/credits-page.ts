// Credits page glue. Single source of truth for licence text: the files are
// imported verbatim with Vite `?raw` and written with textContent only.
import credits from "../../../CREDITS.md?raw";
import attribution from "../../../original/ATTRIBUTION.md?raw";
import copying from "../../../original/COPYING?raw";

const RULE = "\n\n" + "=".repeat(60) + "\n\n";

/** Builds the full credits text from the three bundled sources. */
export function buildCreditsText(): string {
  return [credits, attribution, copying].join(RULE);
}

const target = document.getElementById("credits-text");
if (target) {
  target.textContent = buildCreditsText();
}
