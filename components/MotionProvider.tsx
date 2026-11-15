"use client";

import { MotionConfig } from "motion/react";

// Motion honours prefers-reduced-motion everywhere (design system: Motion).
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
