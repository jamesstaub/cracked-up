/**
 * Hover tooltips, signature help and "go to definition": what the editor says about the thing at a
 * position. Like completion, each is a plain function of a state, a position and a catalog, with a
 * thin CodeMirror extension around it.
 */

import { completionStatus } from '@codemirror/autocomplete';
import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension } from '@codemirror/state';
import { hoverTooltip, showTooltip } from '@codemirror/view';
import type { Tooltip } from '@codemirror/view';
import { callAround, entityAt, sceneOf, typeInfo } from './analysis';
import type { CallSite, Entity, Scene } from './analysis';
import { DUNDER_CALL, apiMember } from './api-docs';
import { resolveCatalog } from './catalog';
import type { ResolvedCatalog } from './catalog';
import { keyOptions } from './completion';
import { bufferDoc, globalDoc, helperDoc, memberDoc, renderDoc, setterDoc, typeDoc } from './docs';
import type { Doc } from './docs';
import type { DefinitionTarget } from './panel';

// --- The catalog, kept in the editor's state --------------------------------------------------------

export const setCatalogEffect = StateEffect.define<ResolvedCatalog>();

export const catalogField = StateField.define<ResolvedCatalog>({
  create: () => resolveCatalog({}),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCatalogEffect)) value = effect.value;
    }
    return value;
  },
});

// --- Hover ------------------------------------------------------------------------------------------

function setterDocFor(scene: Scene, name: string, types: readonly string[] | null): Doc | null {
  const candidates = types
    ? types.flatMap((type) => typeInfo(scene, type) ?? [])
    : [...scene.catalog.types.values(), ...[...scene.doc.localTypes.values()].map((l) => l.info)];
  const owners = candidates.filter((info) => info.params.some((param) => param.name === name));
  const param = owners[0]?.params.find((candidate) => candidate.name === name);
  if (!param) return null;
  return setterDoc(
    param,
    owners.map((info) => info.type),
  );
}

function docFor(scene: Scene, entity: Entity): Doc | null {
  switch (entity.kind) {
    case 'type':
      return typeDoc(entity.info);
    case 'helper': {
      const helper = scene.catalog.helpers.get(entity.name);
      return helper ? helperDoc(helper, entity.name) : null;
    }
    case 'global': {
      const info = scene.catalog.globals.get(entity.name);
      return info ? globalDoc(info) : null;
    }
    case 'dunder':
      return { ...memberDoc(DUNDER_CALL, ''), kind: 'cracked-up' };
    case 'member': {
      const member = apiMember(entity.receiver, entity.name);
      return member
        ? memberDoc(member, entity.receiver === 'dunder' ? '__' : entity.receiver)
        : null;
    }
    case 'setter':
      return setterDocFor(scene, entity.name, entity.types);
    case 'key':
      return (
        keyOptions(scene, entity.call).find((option) => option.name === entity.name)?.doc ?? null
      );
    case 'string': {
      const isBuffer = entity.key === 'buffer' || entity.key === 'into';
      const buffer = isBuffer
        ? scene.catalog.buffers.find((entry) => entry.key === entity.value)
        : undefined;
      return buffer ? bufferDoc(buffer) : null;
    }
  }
}

/** The documentation for whatever is at a position, with the range it covers. */
export function hoverAt(
  state: EditorState,
  pos: number,
  catalog: ResolvedCatalog,
): { from: number; to: number; doc: Doc } | null {
  const scene = sceneOf(state, catalog);
  const entity = entityAt(scene, pos);
  if (!entity || pos < entity.from || pos > entity.to) return null;
  const doc = docFor(scene, entity);
  return doc ? { from: entity.from, to: entity.to, doc } : null;
}

// --- Signature help ---------------------------------------------------------------------------------

/** The argument names in a signature: `euclid(hits, steps, rotate?)` gives hits, steps, rotate. */
function argumentNames(signature: string): string[] {
  const inside = /\((.*)\)/s.exec(signature)?.[1] ?? '';
  return inside
    .split(/,(?![^[{]*[\]}])/)
    .map((part) =>
      part
        .trim()
        .replace(/^\.\.\./, '')
        .replace(/\?$/, ''),
    )
    .filter(Boolean);
}

function withActive(doc: Doc, index: number): Doc {
  const names = argumentNames(doc.signature);
  // A rest argument takes every later position.
  const name =
    names[index] ?? (doc.signature.includes('...') ? names[names.length - 1] : undefined);
  return name && /^[\w$]+$/.test(name) ? { ...doc, active: name } : doc;
}

function signatureDoc(scene: Scene, call: CallSite): Doc | null {
  const { name, receiver, index } = call;
  if (receiver === null) {
    if (name === '__')
      return withActive({ ...memberDoc(DUNDER_CALL, ''), kind: 'cracked-up' }, index);
    if (scene.doc.definitions.has(name)) return null;
    const helper = scene.catalog.helpers.get(name);
    if (helper) return withActive(helperDoc(helper, name), index);
    const global = scene.catalog.globals.get(name);
    return global?.signature ? withActive(globalDoc(global), index) : null;
  }
  if (receiver.kind === 'chain' || receiver.kind === 'unknown') {
    const info = typeInfo(scene, name);
    if (info) return typeDoc(info);
  }
  if (receiver.kind === 'unknown') return null;
  const member = apiMember(receiver.kind, name);
  if (member?.signature) {
    return withActive(memberDoc(member, receiver.kind === 'dunder' ? '__' : receiver.kind), index);
  }
  if (receiver.kind === 'selection') {
    const doc = setterDocFor(scene, name, receiver.types);
    return doc ? withActive(doc, index) : null;
  }
  return null;
}

/** What to show about the call the cursor is in the brackets of, and where that call's name ends. */
export function signatureAt(
  state: EditorState,
  pos: number,
  catalog: ResolvedCatalog,
): { pos: number; doc: Doc } | null {
  const scene = sceneOf(state, catalog);
  const call = callAround(scene, pos);
  if (!call) return null;
  const doc = signatureDoc(scene, call);
  const list = call.node.getChild('ArgList');
  return doc && list ? { pos: list.from, doc } : null;
}

interface SignatureHelp {
  /** Changes when what is shown changes, so an unchanged tooltip is not redrawn. */
  readonly key: string;
  readonly tooltip: Tooltip;
}

function signatureHelp(state: EditorState): SignatureHelp | null {
  const range = state.selection.main;
  if (!range.empty) return null;
  // While the completion list is open it says more about the same thing, in the same place.
  if (completionStatus(state) === 'active') return null;
  let found: ReturnType<typeof signatureAt> = null;
  try {
    found = signatureAt(state, range.head, state.field(catalogField));
  } catch {
    found = null;
  }
  if (!found) return null;
  const doc = found.doc;
  return {
    key: JSON.stringify([found.pos, doc.signature, doc.active, doc.description]),
    tooltip: {
      pos: found.pos,
      above: true,
      arrow: false,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cu-signature-help';
        dom.append(renderDoc(doc, { brief: true }));
        return { dom };
      },
    },
  };
}

const signatureField = StateField.define<SignatureHelp | null>({
  create: signatureHelp,
  update(value, transaction) {
    // Every transaction: the completion list opens and closes without the text or cursor changing.
    const next = signatureHelp(transaction.state);
    return value && next && value.key === next.key ? value : next;
  },
  provide: (field) => showTooltip.from(field, (value) => value?.tooltip ?? null),
});

export function intelExtensions(options: { hover: boolean; signatureHelp: boolean }): Extension {
  const extensions: Extension[] = [];
  if (options.hover) {
    extensions.push(
      hoverTooltip(
        (view, pos) => {
          let found: ReturnType<typeof hoverAt> = null;
          try {
            found = hoverAt(view.state, pos, view.state.field(catalogField));
          } catch {
            found = null;
          }
          if (!found) return null;
          const doc = found.doc;
          return {
            pos: found.from,
            end: found.to,
            above: false,
            create: () => ({ dom: renderDoc(doc) }),
          };
        },
        { hoverTime: 350 },
      ),
    );
  }
  if (options.signatureHelp) extensions.push(signatureField);
  return extensions;
}

// --- Go to definition --------------------------------------------------------------------------------

/** The node type or helper named at a position, or null. */
export function definitionAt(
  state: EditorState,
  pos: number,
  catalog: ResolvedCatalog,
): (DefinitionTarget & { readonly from: number; readonly to: number }) | null {
  const scene = sceneOf(state, catalog);
  const entity = entityAt(scene, pos);
  if (!entity || pos < entity.from || pos > entity.to) return null;
  if (entity.kind === 'type') {
    const local = entity.local;
    return {
      kind: 'type',
      name: entity.name,
      type: entity.info,
      ...(local
        ? {
            local: {
              from: local.namePos,
              to: local.namePos + local.type.length,
              line: state.doc.lineAt(local.namePos).number,
            },
          }
        : {}),
      from: entity.from,
      to: entity.to,
    };
  }
  if (entity.kind === 'helper') {
    const helper = scene.catalog.helpers.get(entity.name);
    if (!helper) return null;
    return { kind: 'helper', name: helper.name, helper, from: entity.from, to: entity.to };
  }
  return null;
}
