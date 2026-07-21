import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'itv.tracker.sound';

/**
 * The new-order chime.
 *
 * Two deliberate decisions:
 *
 *  1. **Autoplay policy.** Browsers refuse to start audio without a user
 *     gesture, so sound is opt-in behind a button; the choice is remembered in
 *     localStorage and the AudioContext is created (and resumed) inside the
 *     click handler, which is the only moment the browser will allow it.
 *  2. **No audio file.** The signal is synthesized with WebAudio — a couple of
 *     short sine blips — so nothing binary has to be shipped or cached.
 */
export function useTrackerSound() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const contextRef = useRef<AudioContext | null>(null);

  const ensureContext = useCallback((): AudioContext | null => {
    if (contextRef.current) return contextRef.current;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      contextRef.current = new Ctor();
      return contextRef.current;
    } catch {
      return null;
    }
  }, []);

  const beep = useCallback(
    (context: AudioContext, startAt: number, frequency: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      // Soft attack/decay: a kitchen hears it, nobody jumps.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.24);
    },
    [],
  );

  const play = useCallback(() => {
    if (!enabled) return;
    const context = ensureContext();
    if (!context) return;
    void context.resume().catch(() => undefined);
    const now = context.currentTime;
    beep(context, now, 880);
    beep(context, now + 0.26, 1174);
  }, [enabled, ensureContext, beep]);

  const toggle = useCallback(() => {
    setEnabled((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
      if (next) {
        // Inside the click handler — the only place the browser unlocks audio.
        const context = ensureContext();
        if (context) {
          void context.resume().catch(() => undefined);
          beep(context, context.currentTime, 880);
        }
      }
      return next;
    });
  }, [ensureContext, beep]);

  useEffect(
    () => () => {
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    },
    [],
  );

  return { enabled, toggle, play };
}
