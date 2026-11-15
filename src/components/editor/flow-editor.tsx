'use client';

import '@xyflow/react/dist/style.css';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeMouseHandler,
  type NodeChange,
  type OnNodesChange,
  type OnSelectionChangeParams,
  type XYPosition,
} from '@xyflow/react';
import { format } from 'date-fns';
import { ArrowLeft, Clock, Copy, Loader2, PanelLeft, Play, Save, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { ApiClientError, createFlow, getFlow, runFlow, updateFlow } from '@/lib/api-client';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Flow, FlowGraph, FlowRun, FlowStatus, NodeKind } from '@/types';
import { CATEGORY_COLORS, NODE_DEFAULTS, PALETTE, type PaletteItem } from './editor-meta';
import { nodeTypes, type WireIttNode, type WireIttNodeData } from './flow-nodes';
import { PropsPanel } from './props-panel';
import { RunPanel } from './run-panel';

// ============================================================
// FlowEditor — full-screen visual wiring canvas
// ============================================================

export interface FlowEditorProps {
  flowId: string | null;
  onBack: () => void;
  onSaved: (flow: Flow) => void;
  /** Optional: open the run history for this flow (used by the test-run drawer). */
  onViewRuns?: (flowId: string) => void;
}

const SAMPLE_WEBHOOK_PAYLOAD = '{\n  "body": { "hello": "world" },\n  "query": {},\n  "headers": {}\n}';
const RUN_PANEL_HEIGHT = 300;

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const isTriggerKind = (kind: NodeKind | string) => kind.startsWith('trigger.');

/** react-flow node -> server FlowNode (the save contract; runStatus is dropped). */
function toFlowNodes(nodes: WireIttNode[]): FlowGraph['nodes'] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.data.kind,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: n.data.config,
  }));
}

function toFlowEdges(edges: Edge[]): FlowGraph['edges'] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
  }));
}

function snapshotFor(name: string, status: FlowStatus, nodes: WireIttNode[], edges: Edge[]): string {
  return JSON.stringify({ name, status, nodes: toFlowNodes(nodes), edges: toFlowEdges(edges) });
}

async function copyToClipboard(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error('Could not copy to clipboard');
  }
}

// ---------------- palette ----------------

function PaletteButton({ item, onAdd }: { item: PaletteItem; onAdd: (kind: NodeKind) => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/wireitt', item.kind);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onAdd(item.kind)}
      className="flex w-full cursor-grab items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <span
        aria-hidden
        className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', CATEGORY_COLORS[item.category])}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{item.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
      </span>
    </button>
  );
}

function PaletteContent({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  const triggers = PALETTE.filter((i) => i.category === 'trigger');
  const actions = PALETTE.filter((i) => i.category === 'action');
  return (
    <div className="flex flex-col gap-4 p-3">
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Triggers</h3>
        {triggers.map((item) => (
          <PaletteButton key={item.kind} item={item} onAdd={onAdd} />
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</h3>
        {actions.map((item) => (
          <PaletteButton key={item.kind} item={item} onAdd={onAdd} />
        ))}
      </section>
    </div>
  );
}

// ============================================================
// Editor
// ============================================================

function FlowEditorInner({ flowId, onBack, onSaved, onViewRuns }: FlowEditorProps) {
  const { screenToFlowPosition } = useReactFlow();
  const isMobile = useIsMobile();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(flowId !== null);
  const [nodes, setNodes, onNodesChange] = useNodesState<WireIttNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState('Untitled flow');
  const [status, setStatus] = useState<FlowStatus>('paused');
  const [savedFlow, setSavedFlow] = useState<Flow | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [runPanelOpen, setRunPanelOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [run, setRun] = useState<FlowRun | null>(null);
  const [payloadText, setPayloadText] = useState('{}');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);

  // SSR guard — the canvas only renders after mount.
  useEffect(() => {
    setMounted(true);
  }, []);

  // ---------------- load / init ----------------
  useEffect(() => {
    if (!flowId) {
      const initial: WireIttNode[] = [
        {
          id: uid(),
          type: 'wireitt',
          position: { x: 120, y: 200 },
          data: { kind: 'trigger.manual', config: {} },
        },
      ];
      setNodes(initial);
      setEdges([]);
      setName('Untitled flow');
      setStatus('paused');
      setSavedFlow(null);
      setPayloadText('{}');
      setRun(null);
      setSelectedNodeId(null);
      setSavedSnapshot(snapshotFor('Untitled flow', 'paused', initial, []));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    getFlow(flowId)
      .then(({ flow }) => {
        if (cancelled) return;
        const mappedNodes: WireIttNode[] = flow.graph.nodes.map((n) => ({
          id: n.id,
          type: 'wireitt',
          position: { x: n.position.x, y: n.position.y },
          data: { kind: n.type, config: n.data ?? {} },
        }));
        const mappedEdges: Edge[] = flow.graph.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          type: 'smoothstep',
        }));
        setNodes(mappedNodes);
        setEdges(mappedEdges);
        setName(flow.name);
        setStatus(flow.status);
        setSavedFlow(flow);
        setSavedSnapshot(snapshotFor(flow.name, flow.status, mappedNodes, mappedEdges));
        setPayloadText(
          flow.graph.nodes.some((n) => n.type === 'trigger.webhook') ? SAMPLE_WEBHOOK_PAYLOAD : '{}'
        );
        setRun(null);
        setSelectedNodeId(null);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof ApiClientError ? e.message : 'Failed to load the flow');
        // fall back to an empty (clean) canvas rather than a false "dirty" state
        setNodes([]);
        setEdges([]);
        setName('Untitled flow');
        setStatus('paused');
        setSavedFlow(null);
        setSavedSnapshot(snapshotFor('Untitled flow', 'paused', [], []));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  // ---------------- derived ----------------

  const currentSnapshot = useMemo(
    () => snapshotFor(name, status, nodes, edges),
    [name, status, nodes, edges]
  );
  const dirty = currentSnapshot !== savedSnapshot;
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const hasWebhookTrigger = useMemo(() => nodes.some((n) => n.data.kind === 'trigger.webhook'), [nodes]);
  const nextRunAt = status === 'active' ? savedFlow?.schedule?.nextRunAt ?? null : null;

  // ---------------- node/edge handlers ----------------

  /** Wraps onNodesChange: clears run-status coloring on structural edits (not on select/measure). */
  const handleNodesChange: OnNodesChange<WireIttNode> = useCallback(
    (changes: NodeChange<WireIttNode>[]) => {
      const structural = changes.some((c) => c.type !== 'select' && c.type !== 'dimensions');
      if (!structural) {
        onNodesChange(changes);
        return;
      }
      setNodes((ns) =>
        applyNodeChanges(changes, ns).map((n) =>
          n.data.runStatus ? { ...n, data: { ...n.data, runStatus: undefined } } : n
        )
      );
    },
    [onNodesChange, setNodes]
  );

  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) => {
      const target = nodes.find((n) => n.id === connection.target);
      return !target || !isTriggerKind(target.data.kind);
    },
    [nodes]
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      const target = nodes.find((n) => n.id === params.target);
      if (target && isTriggerKind(target.data.kind)) {
        toast.error('A trigger node cannot receive connections');
        return;
      }
      setEdges((es) => addEdge({ ...params, id: uid(), type: 'smoothstep' }, es));
    },
    [nodes, setEdges]
  );

  const addNode = useCallback(
    (kind: NodeKind, position: XYPosition) => {
      if (isTriggerKind(kind) && nodes.some((n) => isTriggerKind(n.data.kind))) {
        toast.error('A flow can only have one trigger');
        return;
      }
      setNodes((ns) => [
        ...ns,
        {
          id: uid(),
          type: 'wireitt',
          position,
          data: { kind, config: { ...NODE_DEFAULTS[kind] } },
        },
      ]);
    },
    [nodes, setNodes]
  );

  /** Click-to-add position: right of the rightmost node (60px gap), cascading vertically. */
  const addNodeAtFreePosition = useCallback(
    (kind: NodeKind) => {
      const position: XYPosition =
        nodes.length === 0
          ? { x: 120, y: 200 }
          : {
              x: Math.max(...nodes.map((n) => n.position.x)) + 290,
              y: 160 + Math.min(nodes.length, 8) * 40,
            };
      addNode(kind, position);
    },
    [nodes, addNode]
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/wireitt');
      if (!raw || !Object.prototype.hasOwnProperty.call(NODE_DEFAULTS, raw)) return;
      const kind = raw as NodeKind;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(kind, position);
    },
    [addNode, screenToFlowPosition]
  );

  const handleDragOver = useCallback((event: ReactDragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleNodeDragStop = useCallback(() => {
    setNodes((ns) =>
      ns.some((n) => n.data.runStatus)
        ? ns.map((n) => (n.data.runStatus ? { ...n, data: { ...n.data, runStatus: undefined } } : n))
        : ns
    );
  }, [setNodes]);

  const handleNodeClick = useCallback<NodeMouseHandler<WireIttNode>>(
    (_event, node) => {
      setSelectedNodeId(node.id);
      if (isMobile) setPropsOpen(true);
    },
    [isMobile]
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams<WireIttNode, Edge>) => {
      setSelectedNodeId(selected.length === 1 ? selected[0].id : null);
    },
    []
  );

  const updateConfig = useCallback(
    (id: string, config: Record<string, unknown>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, config, runStatus: undefined } } : n))
      );
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedNodeId((cur) => (cur === id ? null : cur));
    },
    [setNodes, setEdges]
  );

  // ---------------- save / test run ----------------

  const save = useCallback(async (): Promise<Flow | null> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Flow name cannot be empty');
      return null;
    }
    const triggerCount = nodes.filter((n) => isTriggerKind(n.data.kind)).length;
    if (triggerCount === 0) {
      toast.error('Add a trigger node before saving');
      return null;
    }
    if (triggerCount > 1) {
      toast.error('A flow can only have one trigger');
      return null;
    }
    setSaving(true);
    try {
      const graph: FlowGraph = { nodes: toFlowNodes(nodes), edges: toFlowEdges(edges) };
      let flow: Flow;
      if (!savedFlow) {
        const { flow: created } = await createFlow({ name: trimmedName, graph });
        let current = created;
        if (created.status !== status) {
          const { flow: patched } = await updateFlow(created.id, { status });
          current = patched;
        }
        flow = current;
      } else {
        const { flow: updated } = await updateFlow(savedFlow.id, {
          name: trimmedName,
          graph,
          status,
        });
        flow = updated;
      }
      setSavedFlow(flow);
      setStatus(flow.status);
      setName(flow.name);
      setSavedSnapshot(snapshotFor(flow.name, flow.status, nodes, edges));
      onSaved(flow);
      toast.success('Flow saved');
      return flow;
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : 'Failed to save the flow');
      return null;
    } finally {
      setSaving(false);
    }
  }, [name, nodes, edges, status, savedFlow, onSaved]);

  const testRun = useCallback(async () => {
    let flow = savedFlow;
    if (!flow || dirty) {
      const saved = await save();
      if (!saved) return;
      flow = saved;
    }
    const trimmed = payloadText.trim();
    let payload: unknown = null;
    if (trimmed) {
      try {
        payload = JSON.parse(trimmed);
      } catch {
        toast.error('Payload must be valid JSON');
        setRunPanelOpen(true);
        return;
      }
    }
    setRunning(true);
    try {
      const { run: executed } = await runFlow(flow.id, payload, 'test');
      setRun(executed);
      setRunPanelOpen(true);
      setNodes((ns) =>
        ns.map((n) => {
          const step = executed.steps?.[n.id];
          const isTrigger = isTriggerKind(n.data.kind);
          const runStatus: WireIttNodeData['runStatus'] = step
            ? step.status
            : isTrigger && executed.status === 'success'
              ? 'success'
              : 'skipped';
          return { ...n, data: { ...n.data, runStatus } };
        })
      );
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : 'Test run failed');
      setRunPanelOpen(true);
    } finally {
      setRunning(false);
    }
  }, [savedFlow, dirty, save, payloadText]);

  const handleBack = useCallback(() => {
    if (dirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
    onBack();
  }, [dirty, onBack]);

  // Cmd/Ctrl+S saves.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  // ---------------- render ----------------

  if (loading || !mounted) {
    return (
      <div className="flex h-full flex-col bg-background" aria-busy="true" aria-label="Loading flow">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
          <Skeleton className="size-8" />
          <Skeleton className="h-6 w-40 sm:w-64" />
          <div className="flex-1" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-56 shrink-0 space-y-2 border-r p-3 md:block">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
          <div className="flex-1 space-y-6 p-8">
            <Skeleton className="h-16 w-64" />
            <Skeleton className="ml-72 h-16 w-64" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ---------- toolbar ---------- */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Back to flows"
          onClick={handleBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Input
          aria-label="Flow name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-40 border-none bg-transparent px-1 text-base font-medium shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent sm:w-64"
        />
        {dirty ? (
          <span role="status" aria-label="Unsaved changes" className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
        ) : (
          <span aria-hidden className="w-2 shrink-0" />
        )}
        <div className="flex items-center gap-1.5">
          <Switch
            checked={status === 'active'}
            onCheckedChange={(v) => setStatus(v ? 'active' : 'paused')}
            aria-label="Toggle flow status"
          />
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {status === 'active' ? 'Active' : 'Paused'}
          </span>
        </div>
        {nextRunAt && (
          <div
            className="hidden items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground lg:flex"
            title="Next scheduled run (UTC)"
          >
            <Clock className="size-3.5" />
            <span>next run {format(new Date(nextRunAt), 'MMM d HH:mm')} UTC</span>
          </div>
        )}
        {hasWebhookTrigger &&
          (savedFlow?.webhookUrl ? (
            <div className="hidden items-center gap-1 rounded-md border bg-card px-2 py-1 md:flex">
              <Webhook className="size-3.5 shrink-0 text-emerald-400" />
              <code className="max-w-48 truncate font-mono text-[11px] text-muted-foreground">
                {savedFlow.webhookUrl}
              </code>
              <button
                type="button"
                aria-label="Copy webhook URL"
                onClick={() => void copyToClipboard(savedFlow.webhookUrl as string, 'Copied')}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Copy className="size-3" />
              </button>
            </div>
          ) : (
            <Badge variant="outline" className="hidden text-[11px] font-normal text-muted-foreground md:inline-flex">
              Save to get webhook URL
            </Badge>
          ))}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 md:hidden"
          aria-label="Open node palette"
          onClick={() => setPaletteOpen(true)}
        >
          <PanelLeft className="size-4" />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void testRun()} disabled={running || saving}>
          {running ? <Loader2 className="animate-spin" /> : <Play className="size-4" />}
          Test run
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving || (!!savedFlow && !dirty)}>
          {saving ? <Loader2 className="animate-spin" /> : <Save className="size-4" />}
          Save
        </Button>
      </header>

      {/* ---------- body ---------- */}
      <div className="flex min-h-0 flex-1">
        {/* palette (desktop) */}
        <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r md:flex">
          <PaletteContent onAdd={addNodeAtFreePosition} />
        </aside>

        {/* canvas */}
        <main
          className="relative min-w-0 flex-1 overflow-hidden transition-[padding-bottom] duration-300"
          style={{ paddingBottom: runPanelOpen ? RUN_PANEL_HEIGHT : 0 }}
        >
          <ReactFlow<WireIttNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedNodeId(null)}
            onSelectionChange={handleSelectionChange}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onNodeDragStop={handleNodeDragStop}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { stroke: '#52525b', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#52525b', width: 18, height: 18 },
            }}
            connectionLineStyle={{ stroke: '#52525b', strokeWidth: 2 }}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: false }}
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={() => '#3f3f46'}
              maskColor="rgb(9 9 11 0.7)"
              className="!bg-card !border-border"
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <p className="text-sm text-muted-foreground">
                Drag a node from the palette, or click one to add it
              </p>
            </div>
          )}

          <RunPanel
            open={runPanelOpen}
            onClose={() => setRunPanelOpen(false)}
            running={running}
            payload={payloadText}
            onPayloadChange={setPayloadText}
            onRun={() => void testRun()}
            run={run}
            onFlowClick={
              onViewRuns && savedFlow ? () => onViewRuns(savedFlow.id) : undefined
            }
          />
        </main>

        {/* props panel (desktop) */}
        {selectedNode ? (
          <div className="hidden h-full shrink-0 md:block">
            <PropsPanel
              node={selectedNode}
              onChange={(config) => updateConfig(selectedNode.id, config)}
              onDelete={() => deleteNode(selectedNode.id)}
              onClose={() => setSelectedNodeId(null)}
              webhookUrl={savedFlow?.webhookUrl ?? null}
              flowSaved={!!savedFlow}
            />
          </div>
        ) : null}
      </div>

      {/* palette (mobile) */}
      <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
        <SheetContent
          side="left"
          className="w-72 gap-0 overflow-y-auto p-0 sm:max-w-xs [&>button:last-child]:hidden"
        >
          <SheetHeader className="border-b">
            <SheetTitle className="text-sm">Add a node</SheetTitle>
            <SheetDescription className="text-xs">
              Drag onto the canvas, or tap a node to add it.
            </SheetDescription>
          </SheetHeader>
          <PaletteContent
            onAdd={(kind) => {
              addNodeAtFreePosition(kind);
              setPaletteOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      {/* props panel (mobile) */}
      {isMobile && (
        <Sheet open={propsOpen && !!selectedNode} onOpenChange={setPropsOpen}>
          <SheetContent
            side="right"
            aria-label="Node settings"
            className="w-80 gap-0 overflow-hidden p-0 sm:max-w-md [&>button:last-child]:hidden"
          >
            {selectedNode ? (
              <PropsPanel
                node={selectedNode}
                onChange={(config) => updateConfig(selectedNode.id, config)}
                onDelete={() => {
                  deleteNode(selectedNode.id);
                  setPropsOpen(false);
                }}
                onClose={() => setPropsOpen(false)}
                webhookUrl={savedFlow?.webhookUrl ?? null}
                flowSaved={!!savedFlow}
              />
            ) : (
              <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
                Select a node to edit its settings.
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
