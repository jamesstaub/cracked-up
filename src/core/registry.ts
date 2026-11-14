import type {
  MacroDefinition,
  NodeDefinition,
  NodeTypeInfo,
  ParamMeta,
  ParamMetaInput,
  Registry,
} from '../api';
import { isMacroDefinition } from '../define';
import { CrackedUpError } from './errors';

export interface RegistryEntry {
  readonly type: string;
  readonly isMacro: boolean;
  readonly definition: NodeDefinition | MacroDefinition;
  readonly info: NodeTypeInfo;
  readonly params: ReadonlyMap<string, ParamMeta>;
  readonly shorthand: string | null;
}

/** Fills in the defaults a definition may leave out, and works out the parameter's kind. */
export function normalizeParamMeta(name: string, input: ParamMetaInput): ParamMeta {
  const description = input.description === undefined ? {} : { description: input.description };
  if ('choices' in input) {
    return {
      name,
      kind: 'choice',
      default: input.default,
      choices: input.choices,
      rate: input.rate ?? 'control',
      ...description,
    };
  }
  if (typeof input.default === 'boolean') {
    return {
      name,
      kind: 'boolean',
      default: input.default,
      rate: input.rate ?? 'control',
      ...description,
    };
  }
  const number = input as Extract<ParamMetaInput, { min: number }>;
  return {
    name,
    kind: 'number',
    default: number.default,
    min: number.min,
    max: number.max,
    unit: number.unit ?? 'none',
    curve: number.curve ?? 'linear',
    rate: number.rate ?? 'audio',
    ...(number.step === undefined ? {} : { step: number.step }),
    ...description,
  };
}

/**
 * What the registry reports about a definition: `engine.registry.describe(type)` for a type made from
 * it. Reads only the definition, so it needs no engine and no audio context.
 */
export function describeNodeType(definition: NodeDefinition | MacroDefinition): NodeTypeInfo {
  const isMacro = isMacroDefinition(definition);
  const triggerable = isMacro
    ? (definition as MacroDefinition).trigger !== undefined
    : ((definition as NodeDefinition).triggerable ?? false);
  return {
    type: definition.type,
    category: definition.category ?? 'utility',
    description: definition.description ?? '',
    isMacro,
    triggerable,
    shorthand: definition.shorthand ?? null,
    modulates: (definition as { modulates?: string }).modulates ?? null,
    params: Object.entries(definition.params).map(([name, input]) =>
      normalizeParamMeta(name, input),
    ),
    options: definition.options ?? {},
    triggerOptions: definition.triggerOptions ?? {},
  };
}

export class RegistryImpl implements Registry {
  private entries = new Map<string, RegistryEntry>();

  /**
   * @param reserved names a type may not take because they are methods of the chain.
   * @param onRegister called after each registration, so the engine can add chain methods and setters.
   */
  constructor(
    private reserved: (name: string) => boolean,
    private onRegister: (entry: RegistryEntry) => void,
  ) {}

  register(definition: NodeDefinition | MacroDefinition): void {
    const type = definition.type;
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(type)) {
      throw new CrackedUpError(
        'unknown-type',
        `"${type}" is not a valid node type name: use letters, digits, "_" and "-", starting with a letter.`,
      );
    }
    if (this.reserved(type)) {
      throw new CrackedUpError(
        'unknown-type',
        `"${type}" cannot be a node type name because chains already have a method called "${type}".`,
      );
    }
    const info = describeNodeType(definition);
    const params = new Map<string, ParamMeta>(info.params.map((meta) => [meta.name, meta]));
    if (definition.shorthand !== undefined && !params.has(definition.shorthand)) {
      throw new CrackedUpError(
        'invalid-param',
        `Node type "${type}" names "${definition.shorthand}" as its shorthand, but has no such parameter.`,
      );
    }
    const entry: RegistryEntry = {
      type,
      isMacro: info.isMacro,
      definition,
      params,
      shorthand: info.shorthand,
      info,
    };
    this.entries.set(type, entry);
    this.onRegister(entry);
  }

  /** Forgets a type. Nodes already made from it keep working. */
  remove(type: string): void {
    this.entries.delete(type);
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  describe(type: string): NodeTypeInfo {
    return this.entry(type).info;
  }

  list(): readonly NodeTypeInfo[] {
    return [...this.entries.values()].map((entry) => entry.info);
  }

  entry(type: string): RegistryEntry {
    const entry = this.entries.get(type);
    if (!entry) {
      throw new CrackedUpError('unknown-type', `There is no node type called "${type}".`);
    }
    return entry;
  }
}
