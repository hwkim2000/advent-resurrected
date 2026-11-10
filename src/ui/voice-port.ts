// Voice port for the DOM module and the composition root.
// Types only: no runtime code. `src/voice` satisfies these structurally;
// `src/ui` never imports it.

import type { GamePhase } from './input-resolver';
import type { InputOrigin, Logger, Mode, PromptKind } from './types';

export type VoiceAvailability = 'Unsupported' | 'Ready' | 'Busy' | 'Suspended' | 'Unavailable';

/** Everything the DOM module renders. */
export interface VoiceViewState {
  readonly availability: VoiceAvailability;
  /** A Voice_Session is running (aria-pressed). */
  readonly pressed: boolean;
  /** phase !== 'ready', prompt kind 'filename', or no running game (aria-disabled). */
  readonly disabled: boolean;
  /** Voice_Status text; '' when empty. */
  readonly status: string;
  readonly announcement: { readonly seq: number; readonly text: string } | null;
}

export type PointerKind = 'mouse' | 'pen' | 'touch';

export type VoiceGestureEvent =
  | { type: 'pointer-down'; pointerType: PointerKind }
  | { type: 'pointer-up'; pointerType: PointerKind }
  | { type: 'pointer-cancel'; pointerType: PointerKind }
  /** keyboard: click with detail 0; touch: Touch_Click (click with detail > 0 after a touch pointer-down). */
  | { type: 'button-activate'; via: 'keyboard' | 'touch' }
  | { type: 'altm-down'; repeat: boolean }
  | { type: 'altm-up' }
  | { type: 'escape' }
  | { type: 'window-blur' }
  | { type: 'page-hidden' }
  | { type: 'pagehide' };

export interface GestureReply {
  readonly preventDefault: boolean;
}

export interface VoicePort {
  getView(): VoiceViewState;
  onView(listener: (view: VoiceViewState) => void): () => void;
  dispatch(event: VoiceGestureEvent): GestureReply;
}

/** What main.ts and voice-loader.ts hold. */
export interface VoiceLayer {
  readonly port: VoicePort;
  /** Ready or Busy. */
  readonly usable: boolean;
  readonly listening: boolean;
  subscribe(listener: (listening: boolean) => void): () => void;
  gameStart(mode: Mode): void;
  /** Called every animation frame; cheap no-op when nothing changed. */
  syncHost(): void;
}

export interface VoiceLayerHost {
  submit(line: string, origin: InputOrigin): void;
  readonly promptKind: PromptKind | undefined;
  readonly phase: GamePhase | undefined;
  readonly gameMode: Mode | undefined;
  readonly log: Logger;
}
