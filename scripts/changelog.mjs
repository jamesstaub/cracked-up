// Keeps CHANGELOG.md and releases in step. Two commands:
//
//   node scripts/changelog.mjs release
//     Run by `npm version` (the "version" script). Turns the "Unreleased" section into a section for
//     the new version, dated today, and starts a fresh empty "Unreleased". Fails if there is nothing
//     under "Unreleased", so a release cannot go out without notes.
//
//   node scripts/changelog.mjs notes <version>
//     Prints the section for a version. The release workflow uses it as the GitHub release text.

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../CHANGELOG.md', import.meta.url);
const UNRELEASED = '## [Unreleased]';

/** The lines under a heading, up to the next version heading. */
function sectionAfter(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return null;
  const from = start + heading.length;
  const next = text.indexOf('\n## [', from);
  return text.slice(from, next === -1 ? undefined : next).trim();
}

function fail(message) {
  console.error(`changelog: ${message}`);
  process.exit(1);
}

const [command, argument] = process.argv.slice(2);
const text = readFileSync(FILE, 'utf8');

if (command === 'release') {
  // npm sets this to the version being created.
  const version = process.env.npm_package_version;
  if (!version) fail('run this through "npm version", which says what the new version is.');
  if (text.includes(`## [${version}]`)) fail(`CHANGELOG.md already has a section for ${version}.`);
  const notes = sectionAfter(text, UNRELEASED);
  if (notes === null) fail(`CHANGELOG.md has no "${UNRELEASED}" section.`);
  if (notes === '') {
    fail(
      `nothing is listed under "${UNRELEASED}". Write what changed there, then run npm version again.`,
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(FILE, text.replace(UNRELEASED, `${UNRELEASED}\n\n## [${version}] - ${today}`));
  console.log(`changelog: moved Unreleased to ${version} (${today}).`);
} else if (command === 'notes') {
  const version = (argument ?? '').replace(/^v/, '');
  if (!version) fail('say which version: node scripts/changelog.mjs notes 1.2.3');
  const heading = text.split('\n').find((line) => line.startsWith(`## [${version}]`));
  if (!heading) fail(`CHANGELOG.md has no section for ${version}.`);
  console.log(sectionAfter(text, heading));
} else {
  fail('use "release" or "notes <version>".');
}
