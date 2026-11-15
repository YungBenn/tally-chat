"use client";

// Dev-only gallery of components/ui for the phase 8 browser pass. Removed in ticket 15.
import { useState } from "react";
import { notFound } from "next/navigation";
import {
  IconArrowsMinimize,
  IconCopy,
  IconLayoutSidebarRight,
  IconMessagePlus,
  IconRefresh,
  IconSend2,
  IconTrash,
} from "@tabler/icons-react";
import BrandMark from "@/components/BrandMark";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Divider,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Kbd,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  ProgressBar,
  SegmentedControl,
  Select,
  Sheet,
  SheetClose,
  Skeleton,
  Spinner,
  Switch,
  Textarea,
  toast,
} from "@/components/ui";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="tc-panel-label">{title}</p>
      <div className="tc-row">{children}</div>
    </section>
  );
}

export default function UiGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  const [mode, setMode] = useState<"quick" | "normal" | "long">("normal");
  const [model, setModel] = useState<string | null>("sonnet");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState<"left" | "bottom" | null>(null);
  return (
    <main className="tc mx-auto flex max-w-[960px] flex-col gap-8 p-10">
      <h1 className="text-title">components/ui</h1>
      <Row title="Brand">
        <BrandMark size={16} />
        <BrandMark size={22} wordmark />
        <BrandMark size={40} draw />
      </Row>
      <Row title="Buttons">
        <Button variant="primary" icon={<IconSend2 />}>
          Send
        </Button>
        <Button icon={<IconMessagePlus />}>
          New thread <Kbd>⌘⇧O</Kbd>
        </Button>
        <Button variant="outline" icon={<IconArrowsMinimize />}>
          Condense now
        </Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger" icon={<IconTrash />}>
          Delete thread
        </Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button disabled>Disabled</Button>
        <Button size="sm" icon={<IconRefresh />}>
          Retry
        </Button>
        <Button variant="primary" size="lg">
          Sign in
        </Button>
        <IconButton icon={<IconCopy />} label="Copy" kbd="⌘⇧C" size="sm" />
        <IconButton icon={<IconLayoutSidebarRight />} label="Toggle inspector" kbd="⌘I" />
      </Row>
      <Row title="Fields">
        <Input label="Base URL" mono placeholder="https://api.anthropic.com" help="Requests go here." />
        <Input label="API key" mono defaultValue="sk-ant" error="The provider rejected this key." />
        <Textarea label="System prompt" rows={3} placeholder="You are a precise assistant." />
        <Select
          label="Side-job model"
          value={model}
          onValueChange={setModel}
          options={[
            { value: "haiku", label: "Haiku 5.5", group: "Anthropic" },
            { value: "sonnet", label: "Sonnet 5.5", group: "Anthropic" },
            { value: "gpt", label: "GPT-5.2", group: "OpenAI" },
          ]}
        />
      </Row>
      <Row title="Controls">
        <SegmentedControl
          label="Output mode"
          size="sm"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "quick", label: "Quick" },
            { value: "normal", label: "Normal" },
            { value: "long", label: "Long" },
          ]}
        />
        <Switch checked={on} onCheckedChange={setOn} label="Keepalive" />
        <Checkbox checked={checked} onCheckedChange={setChecked} label="Don't ask again" />
      </Row>
      <Row title="Badges and meters">
        <Badge tone="cached">cached</Badge>
        <Badge tone="write">written</Badge>
        <Badge tone="fresh">fresh</Badge>
        <Badge tone="success" dot>
          Connected
        </Badge>
        <Badge tone="warning" dot>
          Near limit
        </Badge>
        <Badge tone="danger" dot>
          Sending paused
        </Badge>
        <Badge tone="live">Streaming</Badge>
        <Spinner />
        <div style={{ width: 160 }}>
          <ProgressBar value={37} label="37%" />
        </div>
        <div style={{ width: 160 }}>
          <ProgressBar value={84} label="84%" />
        </div>
        <div style={{ width: 160 }}>
          <ProgressBar value={100} label="100%" />
        </div>
        <Skeleton width={120} />
      </Row>
      <Divider holo />
      <Row title="Overlays">
        <Popover trigger={<Button>Breakdown</Button>} title="Reply cost">
          <p className="text-body-sm text-foreground-muted">Settled numbers live here.</p>
        </Popover>
        <Menu trigger={<Button>Thread actions</Button>}>
          <MenuLabel>Thread</MenuLabel>
          <MenuItem hint="⌘⇧C">Copy last reply</MenuItem>
          <MenuItem check>Keepalive</MenuItem>
          <MenuSeparator />
          <MenuItem danger icon={<IconTrash size={15} stroke={1.5} />}>
            Delete thread
          </MenuItem>
        </Menu>
        <Button onClick={() => setDialog(true)}>Dialog</Button>
        <Button onClick={() => setSheet("left")}>Left sheet</Button>
        <Button onClick={() => setSheet("bottom")}>Bottom sheet</Button>
        <Button onClick={() => toast({ title: "Settings saved" })}>Toast</Button>
        <Button onClick={() => toast({ title: "Could not save", body: "Value unchanged.", tone: "danger" })}>
          Error toast
        </Button>
      </Row>
      <EmptyState
        title="No usage yet"
        description="Send a message and its cost shows up here."
        action={<Button variant="primary">Start a thread</Button>}
      />
      <ErrorState
        title="Reply failed"
        actions={
          <Button size="sm" icon={<IconRefresh />}>
            Retry
          </Button>
        }
      >
        The provider returned <code className="tc-mono">529 overloaded</code>. Nothing was charged.
      </ErrorState>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Editing this message costs ~$0.08 more than continuing."
        description="The edit rewrites the cached history after this point."
        icon={<IconRefresh size={18} stroke={1.5} />}
        actions={
          <>
            <Button onClick={() => setDialog(false)}>Continue instead</Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Edit anyway
            </Button>
          </>
        }
      />
      <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)} side={sheet ?? "left"} title="Sheet">
        <div className="flex items-center justify-between p-4">
          <span className="text-subheading">Sheet</span>
          <SheetClose />
        </div>
      </Sheet>
    </main>
  );
}
