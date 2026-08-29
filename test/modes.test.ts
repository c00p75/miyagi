/**
 * The mode engine is policy, so the tests are about the decisions rather than
 * the plumbing: that the quiet default holds, that exposure does not pay like
 * recall, that recall is deferred rather than dropped, and above all that no
 * mode can hide a refusal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  MODES,
  DEFAULT_MODE,
  policyFor,
  resolveMode,
  shouldSurfaceCard,
  cardDepthFor,
  surfaceFor,
  requestModeChange,
  commandXp,
  showsXpFootnote,
  isWorthAnnouncing,
  ARCHIVE_IS_ALWAYS_FULL,
} = await import('../src/modes.js');

test('the default is quiet, not the drill', () => {
  // Too loud costs an uninstall before anyone finds the setting; too quiet
  // costs mild disappointment. Intensity is opted into.
  assert.equal(DEFAULT_MODE, 'ride-along');
  assert.equal(policyFor(DEFAULT_MODE).quiz, false);
  assert.equal(policyFor(DEFAULT_MODE).speak, false);
});

test('a refusal surfaces in every mode, including focus', () => {
  for (const { mode } of MODES) {
    assert.equal(shouldSurfaceCard(mode, true), true, `${mode} must report a refusal`);
    assert.notEqual(cardDepthFor(mode, true), 'none', `${mode} must render something`);
  }
});

test('focus hides an ordinary lesson but nothing dangerous', () => {
  assert.equal(shouldSurfaceCard('focus', false), false);
  assert.equal(cardDepthFor('focus', false), 'none');
  assert.equal(shouldSurfaceCard('focus', true), true);
});

test('exposure pays less than recall, and focus pays nothing', () => {
  assert.ok(commandXp('drill') > commandXp('ride-along'), 'drill must out-earn ride-along');
  assert.ok(commandXp('ride-along') > 0, 'ride-along still registers something');
  assert.equal(commandXp('focus'), 0, 'silent presence earns nothing');
});

test('recall is deferred by every mode, never dropped', () => {
  for (const p of MODES) {
    assert.equal(p.queueForReview, true, `${p.mode} must still queue for review`);
  }
});

test('only drill asks inline, and only drill speaks', () => {
  const inline = MODES.filter((p) => p.quiz).map((p) => p.mode);
  const speaking = MODES.filter((p) => p.speak).map((p) => p.mode);
  assert.deepEqual(inline, ['drill']);
  assert.deepEqual(speaking, ['drill'], 'voice follows mode rather than being a separate dial');
});

test('unrecognised and hostile input falls back to the default', () => {
  for (const junk of [undefined, null, 42, {}, [], '', '   ', 'sensei', 'LEVEL 9']) {
    assert.equal(resolveMode(junk), DEFAULT_MODE);
  }
});

test('obvious spellings resolve rather than failing the call', () => {
  assert.equal(resolveMode('DRILL'), 'drill');
  assert.equal(resolveMode('ride_along'), 'ride-along');
  assert.equal(resolveMode(' Ride Along '), 'ride-along');
  assert.equal(resolveMode('ambient'), 'ride-along');
  assert.equal(resolveMode('quiet'), 'focus');
  assert.equal(resolveMode('silent'), 'focus');
  assert.equal(resolveMode('interactive'), 'drill');
});

test('a change reports whether it actually moved', () => {
  const same = requestModeChange('focus', 'focus');
  assert.equal(same.changed, false);
  assert.equal(same.mode, 'focus');

  const moved = requestModeChange('focus', 'drill');
  assert.equal(moved.changed, true);
  assert.equal(moved.policy.quiz, true);

  // Junk must not silently escalate a quiet session into a loud one.
  const junk = requestModeChange('focus', 'nonsense');
  assert.equal(junk.mode, 'focus');
  assert.equal(junk.changed, false);
  assert.equal(junk.policy.quiz, false);

  const junkDrill = requestModeChange('drill', 'LEVEL 9');
  assert.equal(junkDrill.mode, 'drill');
  assert.equal(junkDrill.changed, false);
});

test('every mode is described for a human', () => {
  assert.equal(MODES.length, 3);
  for (const p of MODES) {
    assert.ok(p.label.length > 0, `${p.mode} needs a label`);
    assert.ok(p.when.length > 20, `${p.mode} needs to say when to use it`);
  }
});

test('ride-along explains what it is, how it works, and one cost', () => {
  const s = surfaceFor('ride-along', false);
  assert.equal(s.what, true, 'you need to know what the command is');
  assert.equal(s.how, true, 'watching it run without knowing how is the case this mode is for');
  assert.equal(s.tradeoffs, 1, 'one trade-off is the best line in the card');
  // The sections that read fine an hour later stay off; the archive keeps them.
  assert.equal(s.diagram, false);
  assert.equal(s.pitfalls, false);
  assert.equal(s.docs, false);
  assert.equal(s.roadmap, false);
});

test('the diagram and the full trade-off set are drill only', () => {
  const withDiagram = MODES.filter((p) => p.surface.diagram).map((p) => p.mode);
  const withPitfalls = MODES.filter((p) => p.surface.pitfalls).map((p) => p.mode);
  assert.deepEqual(withDiagram, ['drill']);
  assert.deepEqual(withPitfalls, ['drill']);
  assert.equal(policyFor('drill').surface.tradeoffs, 'all');
  assert.equal(policyFor('ride-along').surface.tradeoffs, 1);
});

test('ride-along is still meaningfully lighter than drill', () => {
  // The mode is pointless if it is drill with the quiz removed, so this asserts
  // the gap rather than trusting the table to stay sensible.
  const count = (m: 'drill' | 'ride-along') => {
    const s = policyFor(m).surface;
    return [s.roadmap, s.what, s.how, s.diagram, s.pitfalls, s.docs].filter(Boolean).length;
  };
  assert.ok(count('ride-along') < count('drill') - 1, 'at least two sections lighter');
  assert.equal(policyFor('ride-along').quiz, false);
  assert.equal(policyFor('ride-along').speak, false);
});

test('focus surfaces nothing at all for an ordinary command', () => {
  // Asserted field by field rather than by filtering for falsy values: the
  // earlier version broke the moment a string-valued field was added, because
  // 'never' is not false. Explicit is worth the extra lines here.
  assert.deepEqual(surfaceFor('focus', false), {
    roadmap: false,
    what: false,
    how: false,
    tradeoffs: 0,
    diagram: false,
    pitfalls: false,
    docs: false,
    xpFootnote: 'never',
  });
});

test('a refusal in focus still says what it was and what it would cost', () => {
  // Someone who asked to be told nothing gets exactly one report, so it has to
  // carry the command and the consequence rather than a bare "blocked".
  const s = surfaceFor('focus', true);
  assert.equal(s.what, true);
  assert.equal(s.tradeoffs, 1);
});

test('material is deferred, not dropped: the archive is full in every mode', () => {
  assert.equal(ARCHIVE_IS_ALWAYS_FULL, true);
  // The invariant that makes the quiet modes worth using: less on screen now,
  // the same amount available later.
  for (const p of MODES) {
    assert.equal(p.queueForReview, true, `${p.mode} must still queue`);
  }
});

test('drill reports the score every turn, because that is the reward loop', () => {
  assert.equal(policyFor('drill').surface.xpFootnote, 'always');
  assert.equal(showsXpFootnote('drill', null), true);
  assert.equal(showsXpFootnote('drill', { leveledUp: false }), true);
});

test('focus never reports the score', () => {
  assert.equal(showsXpFootnote('focus', null), false);
  assert.equal(showsXpFootnote('focus', { leveledUp: true, titleChanged: true }), false);
});

test('ride-along reports only when something actually changed', () => {
  assert.equal(showsXpFootnote('ride-along', null), false);
  assert.equal(showsXpFootnote('ride-along', {}), false);
  assert.equal(showsXpFootnote('ride-along', { leveledUp: true }), true);
  assert.equal(showsXpFootnote('ride-along', { titleChanged: true }), true);
  assert.equal(showsXpFootnote('ride-along', { newBadges: ['Sharpshooter'] }), true);
  assert.equal(showsXpFootnote('ride-along', { streakMilestone: true }), true);
});

test('XP moving is not news; a level or a badge is', () => {
  assert.equal(isWorthAnnouncing(null), false);
  assert.equal(isWorthAnnouncing(undefined), false);
  assert.equal(isWorthAnnouncing({}), false);
  assert.equal(isWorthAnnouncing({ newBadges: [] }), false, 'an empty badge list is not news');
  assert.equal(isWorthAnnouncing({ leveledUp: true }), true);
});

test('a working afternoon in ride-along produces one footnote, not forty', () => {
  // The scenario the flag exists for: many commands, nothing changing, then one
  // level-up. Anything other than 1 here means the mode chirps.
  const afternoon = Array.from({ length: 40 }, (_, i) =>
    i === 27 ? { leveledUp: true } : {},
  );
  const shown = afternoon.filter((c) => showsXpFootnote('ride-along', c)).length;
  assert.equal(shown, 1);

  // The same afternoon in drill reports every turn, which is correct there.
  assert.equal(afternoon.filter((c) => showsXpFootnote('drill', c)).length, 40);
  assert.equal(afternoon.filter((c) => showsXpFootnote('focus', c)).length, 0);
});
