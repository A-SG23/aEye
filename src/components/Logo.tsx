/**
 * The pixel-art eye, only ever at integer multiples of its native size.
 *
 * The native grid is 21x13 (scripts/make-logo.mjs). Scaling by a fraction
 * would resample the pixel edges into mush, so `scale` is an integer and the
 * rendered size is computed from it rather than from CSS layout.
 */
const NATIVE_W = 21;
const NATIVE_H = 13;

export function Logo({ scale = 2, className }: { scale?: number; className?: string }) {
  const factor = Math.max(1, Math.round(scale));
  return (
    <img
      src={`${import.meta.env.BASE_URL}aeye-logo.png`.replace(/\/{2,}/g, '/')}
      alt="aEye"
      className={className}
      width={NATIVE_W * factor}
      height={NATIVE_H * factor}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
