"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./feedback";
import { Tooltip } from "./overlay";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** A Tabler icon element, sized by the button. */
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  iconOnly?: boolean;
  loading?: boolean;
  /** Holo edge + sweep. Defaults to true for primary only (Where holo goes). */
  holo?: boolean;
}

const iconSize = { sm: 14, md: 16, lg: 18 } as const;

function sized(icon: React.ReactNode, px: number) {
  return React.isValidElement<{ size?: number; stroke?: number }>(icon)
    ? React.cloneElement(icon, { size: px, stroke: 1.5 })
    : icon;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon,
    iconRight,
    iconOnly,
    loading,
    holo,
    disabled,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  const lit = (holo ?? variant === "primary") && !disabled && !loading;
  const px = iconSize[size];
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "tc-btn",
        `tc-btn-${variant}`,
        size !== "md" && `tc-btn-${size}`,
        iconOnly && "tc-btn-icon",
        lit && "holo-border holo-sweep",
        className,
      )}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={px - 2} /> : sized(icon, px)}
      {children != null && <span className="tc-btn-label">{children}</span>}
      {sized(iconRight, px)}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "iconOnly" | "size"> {
  icon: React.ReactNode;
  /** Becomes aria-label and the tooltip. */
  label: string;
  /** Shortcut shown in the tooltip, e.g. "⌘I". */
  kbd?: string;
  /** "touch" keeps the md button but gives it a 44px hit area (mobile headers). */
  size?: ButtonSize | "touch";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, kbd, size = "md", variant = "ghost", className, ...rest }, ref) {
    const button = (
      <Button
        ref={ref}
        variant={variant}
        size={size === "touch" ? "md" : size}
        iconOnly
        aria-label={label}
        className={cn(size === "touch" && "tc-btn-touch", className)}
        {...rest}
      />
    );
    return (
      <Tooltip content={label} kbd={kbd}>
        {button}
      </Tooltip>
    );
  },
);
