/**
 * `cracked-up/inspect`: a graph view for debugging. It draws a scope's nodes, buses and connections,
 * meters every output on screen, and shows the details of a node you click.
 *
 * It is separate from the core, which does not import it, and it has no dependencies.
 */

export { createInspector } from './inspector';
export type { Inspector, InspectorOptions, InspectorStats, InspectorTheme } from './inspector';
export { openInspector, toggleInspector } from './window';
export type { InspectorWindow, InspectorWindowOptions } from './window';

// The parts the inspector is made of, for hosts that want to draw the graph or meter it their own way.
export { buildModel, busDetail, nodeDetail, readScope, signature } from './model';
export type {
  Expanded,
  Handle,
  NodeDetail,
  ParamDetail,
  ScopeReading,
  ScopeSource,
  SignalKind,
  TypeFacts,
  ViewEdge,
  ViewGraph,
  ViewNode,
  ViewNodeKind,
} from './model';
export { edgePath, layout } from './layout';
export type {
  Box,
  EdgeRoute,
  LayoutEdge,
  LayoutNode,
  LayoutOptions,
  LayoutResult,
  Point,
} from './layout';
export { LevelMeter, RangeMeter, measure, toDb } from './meter';
export type { BlockStats } from './meter';
export { TapSet } from './taps';
