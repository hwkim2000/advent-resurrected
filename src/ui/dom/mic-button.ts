// Mic_Button DOM module: renders the voice view state and turns pointer,
// click and keyboard gestures into VoicePort events. Imports only types from
// `../voice-port`; the voice layer is attached later through `attach(port)`.
// Text reaches the DOM only through textContent and attributes.

import type { PointerKind, VoiceGestureEvent, VoicePort, VoiceViewState } from '../voice-port';

export const ANNOUNCE_REARM_MS = 50;

export interface MicElements {
  button: HTMLButtonElement;
  status: HTMLElement;
  disclosure: HTMLElement;
  unavailable: HTMLElement;
  live: HTMLElement;
  input: HTMLInputElement;
}

export interface MicOptions {
  els: MicElements;
  doc?: Document;
  /** Runs `fn` after ANNOUNCE_REARM_MS; defaults to the window's setTimeout. */
  defer?: (fn: () => void) => void;
}

export interface MicHandle {
  attach(port: VoicePort): void;
  dispose(): void;
}

const NOOP_HANDLE: MicHandle = { attach() {}, dispose() {} };

function toPointerKind(type: string): PointerKind {
  return type === 'touch' || type === 'pen' ? type : 'mouse';
}

export function installMicButton(opts: MicOptions): MicHandle {
  const els = opts.els as Partial<MicElements> | undefined;
  if (
    !els ||
    !els.button ||
    !els.status ||
    !els.disclosure ||
    !els.unavailable ||
    !els.live ||
    !els.input
  ) {
    return NOOP_HANDLE;
  }
  const { button, status, disclosure, live, input } = els as MicElements;
  const doc = opts.doc ?? button.ownerDocument;
  const win = doc.defaultView;
  const defer =
    opts.defer ??
    ((fn: () => void): void => {
      if (win) win.setTimeout(fn, ANNOUNCE_REARM_MS);
      else fn();
    });

  let port: VoicePort | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  let pressType: PointerKind | null = null;
  let prev: Element | null = null;
  let lastSeq = -1;
  let pointerUpSeen = true;

  const dispatch = (event: VoiceGestureEvent): void => {
    if (port === null || disposed) return;
    port.dispatch(event);
  };

  const restoreInputFocus = (): void => {
    if (prev === input && doc.activeElement === button) {
      input.focus({ preventScroll: true });
    }
  };

  const render = (view: VoiceViewState): void => {
    const usable = view.availability === 'Ready' || view.availability === 'Busy';
    if (!usable && doc.activeElement === button) {
      input.focus({ preventScroll: true });
    }
    button.hidden = !usable;
    disclosure.hidden = !usable;

    button.setAttribute('aria-pressed', String(view.pressed));
    if (view.disabled) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    button.setAttribute(
      'aria-describedby',
      view.disabled ? 'mic-disclosure mic-unavailable' : 'mic-disclosure',
    );
    button.textContent = view.pressed ? 'MIC ON' : 'MIC';

    status.textContent = view.status;
    status.hidden = view.status === '';

    const a = view.announcement;
    if (a === null) {
      live.textContent = '';
      lastSeq = -1;
    } else if (a.seq !== lastSeq) {
      lastSeq = a.seq;
      if (live.textContent === a.text) {
        live.textContent = '';
        const seq = a.seq;
        defer(() => {
          if (!disposed && lastSeq === seq) live.textContent = a.text;
        });
      } else {
        live.textContent = a.text;
      }
    }
  };

  const hideAll = (): void => {
    button.hidden = true;
    disclosure.hidden = true;
    status.hidden = true;
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (port === null) return;
    if (e.button !== 0 || e.isPrimary === false) return;
    const kind = toPointerKind(e.pointerType);
    prev = doc.activeElement;
    pressType = kind;
    pointerUpSeen = false;
    e.preventDefault();
    if (kind !== 'touch' && typeof button.setPointerCapture === 'function') {
      try {
        button.setPointerCapture(e.pointerId);
      } catch {
        // Capture is optional.
      }
    }
    dispatch({ type: 'pointer-down', pointerType: kind });
    restoreInputFocus();
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (port === null) return;
    e.preventDefault();
    restoreInputFocus();
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (port === null) return;
    pointerUpSeen = true;
    dispatch({ type: 'pointer-up', pointerType: toPointerKind(e.pointerType) });
  };

  const onPointerCancel = (e: PointerEvent): void => {
    if (port === null) return;
    pressType = null;
    pointerUpSeen = true;
    dispatch({ type: 'pointer-cancel', pointerType: toPointerKind(e.pointerType) });
  };

  const onLostCapture = (e: PointerEvent): void => {
    if (port === null) return;
    const kind = toPointerKind(e.pointerType);
    if (kind === 'touch' || pointerUpSeen) return;
    pointerUpSeen = true;
    dispatch({ type: 'pointer-cancel', pointerType: kind });
  };

  const onClick = (e: MouseEvent): void => {
    if (port === null) return;
    const type = pressType;
    pressType = null;
    if (e.detail === 0) {
      dispatch({ type: 'button-activate', via: 'keyboard' });
    } else if (type === 'touch') {
      dispatch({ type: 'button-activate', via: 'touch' });
      restoreInputFocus();
    }
  };

  const onContextMenu = (e: Event): void => {
    if (port === null) return;
    e.preventDefault();
    pressType = null;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (port === null) return;
    if (e.code === 'KeyM' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const availability = port.getView().availability;
      if (availability === 'Ready' || availability === 'Busy') {
        e.preventDefault();
        dispatch({ type: 'altm-down', repeat: e.repeat });
      }
    } else if (e.key === 'Escape' && port.getView().pressed) {
      dispatch({ type: 'escape' });
    }
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (port === null) return;
    if (e.code === 'KeyM' || e.code === 'AltLeft' || e.code === 'AltRight' || e.key === 'Alt') {
      dispatch({ type: 'altm-up' });
    }
  };

  const onBlur = (): void => dispatch({ type: 'window-blur' });
  // happy-dom keeps document.hidden false, so the event itself is the signal.
  const onVisibility = (): void => dispatch({ type: 'page-hidden' });
  const onPageHide = (): void => dispatch({ type: 'pagehide' });

  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('mousedown', onMouseDown);
  button.addEventListener('pointerup', onPointerUp);
  button.addEventListener('pointercancel', onPointerCancel);
  button.addEventListener('lostpointercapture', onLostCapture);
  button.addEventListener('click', onClick);
  button.addEventListener('contextmenu', onContextMenu);
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keyup', onKeyUp);
  doc.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('blur', onBlur);
  win?.addEventListener('pagehide', onPageHide);

  return {
    attach(p: VoicePort): void {
      if (disposed) return;
      unsubscribe?.();
      port = p;
      unsubscribe = p.onView(render);
      render(p.getView());
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
      port = null;
      hideAll();
      button.removeEventListener('pointerdown', onPointerDown);
      button.removeEventListener('mousedown', onMouseDown);
      button.removeEventListener('pointerup', onPointerUp);
      button.removeEventListener('pointercancel', onPointerCancel);
      button.removeEventListener('lostpointercapture', onLostCapture);
      button.removeEventListener('click', onClick);
      button.removeEventListener('contextmenu', onContextMenu);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('blur', onBlur);
      win?.removeEventListener('pagehide', onPageHide);
    },
  };
}
