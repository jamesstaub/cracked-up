export interface RenderOptions {
  seconds: number;
  sampleRate?: number;
  channels?: number;
}

/** Build a graph on an OfflineAudioContext, render it, and return the result. */
export async function renderOffline(
  { seconds, sampleRate = 48000, channels = 2 }: RenderOptions,
  build: (ctx: OfflineAudioContext) => void | Promise<void>,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(channels, Math.round(seconds * sampleRate), sampleRate);
  await build(ctx);
  return ctx.startRendering();
}
