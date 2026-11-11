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
    const params = new Map<string, ParamMeta>();
    for (const [name, input] of Object.entries(definition.params)) {
      params.set(name, normalizeParamMeta(name, input));
    }
    if (definition.shorthand !== undefined && !params.has(definition.shorthand)) {
      throw new CrackedUpError(
        'invalid-param',
        `Node type "${type}" names "${definition.shorthand}" as its shorthand, but has no such parameter.`,
      );
    }
    const isMacro = isMacroDefinition(definition);
    const triggerable = isMacro
      ? (definition as MacroDefinition).trigger !== undefined
      : ((definition as NodeDefinition).triggerable ?? false);
    const entry: RegistryEntry = {
      type,
      isMacro,
      definition,
      params,
      shorthand: definition.shorthand ?? null,
      info: {
        type,
        category: definition.category ?? 'utility',
        description: definition.description ?? '',
        isMacro,
        triggerable,
        shorthand: definition.shorthand ?? null,
        params: [...params.values()],
        options: definition.options ?? {},
        triggerOptions: definition.triggerOptions ?? {},
      },
    };
    this.entries.set(type, entry);
    this.onRegister(entry);
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
