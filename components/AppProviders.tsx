"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/overlay";
import { Toaster } from "@/components/ui/toast";

// Motion honours prefers-reduced-motion everywhere (design system: Motion) and loads its animation
// features after first paint (strict: a full `motion` component throws); tooltips share one delay;
// toasts mount once.
const motionFeatures = () => import("@/lib/motionFeatures").then((r) => r.default);

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={motionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <Toaster>{children}</Toaster>
        </TooltipProvider>
      </MotionConfig>
    </LazyMotion>
  );
}
