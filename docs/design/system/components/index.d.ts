import type * as React from 'react';

export type CacheLayerState = 'cached' | 'write' | 'fresh';
export type CacheTemp = 'warm' | 'cooling' | 'cold';

/** Tabler icon name (outline set, stroke 1.5). */
export interface IconProps { name: string; size?: 14 | 16 | 20 | number; stroke?: number; label?: string; className?: string }
export interface LogoProps { size?: number; wordmark?: boolean; draw?: boolean }
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: string; iconRight?: string; iconOnly?: boolean; loading?: boolean;
  /** Holo edge + sweep. Defaults to true for primary only. */
  holo?: boolean;
}
export interface IconButtonProps extends Omit<ButtonProps, 'children'> { icon: string; label: string }
export interface InputProps { label?: string; value?: string; placeholder?: string; help?: string; error?: string; disabled?: boolean; mono?: boolean; type?: string }
export interface TextareaProps extends InputProps { rows?: number }
export interface SelectProps { label?: string; value?: string; placeholder?: string; icon?: string; disabled?: boolean; error?: string }
export interface CheckboxProps { label?: React.ReactNode; checked?: boolean; disabled?: boolean }
export interface SwitchProps extends CheckboxProps {}
export interface RadioGroupProps { options: string[]; value?: string; disabled?: string[] }
export interface SegmentedControlProps { options: (string | { value: string; label: string; icon?: string })[]; value?: string; size?: 'sm' | 'md'; label?: string }
export interface SliderProps { label?: string; value?: number; steps?: number; format?: (v: number) => string; disabled?: boolean }
export interface TooltipProps { content: React.ReactNode; kbd?: string; children?: React.ReactNode }
export interface PopoverProps { title?: string; live?: boolean; children?: React.ReactNode }
export interface MenuItem { label: string; icon?: string; hint?: string; check?: boolean; danger?: boolean; active?: boolean; heading?: boolean }
export interface MenuProps { items: (MenuItem | '-')[] }
export interface DialogProps { title: string; description?: React.ReactNode; icon?: string; tone?: 'warning' | 'danger' | 'info'; actions?: React.ReactNode; children?: React.ReactNode }
export interface SheetProps { title: string; side?: 'right' | 'bottom'; children?: React.ReactNode }
export interface ToastProps { title: string; body?: string; tone?: 'success' | 'danger' | 'warning' | 'info'; action?: string }
export interface TabsProps { tabs: (string | { value: string; label: string; count?: number })[]; value?: string }
export interface BadgeProps { tone?: 'cached' | 'write' | 'fresh' | 'live' | 'success' | 'warning' | 'danger' | 'info' | 'accent'; dot?: boolean; icon?: string; children?: React.ReactNode }
export interface AvatarProps { name?: string; icon?: string; size?: 'sm' | 'md' | 'lg'; live?: boolean }
export interface ProgressBarProps { value?: number; indeterminate?: boolean; label?: string; tone?: 'near' | 'paused' }
export interface DividerProps { holo?: boolean; label?: string }
export interface EmptyStateProps { title: string; description: string; action?: React.ReactNode }

export interface ThreadItemProps { title: string; active?: boolean; unread?: boolean; streaming?: boolean; cost?: string }
export interface BranchSwitcherProps { index?: number; count?: number }
export interface ReplyMetaProps { model: string; effort?: string; cost: string; input: string; cached: string; output: string }
export interface UserMessageProps { branch?: BranchSwitcherProps; attachments?: React.ReactNode; children: React.ReactNode }
export interface AssistantMessageProps { meta?: ReplyMetaProps; branch?: BranchSwitcherProps; streaming?: boolean; truncated?: boolean; thinking?: ThinkingIndicatorProps; children: React.ReactNode }
export interface CodeBlockProps { code: string; lang?: string; filename?: string; lineNumbers?: boolean }
export interface AttachmentChipProps { name: string; meta?: string; kind?: 'image' | 'file'; loading?: boolean; error?: string; removable?: boolean }
export interface CostStripProps { next?: string; cache?: CacheTemp; hit?: string; remaining?: number; warning?: string }
export interface ComposerProps { value?: string; focus?: boolean; disabled?: boolean; streaming?: boolean; model?: string; effort?: 'low' | 'medium' | 'high' | 'max'; mode?: 'quick' | 'normal' | 'long'; attachments?: React.ReactNode; banner?: React.ReactNode; cost?: CostStripProps; strip?: boolean }
export interface CacheStatusProps { state?: CacheTemp; time?: string; remaining?: number; compact?: boolean }
export interface ThinkingIndicatorProps { label?: string; elapsed?: string }
export interface CheckpointMarkerProps { label?: string; detail?: string }
export interface ContextLayer { name: string; tokens: number; state: CacheLayerState; selected?: boolean }
export interface ContextBarProps { layers: ContextLayer[]; max?: number; zoom?: number }
export interface LayerRowProps { name: string; state: CacheLayerState; tokens: string; price: string; icon?: string; selected?: boolean }
export interface BudgetBannerProps { state: 'near' | 'paused' }
export interface ErrorStateProps { title?: string; body?: React.ReactNode; action?: string; secondary?: string }
export interface StatTileProps { label: string; value: string; delta?: string; dir?: 'up-good' | 'up-bad' | 'neg'; highlight?: boolean; tilt?: boolean; hero?: boolean }
export interface LegendProps { items?: { name: string; key: string; value?: string }[] }
export interface ProviderCardProps { name: string; url: string; mono?: string; models?: string[]; status?: 'connected' | 'error' | 'untested'; selected?: boolean }

export declare function Icon(p: IconProps): React.ReactElement;
export declare function Logo(p: LogoProps): React.ReactElement;
export declare function Button(p: ButtonProps): React.ReactElement;
export declare function IconButton(p: IconButtonProps): React.ReactElement;
export declare function Input(p: InputProps): React.ReactElement;
export declare function Textarea(p: TextareaProps): React.ReactElement;
export declare function Select(p: SelectProps): React.ReactElement;
export declare function Checkbox(p: CheckboxProps): React.ReactElement;
export declare function Radio(p: CheckboxProps & { onSelect?: () => void }): React.ReactElement;
export declare function RadioGroup(p: RadioGroupProps): React.ReactElement;
export declare function Switch(p: SwitchProps): React.ReactElement;
export declare function SegmentedControl(p: SegmentedControlProps): React.ReactElement;
export declare function Slider(p: SliderProps): React.ReactElement;
export declare function Tooltip(p: TooltipProps): React.ReactElement;
export declare function Popover(p: PopoverProps): React.ReactElement;
export declare function DropdownMenu(p: MenuProps): React.ReactElement;
export declare function Dialog(p: DialogProps): React.ReactElement;
export declare function Sheet(p: SheetProps): React.ReactElement;
export declare function Toast(p: ToastProps): React.ReactElement;
export declare function Tabs(p: TabsProps): React.ReactElement;
export declare function Badge(p: BadgeProps): React.ReactElement;
export declare function Kbd(p: { children: React.ReactNode }): React.ReactElement;
export declare function Avatar(p: AvatarProps): React.ReactElement;
export declare function Skeleton(p: { width?: number | string; height?: number }): React.ReactElement;
export declare function Spinner(p: { size?: number; label?: string }): React.ReactElement;
export declare function ProgressBar(p: ProgressBarProps): React.ReactElement;
export declare function Divider(p: DividerProps): React.ReactElement;
export declare function EmptyState(p: EmptyStateProps): React.ReactElement;
export declare function ThreadItem(p: ThreadItemProps): React.ReactElement;
export declare function UserMessage(p: UserMessageProps): React.ReactElement;
export declare function AssistantMessage(p: AssistantMessageProps): React.ReactElement;
export declare function ReplyMetadata(p: ReplyMetaProps): React.ReactElement;
export declare function BranchSwitcher(p: BranchSwitcherProps): React.ReactElement;
export declare function Markdown(p: { children: React.ReactNode }): React.ReactElement;
export declare function CodeBlock(p: CodeBlockProps): React.ReactElement;
export declare function AttachmentChip(p: AttachmentChipProps): React.ReactElement;
export declare function Composer(p: ComposerProps): React.ReactElement;
export declare function CostStrip(p: CostStripProps): React.ReactElement;
export declare function CacheStatus(p: CacheStatusProps): React.ReactElement;
export declare function ThinkingIndicator(p: ThinkingIndicatorProps): React.ReactElement;
export declare function CheckpointMarker(p: CheckpointMarkerProps): React.ReactElement;
export declare function ContextBar(p: ContextBarProps): React.ReactElement;
export declare function LayerRow(p: LayerRowProps): React.ReactElement;
export declare function Inspector(p: { layers?: ContextLayer[]; cache?: CacheTemp }): React.ReactElement;
export declare function BudgetBanner(p: BudgetBannerProps): React.ReactElement;
export declare function CacheBreakWarning(p: {}): React.ReactElement;
export declare function ErrorState(p: ErrorStateProps): React.ReactElement;
export declare function StatTile(p: StatTileProps): React.ReactElement;
export declare function BarChart(p: { data?: number[][]; legend?: boolean }): React.ReactElement;
export declare function LineChart(p: { data?: number[] }): React.ReactElement;
export declare function DataTable(p: {}): React.ReactElement;
export declare function Legend(p: LegendProps): React.ReactElement;
export declare function ProviderCard(p: ProviderCardProps): React.ReactElement;
export declare function ProviderForm(p: {}): React.ReactElement;
export declare function SettingsSection(p: {}): React.ReactElement;
export declare function SignInCard(p: { draw?: boolean; error?: boolean; loading?: boolean }): React.ReactElement;
export declare function ThreadView(p: { inspector?: boolean }): React.ReactElement;
/** Renders children once per theme (light, dark) for previews. */
export declare function Stage(p: { side?: boolean; children: (theme: 'light' | 'dark') => React.ReactNode }): React.ReactElement;

declare global { interface Window { Tally: Record<string, unknown> } }
