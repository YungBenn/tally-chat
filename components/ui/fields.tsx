"use client";

import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { IconAlertCircle, IconCheck, IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type FieldProps = { label?: React.ReactNode; help?: React.ReactNode; error?: React.ReactNode };

/** Label, control, then the error (with icon) or the help line. Ids link them for screen readers. */
function Field({
  label,
  help,
  error,
  id,
  className,
  children,
}: FieldProps & { id: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("tc-field", className)}>
      {label && (
        <label className="tc-field-label" htmlFor={id}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="tc-field-error tc-fade-in" id={`${id}-msg`}>
          <IconAlertCircle size={14} stroke={1.5} />
          {error}
        </span>
      ) : help ? (
        <span className="tc-field-help" id={`${id}-msg`}>
          {help}
        </span>
      ) : null}
    </div>
  );
}

function useFieldId(id?: string) {
  const auto = React.useId();
  return id ?? auto;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement>, FieldProps {
  mono?: boolean;
  fieldClassName?: string;
}

/** Text field. Mono for URLs, keys and money. No holo on inputs. */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, help, error, mono, id, className, fieldClassName, ...rest },
  ref,
) {
  const fid = useFieldId(id);
  const input = (
    <input
      ref={ref}
      id={fid}
      className={cn("tc-input", mono && "tc-input-mono", className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || help ? `${fid}-msg` : undefined}
      {...rest}
    />
  );
  if (!label && !help && !error) return input;
  return (
    <Field label={label} help={help} error={error} id={fid} className={fieldClassName}>
      {input}
    </Field>
  );
});

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldProps {
  mono?: boolean;
  fieldClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, help, error, mono, id, className, fieldClassName, ...rest },
  ref,
) {
  const fid = useFieldId(id);
  const area = (
    <textarea
      ref={ref}
      id={fid}
      className={cn("tc-input", mono && "tc-input-mono", className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || help ? `${fid}-msg` : undefined}
      {...rest}
    />
  );
  if (!label && !help && !error) return area;
  return (
    <Field label={label} help={help} error={error} id={fid} className={fieldClassName}>
      {area}
    </Field>
  );
});

export type SelectOption<V extends string> = { value: V; label: React.ReactNode; group?: string };

/** Listbox for 4 or more options (use SegmentedControl for 2 or 3). */
export function Select<V extends string>({
  value,
  onValueChange,
  options,
  placeholder = "Select",
  label,
  help,
  error,
  mono,
  disabled,
  icon,
  id,
  className,
  "aria-label": ariaLabel,
}: FieldProps & {
  value: V | null;
  onValueChange: (v: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const fid = useFieldId(id);
  const current = options.find((o) => o.value === value);
  const groups = [...new Set(options.map((o) => o.group))];
  const trigger = (
    <BaseSelect.Root
      value={value}
      onValueChange={(v) => v != null && onValueChange(v as V)}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        id={fid}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || help ? `${fid}-msg` : undefined}
        className={cn("tc-input tc-select", mono && "tc-input-mono", className)}
      >
        <span className={cn("tc-select-value", !current && "tc-ph")}>
          {icon}
          {current ? current.label : placeholder}
        </span>
        <IconChevronDown size={14} stroke={1.5} style={{ color: "var(--foreground-subtle)" }} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} alignItemWithTrigger={false} className="tc-layer-popover">
          <BaseSelect.Popup className="tc-float tc-menu tc-pop">
            {groups.map((g) => (
              <BaseSelect.Group key={g ?? ""}>
                {g && <BaseSelect.GroupLabel className="tc-menu-label">{g}</BaseSelect.GroupLabel>}
                {options
                  .filter((o) => o.group === g)
                  .map((o) => (
                    <BaseSelect.Item key={o.value} value={o.value} className="tc-menu-item">
                      <BaseSelect.ItemText className={cn(mono && "tc-mono")}>{o.label}</BaseSelect.ItemText>
                      <BaseSelect.ItemIndicator className="tc-menu-check">
                        <IconCheck size={14} stroke={1.5} />
                      </BaseSelect.ItemIndicator>
                    </BaseSelect.Item>
                  ))}
              </BaseSelect.Group>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
  if (!label && !help && !error) return trigger;
  return (
    <Field label={label} help={help} error={error} id={fid}>
      {trigger}
    </Field>
  );
}

/** For settings that apply immediately. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <label className={cn("tc-check", className)} aria-disabled={disabled || undefined}>
      <BaseSwitch.Root
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="tc-switch"
      />
      {label}
    </label>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("tc-check", className)} aria-disabled={disabled || undefined}>
      <BaseCheckbox.Root
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v)}
        disabled={disabled}
        className="tc-box"
      >
        <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.5 6.2l2.3 2.3 4.7-5"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={20}
          />
        </svg>
      </BaseCheckbox.Root>
      {label}
    </label>
  );
}

/** Two to four mutually exclusive options shown at once. Arrow keys move between them. */
export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  label,
  disabled,
  className,
}: {
  value: V;
  onValueChange: (v: V) => void;
  options: { value: V; label: React.ReactNode; icon?: React.ReactNode; title?: string }[];
  size?: "sm" | "md";
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      className={cn("tc-seg", size === "sm" && "tc-seg-sm", className)}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            disabled={disabled}
            className="tc-seg-item"
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
