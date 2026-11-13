/**
 * The scripting API as data: the members of `__`, the transport, chains, selections, buses,
 * sequences, parameters and sequence events, with how to call them and what they do. Node types,
 * parameter setters and helpers are not here: those come from the catalog.
 *
 * The text follows the declarations in `src/api/`. A test checks that every method named here exists
 * on the real objects.
 */

export interface ApiMember {
  readonly name: string;
  /** How to call it. A property has none. */
  readonly signature?: string;
  readonly description: string;
  /** What the member gives back, when completion can continue from it. */
  readonly returns?: ReceiverKind | 'same';
}

/** An option of an options object: `{ at }`, `{ duration }`. */
export interface ApiOption {
  readonly name: string;
  readonly type: string;
  readonly default?: string;
  readonly description: string;
}

export type ReceiverKind =
  | 'dunder'
  | 'transport'
  | 'chain'
  | 'selection'
  | 'node'
  | 'bus'
  | 'sequence'
  | 'param'
  | 'event'
  | 'position';

const TARGET = 'a selector, a selection, a node, a bus or a parameter';

export const DUNDER_CALL: ApiMember = {
  name: '__',
  signature: '__(selector?)',
  description:
    "With no argument, starts a chain: __().saw().lowpass(500).to('main'). With a selector, selects existing nodes: __('#bass'), __('sampler'), __('.drums').",
};

export const API: Readonly<Record<ReceiverKind, readonly ApiMember[]>> = {
  dunder: [
    {
      name: 'transport',
      description: 'The transport: tempo, position, sequences, every and at.',
      returns: 'transport',
    },
    {
      name: 'bus',
      signature: 'bus(name)',
      description:
        "A named mix point, made on first use. It feeds 'main' until sent elsewhere with to().",
      returns: 'bus',
    },
    {
      name: 'scope',
      description: 'The scope this __ belongs to: its nodes, buses and sequences.',
    },
  ],
  transport: [
    { name: 'bpm', description: 'Tempo in beats per minute. Assign to change it.' },
    {
      name: 'swing',
      description: 'Default swing for sequences that do not set their own. 0.5 is straight.',
    },
    { name: 'timeSignature', description: '[beats per bar, beat unit], such as [4, 4].' },
    {
      name: 'stepLength',
      description: "Default step length for sequences and steps(). Starts as '1/16'.",
    },
    { name: 'state', description: "'stopped', 'started' or 'paused'." },
    {
      name: 'position',
      description: 'Where the transport is: beats, bar, beatInBar, seconds.',
      returns: 'position',
    },
    {
      name: 'loop',
      description: 'A region of the transport to loop, { start, end }, or null to play on.',
    },
    {
      name: 'sequence',
      signature: 'sequence(name?, options, callback)',
      description:
        'Adds a repeating pattern. The callback gets an event for each step, a little ahead of the sound. With a name, a later call with the same name replaces the earlier sequence in place and in time.',
      returns: 'sequence',
    },
    {
      name: 'steps',
      signature: 'steps(name?, pattern, callback)',
      description:
        'A sequence at the default step length whose callback gets (index, value, steps, event).',
      returns: 'sequence',
    },
    {
      name: 'every',
      signature: 'every(interval, callback, options?)',
      description: "Calls back repeatedly: every('4 bars', fn). options: { offset, order }.",
    },
    {
      name: 'at',
      signature: 'at(position, callback)',
      description: 'Calls back once at a position.',
    },
    {
      name: 'get',
      signature: 'get(name)',
      description: 'A named sequence of this scope, or undefined.',
      returns: 'sequence',
    },
    {
      name: 'clear',
      signature: 'clear(name?)',
      description:
        'Removes one named sequence, or with no name everything this scope has scheduled.',
      returns: 'same',
    },
    {
      name: 'seconds',
      signature: 'seconds(duration)',
      description: "Seconds a duration lasts at the current tempo: seconds('1 bar').",
    },
    {
      name: 'start',
      signature: 'start(options?)',
      description: 'Starts the transport. options: { at, from }.',
      returns: 'same',
    },
    {
      name: 'stop',
      signature: 'stop(options?)',
      description: 'Stops and returns to the start.',
      returns: 'same',
    },
    {
      name: 'pause',
      signature: 'pause(options?)',
      description: 'Stops and keeps the position.',
      returns: 'same',
    },
    {
      name: 'seek',
      signature: 'seek(position)',
      description: 'Moves to a position.',
      returns: 'same',
    },
    {
      name: 'toAudioTime',
      signature: 'toAudioTime(position)',
      description: 'The audio-clock time of a position.',
    },
    {
      name: 'toBeats',
      signature: 'toBeats(audioTime)',
      description: 'The position in beats of an audio-clock time.',
    },
    {
      name: 'on',
      signature: 'on(event, listener)',
      description:
        "Listens for 'tempo', 'start' or 'stop'. Returns a function that stops listening.",
    },
  ],
  chain: [
    {
      name: 'to',
      signature: 'to(bus)',
      description: "Ends the chain at a named bus: to('main').",
      returns: 'same',
    },
    {
      name: 'connect',
      signature: 'connect(target)',
      description: `Connects the tail to ${TARGET}. The chain continues from the same tail.`,
      returns: 'same',
    },
    {
      name: 'modulate',
      signature: 'modulate(target, param)',
      description:
        "Connects the tail to a parameter of the target, for modulators: modulate('#filter', 'frequency').",
      returns: 'same',
    },
    {
      name: 'split',
      signature: 'split(...branches)',
      description:
        'Parallel branches. Each function gets a chain starting at the current tail; the chain then continues from all the branch tails together.',
      returns: 'same',
    },
    {
      name: 'tail',
      description: 'The node or nodes the next call will connect from, as a selection.',
      returns: 'selection',
    },
    {
      name: 'nodes',
      description: 'Every node this chain has made, in order, as a selection.',
      returns: 'selection',
    },
  ],
  selection: [
    {
      name: 'set',
      signature: 'set(values, options?)',
      description:
        'Sets parameter values on every selected node that has the parameter: set({ frequency: 200 }).',
      returns: 'same',
    },
    {
      name: 'trigger',
      signature: 'trigger(options?)',
      description:
        "Starts a voice or opens the gate. Options: at, duration, the type's own trigger options, and any parameter value to use for this one trigger.",
      returns: 'same',
    },
    {
      name: 'release',
      signature: 'release(options?)',
      description: 'Closes the gate. options: { at, pitch }.',
      returns: 'same',
    },
    {
      name: 'ramp',
      signature: 'ramp(param, target, options)',
      description:
        "Moves a parameter to a value over time: ramp('frequency', 2000, { duration: 1 }).",
      returns: 'same',
    },
    {
      name: 'offset',
      signature: 'offset(param, amount, options?)',
      description: 'Adds a temporary amount on top of a parameter without changing its base value.',
      returns: 'same',
    },
    {
      name: 'param',
      signature: 'param(name)',
      description:
        'The named parameter of the first selected node. Read it with .value. Throws if nothing is selected.',
      returns: 'param',
    },
    {
      name: 'params',
      signature: 'params(name)',
      description: 'The named parameter of each selected node that has it.',
    },
    {
      name: 'call',
      signature: 'call(method, args?, options?)',
      description: "Calls a method the node type declares: call('clear').",
      returns: 'same',
    },
    {
      name: 'bypass',
      signature: 'bypass(on?, options?)',
      description:
        'Bypasses every selected node, or with false brings them back. A bypassed effect passes its input through; a bypassed source is silent.',
      returns: 'same',
    },
    {
      name: 'connect',
      signature: 'connect(target)',
      description: `Connects every selected node to ${TARGET}.`,
      returns: 'same',
    },
    {
      name: 'to',
      signature: 'to(bus)',
      description: 'Connects every selected node to a named bus.',
      returns: 'same',
    },
    {
      name: 'disconnect',
      signature: 'disconnect()',
      description: 'Removes the connections out of every selected node.',
      returns: 'same',
    },
    {
      name: 'chain',
      signature: 'chain()',
      description: 'Starts a chain whose first new node is fed by every selected node.',
      returns: 'chain',
    },
    {
      name: 'select',
      signature: 'select(selector)',
      description:
        'Searches inside the selected nodes, which is how the inside of a macro is reached.',
      returns: 'selection',
    },
    {
      name: 'filter',
      signature: 'filter(selector | predicate)',
      description: 'The selected nodes that match a selector or a function.',
      returns: 'same',
    },
    {
      name: 'each',
      signature: 'each(fn)',
      description: 'Calls fn(node, index) for every selected node.',
      returns: 'same',
    },
    {
      name: 'first',
      signature: 'first()',
      description: 'The first selected node, or undefined.',
      returns: 'node',
    },
    {
      name: 'at',
      signature: 'at(index)',
      description: 'The selected node at an index, or undefined.',
      returns: 'node',
    },
    { name: 'length', description: 'How many nodes are selected.' },
    { name: 'nodes', description: 'The selected nodes, as an array.' },
    {
      name: 'dispose',
      signature: 'dispose()',
      description: 'Removes every selected node from the graph.',
    },
  ],
  node: [
    { name: 'id', description: "Unique within the node's scope." },
    { name: 'type', description: "The node type's name." },
    { name: 'classes', description: "The node's classes, as a Set." },
    { name: 'tags', description: "The node's tags." },
    { name: 'params', description: "The node's parameters, by name." },
    {
      name: 'param',
      signature: 'param(name)',
      description: 'The named parameter.',
      returns: 'param',
    },
    {
      name: 'connect',
      signature: 'connect(target)',
      description: 'Connects this node to a node, a bus or a parameter.',
      returns: 'same',
    },
    {
      name: 'disconnect',
      signature: 'disconnect(target?)',
      description: 'Removes one connection, or all of them.',
      returns: 'same',
    },
    {
      name: 'trigger',
      signature: 'trigger(options?)',
      description: 'Starts a voice or opens the gate.',
      returns: 'same',
    },
    {
      name: 'release',
      signature: 'release(options?)',
      description: 'Closes the gate.',
      returns: 'same',
    },
    {
      name: 'call',
      signature: 'call(method, args?, options?)',
      description: 'Calls a method the node type declares.',
      returns: 'same',
    },
    { name: 'dispose', signature: 'dispose()', description: 'Removes the node from the graph.' },
  ],
  bus: [
    { name: 'name', description: "The bus's name." },
    { name: 'gain', description: "The level of the bus's mix, a parameter.", returns: 'param' },
    {
      name: 'to',
      signature: 'to(target)',
      description:
        "Where this bus sends its mix: a bus name, or null for nowhere, so that it is heard only through what continues from it with chain(). Default: 'main'.",
      returns: 'same',
    },
    {
      name: 'chain',
      signature: 'chain()',
      description: "Starts a chain fed by this bus's mix, for processing everything sent to it.",
      returns: 'chain',
    },
  ],
  sequence: [
    { name: 'name', description: "The sequence's name, or null." },
    { name: 'steps', description: 'The current steps.' },
    { name: 'options', description: 'The options the sequence was made with.' },
    { name: 'muted', description: 'Assign true to silence the sequence without stopping it.' },
    {
      name: 'setStep',
      signature: 'setStep(index, value)',
      description: 'Changes one step. Takes effect from the next step.',
      returns: 'same',
    },
    {
      name: 'update',
      signature: 'update(options)',
      description: 'Changes options or the pattern in place, staying in time.',
      returns: 'same',
    },
    {
      name: 'restart',
      signature: 'restart()',
      description: 'Restarts the pattern from its first step at the next step boundary.',
      returns: 'same',
    },
    { name: 'stop', signature: 'stop()', description: 'Removes the sequence.' },
  ],
  param: [
    {
      name: 'value',
      description: 'The base value. It does not include offsets, ramps in flight or modulation.',
    },
    { name: 'meta', description: "The parameter's metadata: range, unit, curve, description." },
    {
      name: 'set',
      signature: 'set(value, options?)',
      description: 'Sets the base value.',
      returns: 'same',
    },
    {
      name: 'ramp',
      signature: 'ramp(target, options)',
      description: 'Moves to a value over time: ramp(2000, { duration: 1 }).',
      returns: 'same',
    },
    {
      name: 'offset',
      signature: 'offset(amount, options?)',
      description: 'Adds a temporary amount on top of the base value.',
      returns: 'same',
    },
    {
      name: 'clearOffset',
      signature: 'clearOffset(options?)',
      description: 'Removes the offset.',
      returns: 'same',
    },
    {
      name: 'cancel',
      signature: 'cancel(options?)',
      description: 'Cancels ramps and offsets scheduled at or after the given time.',
      returns: 'same',
    },
    {
      name: 'reset',
      signature: 'reset(options?)',
      description: 'Returns the base value to its default.',
      returns: 'same',
    },
  ],
  event: [
    { name: 'time', description: 'Audio-clock time at which this step sounds.' },
    { name: 'duration', description: 'Seconds this step lasts, after swing.' },
    { name: 'beat', description: 'Position in beats from the start of the transport.' },
    { name: 'bar', description: 'Bar number, counted from 0.' },
    { name: 'index', description: 'Which step of the pattern this is, counted from 0.' },
    { name: 'value', description: "The step's value. 0 is a rest." },
    { name: 'steps', description: 'The whole pattern.' },
    { name: 'cycle', description: 'How many times the sequence has wrapped.' },
    { name: 'sequence', description: 'The sequence this event came from.', returns: 'sequence' },
    {
      name: 'at',
      signature: 'at(fraction)',
      description: 'Audio time part-way through this step: at(0.5) is halfway.',
    },
  ],
  position: [
    { name: 'beats', description: 'Beats from the start of the transport.' },
    { name: 'bar', description: 'Bar number, counted from 0.' },
    { name: 'beatInBar', description: 'Beats into the current bar.' },
    { name: 'seconds', description: 'Seconds from the start of the transport.' },
  ],
};

const AT: ApiOption = {
  name: 'at',
  type: 'number',
  description:
    "When it takes effect, in audio-clock seconds. Left out: the step's time inside a sequence callback, otherwise now.",
};

/** Options every node accepts when it is made. */
export const COMMON_INIT: readonly ApiOption[] = [
  {
    name: 'id',
    type: 'string',
    description: "Unique within the scope. Give one to anything you refer to later: __('#id').",
  },
  {
    name: 'class',
    type: 'string',
    description: "One or more classes, separated by spaces, to select by: __('.drums').",
  },
  {
    name: 'tags',
    type: 'object',
    description: 'Key and value tags, matched by selectors such as [role=send].',
  },
  { name: 'bypass', type: 'boolean', default: 'false', description: 'Start bypassed.' },
];

export const TRIGGER_COMMON: readonly ApiOption[] = [AT];

export const SEQUENCE_OPTIONS: readonly ApiOption[] = [
  {
    name: 'steps',
    type: 'pattern | number',
    description:
      "The pattern: an array, a string such as 'x..x..x.' or '1 0 0 2', or a step count. 0 is a rest.",
  },
  {
    name: 'step',
    type: 'duration',
    description: "Length of one step, such as '1/8'. Default: the transport's stepLength.",
  },
  {
    name: 'span',
    type: 'duration',
    description: 'Total length the steps are spread evenly across. Give this or step, not both.',
  },
  {
    name: 'swing',
    type: 'number',
    description: '0.5 is straight; above 0.5 delays every second step.',
  },
  { name: 'offset', type: 'duration', description: 'Shifts the whole sequence later.' },
  {
    name: 'probability',
    type: 'number',
    description: 'Chance from 0 to 1 that a step that is not a rest fires.',
  },
  {
    name: 'order',
    type: 'number',
    default: '0',
    description: 'Callbacks due at the same time run in ascending order.',
  },
  {
    name: 'rests',
    type: 'boolean',
    default: 'true',
    description: 'Whether the callback is also called for rests.',
  },
];

export const RAMP_OPTIONS: readonly ApiOption[] = [
  { name: 'duration', type: 'number', description: 'Seconds the ramp takes.' },
  {
    name: 'curve',
    type: "'linear' | 'exp'",
    default: "'linear'",
    description: 'Shape of the ramp.',
  },
  { name: 'from', type: 'number', description: 'Start value. Default: the value at the time.' },
  AT,
];

export const OFFSET_OPTIONS: readonly ApiOption[] = [
  {
    name: 'duration',
    type: 'number',
    description: 'Seconds the offset lasts. Left out: until cleared.',
  },
  AT,
];

export const RELEASE_OPTIONS: readonly ApiOption[] = [
  AT,
  { name: 'pitch', type: 'number', description: 'On a polyphonic node: which note to release.' },
];

export const AT_OPTIONS: readonly ApiOption[] = [AT];

export const EVERY_OPTIONS: readonly ApiOption[] = [
  { name: 'offset', type: 'duration', description: 'Shifts every call later.' },
  {
    name: 'order',
    type: 'number',
    description: 'Callbacks due at the same time run in ascending order.',
  },
];

export const START_OPTIONS: readonly ApiOption[] = [
  AT,
  { name: 'from', type: 'position', description: 'Where to start from.' },
];

/** The fields of a macro definition, for `define({ ... })` and `defineMacro({ ... })`. */
export const DEFINITION_OPTIONS: readonly ApiOption[] = [
  {
    name: 'type',
    type: 'string',
    description: 'The name of the node type; it becomes a chain method.',
  },
  { name: 'description', type: 'string', description: 'One line saying what it is.' },
  {
    name: 'params',
    type: 'object',
    description:
      'Its parameters by name: { default, min, max, unit, description, drives: [{ select, param }] }.',
  },
  { name: 'shorthand', type: 'string', description: 'The parameter a bare argument sets.' },
  {
    name: 'build',
    type: 'function',
    description:
      "build(__, init): makes the inner graph. Send to 'out' for the output; continue from __.bus('in').chain() for the input.",
  },
  { name: 'trigger', type: 'function', description: 'trigger(__, options): what trigger() does.' },
  { name: 'release', type: 'function', description: 'release(__, options): what release() does.' },
  {
    name: 'methods',
    type: 'object',
    description: 'Its own operations, reached with call(name, args).',
  },
  {
    name: 'category',
    type: 'string',
    description: 'Where it is listed: source, filter, delay, ...',
  },
];

/** Durations offered where one is expected. */
export const DURATIONS: readonly (readonly [string, string])[] = [
  ['1/4', 'a quarter note'],
  ['1/8', 'an eighth note'],
  ['1/16', 'a sixteenth note'],
  ['1/32', 'a thirty-second note'],
  ['1/2', 'a half note'],
  ['1/8t', 'an eighth-note triplet'],
  ['1/8d', 'a dotted eighth note'],
  ['1 bar', 'one bar in the current time signature'],
  ['2 bars', 'two bars'],
  ['4 bars', 'four bars'],
];

export function apiMember(kind: ReceiverKind, name: string): ApiMember | undefined {
  return API[kind].find((member) => member.name === name);
}
