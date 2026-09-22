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

test('all engines retain character memory and keep their tier-locked response envelope', () => {
  for (const engine of Object.values(ROLEPLAY_ENGINES)) {
    const prompt = buildSystemPrompt(character, { explicitMode: false, engine, voiceNotes: engine.voiceNotes });
    assert.match(prompt, /blue umbrella/);
    assert.match(prompt, /Reserved, dry humor, observant/);
    assert.match(prompt, /TIER-LOCKED REPLY ENVELOPE/);
    assert.match(prompt, /stay stable regardless of whether the latest user message|full Hazelnut-tier depth|latest user message.*must not downgrade that tier quality/i);
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

test('compact Hazelnut receives its engine voice notes and no trailing short-reply downgrade', () => {
 const engine=ROLEPLAY_ENGINES.hazelnut;
 const prompt=buildSystemPrompt(character,{explicitMode:true,engine,voiceNotes:engine.voiceNotes});
 assert.match(prompt,/HAZELNUT VOICE NOTES/);
 assert.match(prompt,/decisive character-led move|persona-led initiative/i);
 assert.match(prompt,/non-graphic/i);
 const messages=[{role:'system',content:prompt},{role:'user',content:'Hi'}];
 withPersonaAnchor(messages,character,10);
 assert.doesNotMatch(messages[0].content,/Short replies are valid/i);
 assert.match(messages[0].content,/tier-locked depth/i);
});

test('Chocolate and Hazelnut mature-mode prompts emphasize proactive romance without changing persona or consent',()=>{
 for(const id of ['chocolate','hazelnut']){
  const engine=ROLEPLAY_ENGINES[id];
  const prompt=buildSystemPrompt(character,{explicitMode:true,engine,voiceNotes:engine.voiceNotes});
  assert.match(prompt,/adult romantic tension|adult romance/i);
  assert.match(prompt,/persona-led/i);
  assert.match(prompt,/non-graphic/i);
  assert.match(prompt,/consent/i);
  assert.match(prompt,/Reserved, dry humor, observant/);
 }
});

test('premium adult mode keeps Janitor-like initiative while remaining adult-only and non-graphic',()=>{
 const chocolate=buildSystemPrompt({name:'Mira',personality:'Confident adult, playful',backstory:'A 27-year-old bartender'}, {explicitMode:true,engine:ROLEPLAY_ENGINES.chocolate,voiceNotes:ROLEPLAY_ENGINES.chocolate.voiceNotes});
 assert.match(chocolate,/clearly 18\+|adult-only/i);
 assert.match(chocolate,/kiss, pull closer, guide posture|sensual move/i);
 assert.match(chocolate,/emotional reaction/i);
 assert.match(chocolate,/committed dialogue/i);
 assert.match(chocolate,/non-graphic/i);
 assert.match(chocolate,/no genital detail/i);
 assert.match(chocolate,/reuse established direct adult vocabulary|plain term instead of replacing it with vague euphemisms/i);
 assert.match(chocolate,/dialogue as well as narration|including in dialogue/i);
 assert.doesNotMatch(chocolate,/non-anatomical/i);

 const hazelnut=buildSystemPrompt({name:'Mira',personality:'Confident adult, playful',backstory:'A 27-year-old bartender'}, {explicitMode:true,engine:ROLEPLAY_ENGINES.hazelnut,voiceNotes:ROLEPLAY_ENGINES.hazelnut.voiceNotes});
 assert.match(hazelnut,/possessive, commanding, provocative, needy, submissive/i);
 assert.match(hazelnut,/layered (?:beat|emotional reaction)/i);
 assert.match(hazelnut,/specific sensual action/i);
 assert.match(hazelnut,/neutral small talk/i);
 assert.match(hazelnut,/leave the user's consent, dialogue, feelings, and actions to them/i);
 assert.match(hazelnut,/Match direct adult vocabulary|reuse that plain term/i);
 assert.match(hazelnut,/actually say the relevant word in dialogue|Direct terms may appear in dialogue/i);
 assert.doesNotMatch(hazelnut,/non-anatomical/i);
});
