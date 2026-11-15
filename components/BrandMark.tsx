"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HoloGradient } from "@/components/ui/feedback";
import { duration, ease } from "@/lib/motion";

/**
 * The tally.chat mark: a holo-outlined rounded square, a lowercase t whose crossbar is a tally
 * slash in accent, and four ruler ticks. `draw` draws it in once (first load, sign-in); never loops.
 * Geometry from docs/design/system/assets/Logos/tally-mark.svg.
 */
export default function BrandMark({
  size = 32,
  wordmark,
  draw,
}: {
  size?: number;
  wordmark?: boolean;
  draw?: boolean;
}) {
  const id = useId();
  // Reduced motion: the mark is simply drawn (pathLength is not a transform, so MotionConfig skips nothing).
  const reduced = useReducedMotion();
  const animate = draw && !reduced;
  const path = (i: number) =>
    animate
      ? {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: {
            pathLength: { duration: duration.draw, ease: ease.inOut, delay: i * 0.12 },
            opacity: { duration: 0.01, delay: i * 0.12 },
          },
        }
      : {};
  return (
    <span className="inline-flex items-center" style={{ gap: Math.round(size / 3.2) }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="tally.chat">
        <defs>
          <HoloGradient id={id} x1={4} y1={4} x2={44} y2={44} />
        </defs>
        <motion.rect
          x={3.5}
          y={3.5}
          width={41}
          height={41}
          rx={12}
          stroke={`url(#${id})`}
          strokeWidth={1.5}
          {...path(0)}
        />
        <motion.path
          d="M22 11v21.5c0 3 1.8 4.5 4.5 4.5H30"
          stroke="var(--foreground)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...path(1)}
        />
        <motion.path
          d="M14.5 21.5L31.5 16.5"
          stroke="var(--accent)"
          strokeWidth={3}
          strokeLinecap="round"
          {...path(2)}
        />
        <motion.path
          d="M12 39v2.5M16 39v2.5M32 39v2.5M36 39v2.5"
          stroke={`url(#${id})`}
          strokeLinecap="round"
          opacity={0.8}
          {...path(3)}
        />
      </svg>
      {wordmark && (
        <span
          aria-hidden
          style={{ font: `600 ${Math.round(size * 0.56)}px/1 var(--font-sans)`, letterSpacing: "-0.03em" }}
        >
          tally<span style={{ color: "var(--foreground-subtle)", fontWeight: 400 }}>.chat</span>
        </span>
      )}
    </span>
  );
}
