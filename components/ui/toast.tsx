"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";

type Tone = "success" | "danger" | "warning" | "info";
const icons = {
  success: IconCircleCheck,
  danger: IconAlertCircle,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
};

const manager = BaseToast.createToastManager();

/** Show a toast from anywhere: toast({ title: "Saved" }). */
export function toast({ title, body, tone = "success" }: { title: string; body?: string; tone?: Tone }) {
  manager.add({ title, description: body, type: tone, timeout: 4000 });
}

function Toasts() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((t) => {
    const tone = (t.type ?? "success") as Tone;
    const Icon = icons[tone];
    return (
      <BaseToast.Root key={t.id} toast={t} className="tc-float tc-toast tc-toast-anim">
        <Icon size={18} stroke={1.5} style={{ color: `var(--${tone})`, marginTop: 1, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <BaseToast.Title className="tc-toast-title" />
          <BaseToast.Description className="tc-toast-body" />
        </div>
        <BaseToast.Close className="tc-btn tc-btn-ghost tc-btn-sm tc-btn-icon" aria-label="Dismiss">
          <IconX size={14} stroke={1.5} />
        </BaseToast.Close>
      </BaseToast.Root>
    );
  });
}

/** Mount once at the root. */
export function Toaster({ children }: { children: React.ReactNode }) {
  return (
    <BaseToast.Provider toastManager={manager}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="tc-toast-viewport">
          <Toasts />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
