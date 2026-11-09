'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  DockviewDefaultTab,
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react';
import { AudioLines, Database, Plus, Video, type LucideIcon } from 'lucide-react';
import { readPlacement, writePlacement, prunePlacement } from '@/lib/teleop/placement';
import type { Panel } from '@/lib/teleop/types';
import type { Prefill } from './add-visualization';
import { useRuntime } from './context';
import { Cameras } from './media';
import { ControlPanel } from './control-panel';
import { SeriesPane } from './series-pane';
import { VisualizationView } from './visualizations';

const KIND_ICONS: Record<string, LucideIcon> = {
  data: Database,
  video: Video,
  audio: AudioLines,
};
const KIND_LABELS: Record<string, string> = {
  data: 'Data',
  video: 'Video',
  audio: 'Audio',
};

function TopicKind({ kind }: { kind: string }) {
  const Icon = KIND_ICONS[kind];
  const label = KIND_LABELS[kind] ?? kind;
  if (!Icon) return <span className={`topic-kind kind-${kind}`}>{kind}</span>;
  return (
    <span
      className={`topic-kind topic-kind-icon kind-${kind}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon size={12} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

const ActionsContext = createContext<{
  edit(id: string, prefill?: Prefill): void;
}>({
  edit: () => {},
});

function Catalog() {
  const runtime = useRuntime();
  const actions = useContext(ActionsContext);
  const [tab, setTab] = useState<'topics' | 'panels' | 'events'>('topics');
  return (
    <div className="workspace-catalog">
      <div className="catalog-tabs">
        {(['topics', 'panels', 'events'] as const).map((name) => (
          <button aria-pressed={tab === name} onClick={() => setTab(name)} key={name}>
            {name}
          </button>
        ))}
      </div>
      {tab === 'topics' && (
        <>
          <p className="muted">
            Publication metadata only. Browsing does not subscribe to telemetry.
          </p>
          {runtime.catalog().map((pub) => (
            <details className="topic-entry" key={`${pub.kind}:${pub.name}`}>
              <summary>
                <TopicKind kind={pub.kind} />
                <span>{pub.name}</span>
                <span className="muted">
                  {pub.excluded
                    ? 'excluded'
                    : !pub.available
                      ? 'unavailable'
                      : pub.kind === 'data' && pub.encoding !== 'json'
                        ? 'unsupported'
                        : 'available'}
                </span>
              </summary>
              <dl>
                <dt>Robot</dt>
                <dd>{pub.robot}</dd>
                <dt>Exact track</dt>
                <dd>{pub.name}</dd>
                <dt>Schema ID</dt>
                <dd>{pub.msgType ?? 'Not published'}</dd>
                <dt>Encoding</dt>
                <dd>{pub.encoding ?? 'Not published'}</dd>
                <dt>Current publication</dt>
                <dd>{pub.available ? pub.id : 'Absent (binding preserved)'}</dd>
                {pub.error && (
                  <>
                    <dt>Subscription</dt>
                    <dd>{pub.error}</dd>
                  </>
                )}
              </dl>
              {pub.excluded && (
                <p>
                  Blocked by the robot’s current {pub.kind} exclusions. No subscription or
                  monitoring demand is created.
                </p>
              )}
              {!pub.excluded && (
                <div className="topic-actions">
                  <button
                    className="primary"
                    disabled={!pub.available || (pub.kind === 'data' && pub.encoding !== 'json')}
                    onClick={() => actions.edit('new', { kind: pub.kind, track: pub.name })}
                    aria-label={`Add visualization for ${pub.name}`}
                  >
                    <Plus size={12} strokeWidth={2} aria-hidden="true" />
                    Add visualization
                  </button>
                </div>
              )}
            </details>
          ))}
        </>
      )}
      {tab === 'panels' && (
        <>
          {!runtime.layout?.panel_order.length && (
            <p className="muted">Add a visualization to start building your workspace.</p>
          )}
          {runtime.layout?.panel_order.map((id) => {
            const panel = runtime.layout!.panels[id];
            const pub = runtime
              .catalog()
              .find((p) => p.kind === panel.source.kind && p.name === panel.source.track_name);
            return (
              <div className="saved-panel" key={id}>
                <strong>{panel.label}</strong>
                <p>{panel.source.track_name}</p>
                <span className="muted">
                  {pub?.excluded
                    ? 'excluded'
                    : !pub?.available
                      ? 'unavailable'
                      : panel.visible
                        ? 'in workspace'
                        : 'hidden · not_requested'}
                </span>
                <div>
                  <button
                    onClick={() => {
                      const layout = runtime.layout!;
                      const panels = {
                        ...layout.panels,
                        [id]: { ...panel, visible: !panel.visible },
                      };
                      runtime.editLayout({
                        ...layout,
                        panels,
                        workspace: prunePlacement(
                          layout.workspace,
                          layout.panel_order.filter((key) => panels[key].visible),
                        ),
                      });
                    }}
                  >
                    {panel.visible ? 'Hide' : 'Show'}
                  </button>
                  <button onClick={() => actions.edit(id)}>Settings</button>
                </div>
              </div>
            );
          })}
        </>
      )}
      {tab === 'events' && (
        <>
          <p className="muted">
            Connection and outage transitions. Individual dropped frames are not failures.
          </p>
          {runtime.notices.map((notice, index) => (
            <p className="event-entry" key={index}>
              {notice}
            </p>
          ))}
          {[...runtime.streams.incidents, ...runtime.cameras.incidents]
            .sort((a, b) => a.at - b.at)
            .map((incident, i) => (
              <p className="event-entry" key={i}>
                {incident.input} · {incident.transition}
                {incident.duration !== undefined
                  ? ` after ${(incident.duration / 1000).toFixed(1)}s`
                  : ''}
              </p>
            ))}
        </>
      )}
    </div>
  );
}

function DockPanel(props: IDockviewPanelProps) {
  const runtime = useRuntime();
  const actions = useContext(ActionsContext);
  const subscribeVisibility = useCallback(
    (notify: () => void) => {
      const event = props.api.onDidVisibilityChange(notify);
      return () => event.dispose();
    },
    [props.api],
  );
  const visibilitySnapshot = useCallback(() => props.api.isVisible, [props.api]);
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, visibilitySnapshot);
  const [paneOpen, setPaneOpen] = useState(false);
  const id = props.api.id;
  if (id === '@cameras') return <Cameras />;
  if (id === '@controls') return <ControlPanel active={visible} />;
  if (id === '@catalog') return <Catalog />;
  const panel = runtime.layout?.panels[id];
  if (!panel) return null;
  const change = (remove: boolean) => {
    const layout = runtime.layout!;
    const panels = { ...layout.panels };
    if (remove) delete panels[id];
    else panels[id] = { ...panel, visible: false };
    const order = layout.panel_order.filter((key) => !remove || key !== id);
    runtime.editLayout({
      ...layout,
      panels,
      panel_order: order,
      workspace: prunePlacement(
        layout.workspace,
        order.filter((key) => panels[key].visible),
      ),
    });
  };
  return (
    <div className="visualization-panel">
      <div className="panel-toolbar">
        <span title={panel.source.track_name}>{panel.source.track_name}</span>
        <div>
          <select
            aria-label={`Move ${panel.label}`}
            value=""
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'float')
                props.containerApi.addFloatingGroup(props.containerApi.getPanel(id)!);
              else {
                const target = props.containerApi.getPanel('@cameras')?.group;
                if (target)
                  props.api.moveTo({
                    group: target,
                    position: value as 'left' | 'right' | 'top' | 'bottom' | 'center',
                  });
              }
            }}
          >
            <option value="">Move…</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="top">Above</option>
            <option value="bottom">Below</option>
            <option value="center">Tab with cameras</option>
            <option value="float">Float</option>
          </select>
          <button
            onClick={() =>
              panel.visualization === 'plot' ? setPaneOpen((open) => !open) : actions.edit(id)
            }
            aria-label={`Settings for ${panel.label}`}
            aria-expanded={panel.visualization === 'plot' ? paneOpen : undefined}
          >
            Settings
          </button>
          <button onClick={() => change(false)} aria-label={`Hide ${panel.label}`}>
            Hide
          </button>
          <button onClick={() => change(true)} aria-label={`Remove ${panel.label}`}>
            ×
          </button>
        </div>
      </div>
      <div className="panel-body">
        <VisualizationView id={id} panel={panel} active={visible && panel.visible} />
        {paneOpen && panel.visualization === 'plot' && (
          <SeriesPane
            panel={panel}
            onSave={(next) => updatePanel(runtime, id, next)}
            onClose={() => setPaneOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
const components = { workspace: DockPanel };
const titles: Record<string, string> = {
  '@cameras': 'Live cameras',
  '@controls': 'Controls',
  '@catalog': 'Topics & panels',
};

export function WorkspaceHost({ onEdit }: { onEdit(id: string, prefill?: Prefill): void }) {
  const runtime = useRuntime();
  const api = useRef<DockviewApi | null>(null);
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null);
  const signatures = JSON.stringify(
    runtime.layout?.panel_order.map((id) => [
      id,
      runtime.layout!.panels[id].visible,
      runtime.layout!.panels[id].label,
    ]),
  );
  const ready = ({ api: dock }: DockviewReadyEvent) => {
    api.current = dock;
    setDockApi(dock);
    const layout = runtime.layout;
    if (layout?.workspace) {
      try {
        dock.fromJSON(writePlacement(layout.workspace, layout, dock.width, dock.height));
      } catch (error) {
        runtime.notices.push(
          `Placement could not be restored: ${(error as Error).message}. Using a default arrangement.`,
        );
        dock.clear();
      }
    }
    for (const id of ['@cameras', '@controls', '@catalog'])
      if (!dock.getPanel(id))
        dock.addPanel({
          id,
          title: titles[id],
          component: 'workspace',
          renderer: 'always',
          position:
            id === '@controls'
              ? { referencePanel: '@cameras', direction: 'right' }
              : id === '@catalog'
                ? { referencePanel: '@controls', direction: 'within' }
                : undefined,
          initialWidth: id === '@cameras' ? 900 : 360,
        });
    reconcile(dock);
  };
  const reconcile = useCallback(
    (dock: DockviewApi) => {
      const layout = runtime.layout;
      if (!layout) return;
      for (const panel of dock.panels)
        if (!panel.id.startsWith('@') && !layout.panels[panel.id]?.visible) dock.removePanel(panel);
      for (const id of layout.panel_order) {
        const panel = layout.panels[id];
        if (!panel.visible) continue;
        const existing = dock.getPanel(id);
        if (existing) {
          if (existing.title !== panel.label) existing.api.setTitle(panel.label);
        } else {
          const existingPanels = dock.panels.filter((p) => !p.id.startsWith('@'));
          const last = existingPanels.at(-1);
          dock.addPanel({
            id,
            title: panel.label,
            component: 'workspace',
            renderer: 'always',
            position: last
              ? {
                  referencePanel: last.id,
                  direction: existingPanels.length < 3 ? 'right' : 'within',
                }
              : { referencePanel: '@cameras', direction: 'below' },
            minimumHeight: 190,
            minimumWidth: 230,
            initialHeight: 280,
          });
        }
      }
    },
    [runtime],
  );
  useEffect(() => {
    if (api.current) reconcile(api.current);
  }, [signatures, runtime, reconcile]);
  useEffect(() => {
    if (!dockApi) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!runtime.layout) return;
        try {
          runtime.editLayout({
            ...runtime.layout,
            workspace: readPlacement(dockApi.toJSON()),
          });
        } catch (error) {
          runtime.notices.push(`Placement save failed: ${(error as Error).message}`);
          runtime.notify();
        }
      }, 350);
    };
    const event = dockApi.onDidLayoutChange(save);
    save();
    return () => {
      clearTimeout(timer);
      event.dispose();
    };
  }, [dockApi, runtime]);
  return (
    <ActionsContext.Provider value={{ edit: onEdit }}>
      <DockviewReact
        className="workspace-dock"
        theme={themeDark}
        components={components}
        defaultTabComponent={(props) => <DockviewDefaultTab {...props} hideClose />}
        getTabContextMenuItems={() => ['maximize', 'float']}
        floatingGroupBounds="boundedWithinViewport"
        onReady={ready}
      />
    </ActionsContext.Provider>
  );
}

export function updatePanel(runtime: ReturnType<typeof useRuntime>, id: string, panel: Panel) {
  const layout = runtime.layout;
  if (!layout) return;
  runtime.editLayout({
    ...layout,
    panels: { ...layout.panels, [id]: panel },
    panel_order: layout.panel_order.includes(id) ? layout.panel_order : [...layout.panel_order, id],
  });
}
