/** Guide page script: colours the JavaScript examples. Blocks marked `data-lang` are left plain. */

import { highlightBlocks } from './highlight';

highlightBlocks(document.querySelector('article') ?? document);
