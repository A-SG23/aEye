/**
 * The pixel-art eye, only ever at integer multiples of its native size.
 *
 * Native dimensions are measured from the file rather than hardcoded, so
 * replacing the asset is a genuine drop-in — a logo of any grid size renders
 * at the correct aspect ratio without touching this component. Scaling by a
 * fraction would resample the pixel edges into mush, so `scale` is rounded to
 * an integer and the rendered size is computed from it rather than being left
 * to CSS layout.
 */
import { useEffect, useState } from 'react';

const SRC = `${import.meta.env.BASE_URL}aeye-logo.png`.replace(/\/{2,}/g, '/');

interface Native {
  width: number;
  height: number;
}

/** Measured once per session, so only the very first render has to wait. */
let cached: Native | null = null;
let pending: Promise<Native> | null = null;

function measure(): Promise<Native> {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      cached = { width: img.naturalWidth, height: img.naturalHeight };
      resolve(cached);
    };
    // A broken asset should not blank the whole shell.
    img.onerror = () => {
      cached = { width: 0, height: 0 };
      resolve(cached);
    };
    img.src = SRC;
  });
  return pending;
}

export function Logo({ scale = 2, className }: { scale?: number; className?: string }) {
  const [native, setNative] = useState<Native | null>(cached);

  useEffect(() => {
    if (native) return;
    let live = true;
    measure().then((n) => live && setNative(n));
    return () => {
      live = false;
    };
  }, [native]);

  const factor = Math.max(1, Math.round(scale));

  // Hold the space but stay invisible until measured, so the logo does not
  // flash at 1x before snapping to size.
  if (!native || native.width === 0) {
    return <span className={className} aria-hidden style={{ display: 'inline-block' }} />;
  }

  return (
    <img
      src={SRC}
      alt="aEye"
      className={className}
      width={native.width * factor}
      height={native.height * factor}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
