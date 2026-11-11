import { SelectorError } from './ast';
import type {
  Combinator,
  CompoundSelector,
  ComplexSelector,
  SelectorList,
  SelectorStep,
  TagTest,
} from './ast';

const CACHE_LIMIT = 2000;
const cache = new Map<string, SelectorList>();

/** Parses a selector. Results are cached per source string; the returned AST must not be mutated. */
export function parseSelector(source: string): SelectorList {
  const hit = cache.get(source);
  if (hit) return hit;
  const parsed = new Parser(source).parseList();
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(source, parsed);
  return parsed;
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isAlpha = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isNameChar = (c: string): boolean => isAlpha(c) || isDigit(c) || c === '_' || c === '-';
const isIdentStart = (c: string): boolean => isAlpha(c) || c === '_';
const isSpace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isBareValueChar = (c: string): boolean => isNameChar(c) || c === '.';

interface MutableCompound {
  type: string | null;
  universal: boolean;
  ids: string[];
  classes: string[];
  tags: TagTest[];
  not: CompoundSelector[][];
  nth: number | null;
  position: number;
  nthPosition: number;
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  private fail(message: string, position = this.pos): never {
    throw new SelectorError(message, this.src, position);
  }

  private peek(): string {
    return this.src.charAt(this.pos);
  }

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private describeNext(): string {
    return this.atEnd() ? 'end of selector' : `'${this.peek()}'`;
  }

  private skipSpace(): void {
    while (!this.atEnd() && isSpace(this.peek())) this.pos++;
  }

  parseList(): SelectorList {
    this.skipSpace();
    if (this.atEnd()) this.fail('Expected a selector, found an empty selector');
    const selectors: ComplexSelector[] = [];
    for (;;) {
      selectors.push(this.parseComplex());
      this.skipSpace();
      if (this.atEnd()) break;
      if (this.peek() === ',') {
        this.pos++;
        this.skipSpace();
        continue;
      }
      this.fail(`Expected ',' or end of selector, found ${this.describeNext()}`);
    }
    return { source: this.src, selectors };
  }

  private parseComplex(): ComplexSelector {
    const steps: SelectorStep[] = [];
    const start = this.pos;
    steps.push({
      combinator: null,
      combinatorPosition: start,
      compound: this.parseCompound(false, 'Expected a selector'),
    });
    for (;;) {
      const wsStart = this.pos;
      this.skipSpace();
      const hadSpace = this.pos > wsStart;
      if (this.atEnd() || this.peek() === ',') return { steps };
      let combinator: Combinator;
      let combinatorPosition = wsStart;
      if (this.peek() === '>') {
        combinator = 'child';
        combinatorPosition = this.pos;
        this.pos++;
        this.skipSpace();
        if (this.atEnd() || this.peek() === ',' || this.peek() === '>') {
          this.fail(`Expected a selector after '>', found ${this.describeNext()}`);
        }
      } else if (hadSpace) {
        combinator = 'descendant';
      } else {
        this.fail(`Expected combinator, ',' or end of selector, found ${this.describeNext()}`);
      }
      steps.push({
        combinator,
        combinatorPosition,
        compound: this.parseCompound(false, 'Expected a selector'),
      });
    }
  }

  private parseName(what: string): string {
    const start = this.pos;
    while (!this.atEnd() && isNameChar(this.peek())) this.pos++;
    if (this.pos === start) this.fail(`Expected ${what}, found ${this.describeNext()}`);
    return this.src.slice(start, this.pos);
  }

  private parseIdent(what: string): string {
    if (!isIdentStart(this.peek())) {
      this.fail(
        `Expected ${what} (letters, digits, '_' or '-', not starting with a digit or '-'), found ${this.describeNext()}`,
      );
    }
    return this.parseName(what);
  }

  /** Parses one compound. Inside `:not` (`inNot`), `:nth` and nested `:not` are rejected. */
  private parseCompound(inNot: boolean, emptyMessage: string): CompoundSelector {
    const c: MutableCompound = {
      type: null,
      universal: false,
      ids: [],
      classes: [],
      tags: [],
      not: [],
      nth: null,
      position: this.pos,
      nthPosition: -1,
    };
    let parts = 0;

    if (this.peek() === '*') {
      c.universal = true;
      this.pos++;
      parts++;
    } else if (isIdentStart(this.peek())) {
      c.type = this.parseIdent('a type name');
      parts++;
    } else if (isDigit(this.peek())) {
      this.fail(
        `Expected a type name, which cannot start with a digit; found ${this.describeNext()}`,
      );
    }

    for (;;) {
      const ch = this.peek();
      const at = this.pos;
      if (ch === '#') {
        this.pos++;
        c.ids.push(this.parseName('an id name after #'));
      } else if (ch === '.') {
        this.pos++;
        c.classes.push(this.parseName('a class name after .'));
      } else if (ch === '[') {
        this.pos++;
        c.tags.push(this.parseTag());
      } else if (ch === ':') {
        this.pos++;
        this.parsePseudo(c, inNot, at);
      } else if (ch === '*' || isIdentStart(ch)) {
        this.fail(
          `Expected '#', '.', '[', ':' or end of compound; a type or '*' is only allowed at the start of a compound, found ${this.describeNext()}`,
        );
      } else {
        break;
      }
      parts++;
    }
    if (parts === 0) this.fail(`${emptyMessage}, found ${this.describeNext()}`);
    return c;
  }

  private parseTag(): TagTest {
    this.skipSpace();
    const name = this.parseIdent('a tag name');
    this.skipSpace();
    if (this.peek() === ']') {
      this.pos++;
      return { op: 'present', name };
    }
    let op: 'equals' | 'not-equals';
    if (this.peek() === '=') {
      op = 'equals';
      this.pos++;
    } else if (this.peek() === '!' && this.src.charAt(this.pos + 1) === '=') {
      op = 'not-equals';
      this.pos += 2;
    } else {
      this.fail(`Expected '=', '!=' or ']', found ${this.describeNext()}`);
    }
    this.skipSpace();
    const value = this.parseValue();
    this.skipSpace();
    if (this.peek() !== ']') this.fail(`Expected ']', found ${this.describeNext()}`);
    this.pos++;
    return { op, name, value };
  }

  private parseValue(): string {
    const q = this.peek();
    if (q === '"' || q === "'") {
      const start = this.pos;
      this.pos++;
      const end = this.src.indexOf(q, this.pos);
      if (end < 0) this.fail(`Unterminated string, expected closing ${q}`, start);
      const value = this.src.slice(this.pos, end);
      this.pos = end + 1;
      return value;
    }
    const start = this.pos;
    while (!this.atEnd() && isBareValueChar(this.peek())) this.pos++;
    if (this.pos === start) this.fail(`Expected a value, found ${this.describeNext()}`);
    return this.src.slice(start, this.pos);
  }

  private parsePseudo(c: MutableCompound, inNot: boolean, colonPos: number): void {
    const nameStart = this.pos;
    while (!this.atEnd() && isAlpha(this.peek())) this.pos++;
    const name = this.src.slice(nameStart, this.pos);
    if (name === 'not') {
      if (inNot) this.fail(':not cannot be nested', colonPos);
      if (this.peek() !== '(') this.fail(`Expected '(' after :not, found ${this.describeNext()}`);
      this.pos++;
      const list: CompoundSelector[] = [];
      for (;;) {
        this.skipSpace();
        list.push(this.parseCompound(true, 'Expected a compound selector inside :not()'));
        this.skipSpace();
        if (this.peek() === ',') {
          this.pos++;
          continue;
        }
        if (this.peek() === ')') {
          this.pos++;
          break;
        }
        this.fail(
          `Expected ',' or ')' in :not(); combinators are not allowed inside :not, found ${this.describeNext()}`,
        );
      }
      c.not.push(list);
    } else if (name === 'nth') {
      if (inNot) this.fail(':nth is not allowed inside :not', colonPos);
      if (c.nth !== null) this.fail('Only one :nth is allowed per compound selector', colonPos);
      if (this.peek() !== '(') this.fail(`Expected '(' after :nth, found ${this.describeNext()}`);
      this.pos++;
      this.skipSpace();
      const start = this.pos;
      while (!this.atEnd() && isDigit(this.peek())) this.pos++;
      if (this.pos === start) {
        this.fail(`Expected a non-negative integer in :nth(), found ${this.describeNext()}`);
      }
      const n = Number(this.src.slice(start, this.pos));
      if (!Number.isSafeInteger(n)) this.fail('Integer in :nth() is too large', start);
      this.skipSpace();
      if (this.peek() !== ')')
        this.fail(`Expected ')' after :nth index, found ${this.describeNext()}`);
      this.pos++;
      c.nth = n;
      c.nthPosition = colonPos;
    } else {
      this.fail(`Unknown pseudo-class ':${name}'; expected :not(...) or :nth(n)`, colonPos);
    }
  }
}
