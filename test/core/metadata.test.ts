import { describe, expect, it } from 'vitest';
import { offlineEngine } from './setup';

/**
 * The docs page builds its node reference from the registry. These checks keep that reference
 * complete: a node type or parameter added without a description fails here.
 */
describe('node metadata', () => {
  it('describes every built-in type, parameter and option', async () => {
    const engine = await offlineEngine(0.01);
    const missing: string[] = [];
    for (const info of engine.registry.list()) {
      if (!info.description) missing.push(`${info.type}: description`);
      for (const param of info.params) {
        if (!param.description) missing.push(`${info.type}.${param.name}: description`);
      }
      for (const [name, option] of Object.entries({ ...info.options, ...info.triggerOptions })) {
        if (!option.description || !option.type) missing.push(`${info.type} option ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives number parameters a default inside their control range', async () => {
    const engine = await offlineEngine(0.01);
    const outside: string[] = [];
    for (const info of engine.registry.list()) {
      for (const param of info.params) {
        if (param.kind !== 'number') continue;
        if (!(param.min < param.max) || param.default < param.min || param.default > param.max) {
          outside.push(`${info.type}.${param.name}`);
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it('documents the creation options the sampler and oscillators read', async () => {
    const engine = await offlineEngine(0.01);
    expect(Object.keys(engine.registry.describe('sampler').options)).toEqual([
      'buffer',
      'choke',
      'voices',
    ]);
    expect(Object.keys(engine.registry.describe('sine').options)).toEqual(['gate']);
    expect(Object.keys(engine.registry.describe('sampler').triggerOptions)).toContain('slice');
    expect(engine.registry.describe('gain').triggerOptions).toEqual({});
  });
});
