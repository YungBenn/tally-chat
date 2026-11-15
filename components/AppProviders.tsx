"use client";

import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/overlay";
import { Toaster } from "@/components/ui/toast";

// Motion honours prefers-reduced-motion everywhere (design system: Motion); tooltips share one
// delay; toasts mount once.
export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Toaster>{children}</Toaster>
      </TooltipProvider>
    </MotionConfig>
  );
}
