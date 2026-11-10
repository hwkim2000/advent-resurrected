// Fixed Voice_Status strings (spec: voice-input, Requirement 7).
// Calm wording only: none of these contains error, failed, denied, danger,
// warning, system, exception, crash or fatal.

export const LISTENING = 'LISTENING...';
export const NOTHING_HEARD = 'NOTHING HEARD.';
export const DIDNT_CATCH = "DIDN'T CATCH THAT.";
export const TYPE_FILE_NAME = 'TYPE THE FILE NAME.';
export const TYPE_THAT_COMMAND = 'TYPE THAT COMMAND; DO NOT SAY IT.';
export const VOICE_NOT_AVAILABLE = 'VOICE IS NOT AVAILABLE. KEEP TYPING.';
export const NO_MICROPHONE = 'NO MICROPHONE FOUND. KEEP TYPING.';
export const SERVICE_NOT_ANSWERING = 'THE VOICE SERVICE IS NOT ANSWERING. TRY AGAIN OR TYPE.';
export const VOICE_TROUBLE = 'VOICE TROUBLE. TYPE INSTEAD.';

/** Prefix of the visible preview/result status. */
export const HEARD_PREFIX = 'HEARD: ';
/** Prefix of the Voice_Live_Region announcement after a result. */
export const HEARD_ANNOUNCE_PREFIX = 'Heard: ';
