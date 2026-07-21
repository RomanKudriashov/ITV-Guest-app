import { useCallback, useRef } from 'react';

function uuid(): string {
  const cryptoObj = window.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  // Fallback for non-secure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * One `Idempotency-Key` per checkout ATTEMPT.
 *
 * The key is generated once for a given request signature and reused for every
 * retry of that exact body — that is what makes "Retry" safe: the server answers
 * 200 with the already-created order instead of creating a second one.
 *
 * When the guest changes the order (different signature) a new key is minted,
 * otherwise the server would answer 409 `idempotency_conflict`.
 */
export function useIdempotencyKey(signature: string): [string, () => void] {
  const signatureRef = useRef<string | null>(null);
  const keyRef = useRef<string>('');

  if (signatureRef.current !== signature) {
    signatureRef.current = signature;
    keyRef.current = uuid();
  }

  // Called after a successful checkout so the next order starts a fresh key.
  const rotate = useCallback(() => {
    signatureRef.current = null;
    keyRef.current = '';
  }, []);

  return [keyRef.current, rotate];
}
