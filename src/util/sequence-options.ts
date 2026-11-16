import type { SequenceOptions } from '../api';

/**
 * A sequence's options as it keeps and shows them: a frozen copy of what the caller gave, with an
 * array of steps copied and frozen too, so neither the caller's object nor the one a sequence hands
 * out can change the sequence afterwards.
 */
export function keepSequenceOptions(options: SequenceOptions): Readonly<SequenceOptions> {
  const steps = options.steps;
  return Object.freeze({
    ...options,
    steps: typeof steps === 'object' ? Object.freeze([...steps]) : steps,
  });
}
