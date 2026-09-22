const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt, withPersonaAnchor, maxTokensForIntelligence } = require('../dist/lib/providers');
const { ROLEPLAY_ENGINES } = require('../dist/lib/providers/engines');
const character = { name: 'Mira', personality: 'Reserved, dry humor, observant', backstory: 'Keeps a small bookshop.', memorySummary: 'The user left a blue umbrella at the shop.' };

test('persona guidance preserves exact user text and role ordering', () => {
  const speech = 'Wait... did I leave my umbrella?\n(as Mira, I think?)';
  const messages = [{ role: 'system', content: 'Existing story rules.' }, { role: 'assistant', content: 'Back already?' }, { role: 'user', content: speech }];
  withPersonaAnchor(messages, character, 10);
  assert.deepEqual(messages.map(m => m.role), ['system', 'assistant', 'user']);
  assert.equal(messages[2].content, speech);
  assert.equal(messages[1].content, 'Back already?');
  assert.ok(messages[0].content.startsWith('Existing story rules.'));
  assert.match(messages[0].content, /Mira/);
});

test('continuing an assistant turn never creates a phantom user message', () => {
  for (const initial of [[], [{ role: 'assistant', content: 'The shop door opens.' }], [{role:'user',content:'Hello'}]]) {
    const messages = structuredClone(initial);
    withPersonaAnchor(messages, character, 3);
    assert.equal(messages[0].role, 'system');
    assert.deepEqual(messages.slice(1), initial);
  }
});

test('all engines retain character memory and allow brief everyday turns', () => {
  for (const engine of Object.values(ROLEPLAY_ENGINES)) {
    const prompt = buildSystemPrompt(character, { explicitMode: false, engine, voiceNotes: engine.voiceNotes });
    assert.match(prompt, /blue umbrella/);
    assert.match(prompt, /Reserved, dry humor, observant/);
    assert.match(prompt, /There is no minimum length/);
    assert.doesNotMatch(prompt, /Keep it to about \d+-\d+ sentences|Then describe what your body does|a real person in a private conversation/);
    assert.ok(maxTokensForIntelligence(engine.intelligence) > 0);
  }
});

test('inactivity metadata does not silently advance fictional time', () => {
  const engine = ROLEPLAY_ENGINES.hazelnut;
  const active = buildSystemPrompt(character, { explicitMode: false, engine, minutesSinceLastMessage: 1 });
  const returning = buildSystemPrompt(character, { explicitMode: false, engine, minutesSinceLastMessage: 1440 });
  assert.doesNotMatch(active, /Real-world message gap/);
  assert.match(returning, /Real-world message gap: about 1 day/);
  assert.match(returning, /not elapsed story time/);
  assert.match(returning, /Resume the established moment unless the user advances it/);
});
