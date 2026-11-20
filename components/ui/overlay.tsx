"use client";

import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { IconCheck, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Kbd } from "./feedback";

type Side = "top" | "bottom" | "left" | "right";

/** Dark tooltip with an optional shortcut. Wrap the trigger element. */
export function Tooltip({
  content,
  kbd,
  side = "top",
  children,
}: {
  content: React.ReactNode;
  kbd?: string;
  side?: Side;
  children: React.ReactElement;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="tc-layer-tooltip">
          <BaseTooltip.Popup className="tc-tooltip tc-pop">
            {content}
            {kbd && <Kbd>{kbd}</Kbd>}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/** One provider for the whole app so tooltips share a delay. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <BaseTooltip.Provider delay={500} closeDelay={0}>
      {children}
    </BaseTooltip.Provider>
  );
}

/** Floating detail panel. `live` adds a subtle holo edge, only for content that updates in real time. */
export function Popover({
  trigger,
  title,
  live,
  side = "bottom",
  align = "start",
  open,
  onOpenChange,
  initialFocus,
  className,
  children,
}: {
  trigger: React.ReactElement;
  title?: React.ReactNode;
  live?: boolean;
  side?: Side;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialFocus?: React.ComponentProps<typeof BasePopover.Popup>["initialFocus"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={6} className="tc-layer-popover">
          <BasePopover.Popup
            className={cn("tc-float tc-popover tc-pop", live && "holo-border holo-subtle", className)}
            initialFocus={initialFocus}
          >
            {title && <BasePopover.Title className="tc-popover-title">{title}</BasePopover.Title>}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** Action list from a trigger. Compose with MenuItem, MenuLabel and MenuSeparator. */
export function Menu({
  trigger,
  side = "bottom",
  align = "start",
  open,
  onOpenChange,
  className,
  children,
}: {
  trigger: React.ReactElement;
  side?: Side;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={6} className="tc-layer-popover">
          <BaseMenu.Popup className={cn("tc-float tc-menu tc-pop", className)}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export function MenuItem({
  icon,
  hint,
  check,
  danger,
  disabled,
  onClick,
  className,
  children,
}: {
  icon?: React.ReactNode;
  /** Shortcut or a number, right-aligned in mono. */
  hint?: React.ReactNode;
  /** true: selected; false: unselected but keeps the check column aligned. */
  check?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseMenu.Item
      className={cn("tc-menu-item", className)}
      data-danger={danger ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="tc-menu-text">{children}</span>
      {(check || hint != null) && (
        <span className="tc-menu-end">
          {hint != null && <span className="tc-menu-hint">{hint}</span>}
          {check !== undefined && (
            <IconCheck
              size={14}
              stroke={1.5}
              className="tc-menu-check"
              aria-label={check ? "Selected" : undefined}
              style={check ? undefined : { visibility: "hidden" }}
            />
          )}
        </span>
      )}
    </BaseMenu.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="tc-menu-label">{children}</div>;
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="tc-menu-sep" />;
}

/** Modal for decisions that cost money or can't be undone. Focus starts on `initialFocus` when given. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  tone = "warning",
  actions,
  initialFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "warning" | "danger" | "info";
  actions?: React.ReactNode;
  initialFocus?: React.RefObject<HTMLElement | null>;
  children?: React.ReactNode;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="tc-scrim" />
        <BaseDialog.Popup
          className="tc-dialog tc-dialog-modal holo-border holo-subtle"
          initialFocus={initialFocus}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            {icon && (
              <span className="tc-dialog-icon" data-tone={tone}>
                {icon}
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <BaseDialog.Title render={<h3 />}>{title}</BaseDialog.Title>
              {description && <BaseDialog.Description render={<p />}>{description}</BaseDialog.Description>}
            </div>
          </div>
          {children}
          {actions && <div className="tc-dialog-actions">{actions}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Edge panel for small screens: the sidebar (left), the inspector (bottom). Traps focus, Esc and scrim close. */
export function Sheet({
  open,
  onOpenChange,
  side,
  title,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right" | "bottom";
  /** Accessible name; shown as a header only when `header` content is not supplied by children. */
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="tc-scrim" />
        <BaseDialog.Popup
          className={cn("tc-sheet-panel holo-border holo-subtle", className)}
          data-side={side}
          aria-label={title}
        >
          {side === "bottom" && <div className="tc-sheet-grip" aria-hidden />}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export function SheetClose({ label = "Close" }: { label?: string }) {
  return (
    <BaseDialog.Close className="tc-btn tc-btn-ghost tc-btn-sm tc-btn-icon" aria-label={label}>
      <IconX size={14} stroke={1.5} />
    </BaseDialog.Close>
  );
}
