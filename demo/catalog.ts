/**
 * What the demo pages tell the editor before audio starts. The node types need an engine, and an
 * engine needs a context; a one-sample offline context makes no sound and needs no user gesture.
 */

import { createEngine } from '../src';
import type { NodeTypeInfo } from '../src';
import type { BufferEntry } from '../src/editor';
import { BREAK } from './break';

export async function builtinTypes(): Promise<readonly NodeTypeInfo[]> {
  const engine = await createEngine({ context: new OfflineAudioContext(1, 1, 44100) });
  const types = engine.registry.list();
  engine.dispose();
  return types;
}

/** The sounds both demo pages load, known by name before they have loaded. */
export const DEMO_BUFFERS: readonly BufferEntry[] = [
  { key: 'kick', description: 'A kick drum made by this page.' },
  { key: 'snare', description: 'A snare drum made by this page.' },
  { key: 'hat', description: 'A hi-hat made by this page.' },
  { key: BREAK.key, slices: 128, description: 'A drum break.' },
];
