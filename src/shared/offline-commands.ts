/**
 * Phrases the AI maps badly that are cheap and safe to map on the client, without a
 * request. Pure and total. New code; not ported from Open Adventure.
 */
import { validateCommand } from './command-validation';
import { normalizePlayerText } from './normalize';

const LIGHT = '(?:lamp|lantern|light|torch|flashlight)';
const DET = '(?:the |my |your |this |that )?';

/** "switch off the lamp", "turn the light off", "shut off my lantern", optional please/now. */
const LAMP_OFF = new RegExp(
  `^(?:please |pls )?(?:` +
    `(?:switch|turn|shut|put|blow) (?:off|out) ${DET}${LIGHT}` +
    `|(?:switch|turn|shut) ${DET}${LIGHT} (?:off|out)` +
    `)(?: please| now)?$`,
);

function plain(text: string): string {
  return normalizePlayerText(text)
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The canonical classic command for a known phrase, or undefined. */
export function offlineCommand(text: string): string | undefined {
  try {
    if (!LAMP_OFF.test(plain(text))) return undefined;
    const checked = validateCommand('EXTIN LAMP');
    return checked.ok ? checked.command : undefined;
  } catch {
    return undefined;
  }
}
