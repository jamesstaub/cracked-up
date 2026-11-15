import { describe, expect, it } from 'vitest';
import {
  addSlice,
  moveSlice,
  normalizeSlices,
  removeSlice,
  sliceAt,
  sliceByOnsets,
  sliceByTempo,
  sliceGrid,
} from './slices';

describe('slice grids', () => {
  it('sliceGrid: equal parts, optionally moved later', () => {
    expect(sliceGrid(2, 4)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(sliceGrid(2, 2, 0.25)).toEqual([0.25, 1.25, 2.25]);
    expect(sliceGrid(3, 0)).toEqual([0, 3]);
    expect(sliceGrid(1, 1e9)).toHaveLength(4097);
  });

  it('sliceByTempo: one boundary per step, the end of the sound last', () => {
    expect(sliceByTempo(2, 120, '1/4')).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(sliceByTempo(15, 128)).toEqual(sliceGrid(15, 128));
    // A first hit a little in, and a sound that ends part-way through a step.
    expect(sliceByTempo(1.8, 120, '1/4', 0.1)).toEqual([0.1, 0.6, 1.1, 1.6, 1.8]);
    expect(sliceByTempo(2, 120, 1)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(() => sliceByTempo(2, 0)).toThrow(RangeError);
    expect(sliceByTempo(1000, 300, '1/64').length).toBeLessThanOrEqual(4097);
  });

  it('sliceByOnsets: the start, every hit, and the end', () => {
    const data = new Float32Array(48000);
    for (const time of [0, 0.25, 0.5, 0.75]) data[time * 48000] = 1;
    expect(sliceByOnsets({ sampleRate: 48000, channels: [data] })).toEqual([0, 0.25, 0.5, 0.75, 1]);
    // A first hit a moment in is a boundary of its own.
    const late = new Float32Array(48000);
    for (const time of [0.1, 0.6]) late[time * 48000] = 1;
    expect(sliceByOnsets({ sampleRate: 48000, channels: [late] })).toEqual([0, 0.1, 0.6, 1]);
    expect(sliceByOnsets({ sampleRate: 48000, channels: [new Float32Array(48000)] })).toEqual([
      0, 1,
    ]);
  });
});

describe('editing slice boundaries', () => {
  it('normalizeSlices sorts, drops repeats and what is not a number, and keeps inside the sound', () => {
    expect(normalizeSlices([1, 0, 1, Number.NaN, 0.5, Infinity])).toEqual([0, 0.5, 1]);
    expect(normalizeSlices([-1, 0.5, 3], 2)).toEqual([0, 0.5, 2]);
    expect(normalizeSlices([-1, 0, 3, 2], 2)).toEqual([0, 2]);
  });

  it('addSlice puts a boundary in its place and returns a new list', () => {
    const before = Object.freeze([0, 1, 2]);
    expect(addSlice(before, 1.5)).toEqual([0, 1, 1.5, 2]);
    expect(addSlice(before, 1.5).indexOf(1.5)).toBe(2);
    expect(before).toEqual([0, 1, 2]);
    // On top of one that is there, or outside the sound: nothing is added.
    expect(addSlice(before, 1)).toEqual([0, 1, 2]);
    expect(addSlice(before, 1.0004)).toEqual([0, 1, 2]);
    expect(addSlice(before, 2.5, 2)).toEqual([0, 1, 2]);
    expect(addSlice(before, -0.1)).toEqual([0, 1, 2]);
    expect(addSlice(before, Number.NaN)).toEqual([0, 1, 2]);
    expect(addSlice(before, 2.5)).toEqual([0, 1, 2, 2.5]);
  });

  it('moveSlice keeps a boundary between its neighbours, so order and count never change', () => {
    const before = [0, 1, 2];
    expect(moveSlice(before, 1, 1.25)).toEqual([0, 1.25, 2]);
    expect(moveSlice(before, 1, 5)).toEqual([0, 1.999, 2]);
    expect(moveSlice(before, 1, -5)).toEqual([0, 0.001, 2]);
    expect(moveSlice(before, 0, 0.5)).toEqual([0.5, 1, 2]);
    expect(moveSlice(before, 0, -1)).toEqual([0, 1, 2]);
    expect(moveSlice(before, 2, 9, 3)).toEqual([0, 1, 3]);
    expect(moveSlice(before, 2, 9)).toEqual([0, 1, 9]);
    expect(moveSlice(before, 7, 1.5)).toEqual([0, 1, 2]);
    expect(moveSlice([0, 0.001, 0.0015], 1, 1)).toEqual([0, 0.001, 0.0015]);
    expect(before).toEqual([0, 1, 2]);
  });

  it('removeSlice takes one boundary out', () => {
    expect(removeSlice([0, 1, 2], 1)).toEqual([0, 2]);
    expect(removeSlice([0, 1, 2], 5)).toEqual([0, 1, 2]);
    expect(removeSlice([0, 2], 0)).toEqual([2]);
  });

  it('sliceAt says which slice holds a time', () => {
    expect(sliceAt([0, 1, 2], 0)).toBe(0);
    expect(sliceAt([0, 1, 2], 1)).toBe(1);
    expect(sliceAt([0, 1, 2], 1.99)).toBe(1);
    expect(sliceAt([0, 1, 2], 2)).toBe(-1);
    expect(sliceAt([0.5, 1], 0.2)).toBe(-1);
    expect(sliceAt([], 0)).toBe(-1);
  });
});
