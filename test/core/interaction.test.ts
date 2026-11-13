import { afterEach, describe, expect, it } from 'vitest';
import { INTERACTION_DOCS, createInteraction } from '../../src/util';
import type { Interaction, KeyInfo, MouseInfo } from '../../src/util';

const made: Interaction[] = [];
const make = (...args: Parameters<typeof createInteraction>): Interaction => {
  const interaction = createInteraction(...args);
  made.push(interaction);
  return interaction;
};
afterEach(() => {
  for (const interaction of made.splice(0)) interaction.clear();
  document.body.replaceChildren();
});

const key = (type: string, init: KeyboardEventInit, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, composed: true, ...init }));

const move = (target: EventTarget, clientX: number, clientY: number, bubbles = true) =>
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles, clientX, clientY }));

describe('createInteraction', () => {
  it('keyPress and keyRelease call back with the key, and stop when told to', () => {
    const { keyPress, keyRelease } = make();
    const down: KeyInfo[] = [];
    const up: string[] = [];
    const stop = keyPress((info) => down.push(info));
    keyRelease((info) => up.push(info.key));
    key('keydown', { key: 'a', code: 'KeyA' });
    key('keyup', { key: 'a', code: 'KeyA' });
    expect(down.map((info) => [info.key, info.code, info.repeat])).toEqual([['a', 'KeyA', false]]);
    expect(down[0]!.event).toBeInstanceOf(KeyboardEvent);
    expect(up).toEqual(['a']);
    stop();
    key('keydown', { key: 'b', code: 'KeyB' });
    expect(down.length).toBe(1);
  });

  it('leaves out the repeats of a held key unless asked for them', () => {
    const { keyPress } = make();
    const once: string[] = [];
    const all: string[] = [];
    keyPress((info) => once.push(info.key));
    keyPress((info) => all.push(info.key), { repeat: true });
    key('keydown', { key: 'a' });
    key('keydown', { key: 'a', repeat: true });
    key('keydown', { key: 'a', repeat: true });
    expect(once).toEqual(['a']);
    expect(all).toEqual(['a', 'a', 'a']);
  });

  it('leaves out keys typed into a text box or an editor, unless whileTyping is set', () => {
    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(input, editable);
    const heard: string[] = [];
    make().keyPress((info) => heard.push(info.key));
    const typing: string[] = [];
    make(document, { whileTyping: true }).keyPress((info) => typing.push(info.key));
    key('keydown', { key: 'a' }, input);
    key('keydown', { key: 'b' }, editable);
    key('keydown', { key: 'c' });
    expect(heard).toEqual(['c']);
    expect(typing).toEqual(['a', 'b', 'c']);
  });

  it('mouseMovement gives the place on the page as 0 to 1', () => {
    const moves: MouseInfo[] = [];
    make().mouseMovement((info) => moves.push(info));
    move(document.body, 0, 0);
    move(document.body, window.innerWidth / 2, window.innerHeight);
    move(document.body, window.innerWidth * 2, -50);
    expect(moves.map((info) => [info.x, info.y])).toEqual([
      [0, 0],
      [0.5, 1],
      [1, 0],
    ]);
  });

  it('measures across an element when given one', () => {
    const box = document.createElement('div');
    box.style.cssText = 'position: fixed; left: 100px; top: 50px; width: 200px; height: 100px';
    document.body.append(box);
    const moves: number[][] = [];
    make(box).mouseMovement((info) => moves.push([info.x, info.y]));
    move(box, 150, 125);
    move(document.body, 150, 125, false);
    expect(moves).toEqual([[0.25, 0.75]]);
  });

  it('clear removes everything added through it, and nothing added through another', () => {
    const first = make();
    const second = make();
    const heard: string[] = [];
    first.keyPress(() => heard.push('first press'));
    first.keyRelease(() => heard.push('first release'));
    first.mouseMovement(() => heard.push('first move'));
    second.keyPress(() => heard.push('second press'));
    first.clear();
    key('keydown', { key: 'a' });
    key('keyup', { key: 'a' });
    move(document.body, 10, 10);
    expect(heard).toEqual(['second press']);
  });

  it('offers the helpers by name, with the names Cracked used, and documents each', () => {
    const { helpers, keyPress, mouseMovement } = make();
    expect(helpers['key_press']).toBe(keyPress);
    expect(helpers['mouse_movement']).toBe(mouseMovement);
    for (const doc of INTERACTION_DOCS) {
      expect(typeof helpers[doc.name]).toBe('function');
      if (doc.alias) expect(helpers[doc.alias]).toBe(helpers[doc.name]);
    }
    expect(INTERACTION_DOCS.map((doc) => doc.name).sort()).toEqual(
      Object.keys(helpers)
        .filter((name) => !name.includes('_'))
        .sort(),
    );
  });
});
