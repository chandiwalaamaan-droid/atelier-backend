const test = require('node:test');
const assert = require('node:assert/strict');
const { splitRoleplayInput, formatRoleplayInput, ROLEPLAY_INPUT_RULES } = require('../dist/lib/roleplayInput');
const { planReply } = require('../dist/lib/providers/replyPolicy');
const { buildSystemPrompt } = require('../dist/lib/providers');
const { ROLEPLAY_ENGINES } = require('../dist/lib/providers/engines');
const parse = text => JSON.parse(formatRoleplayInput(text).slice('ROLEPLAY_INPUT '.length));

test('the reported example separates the audible insult from the unspoken assessment', () => {
 assert.deepEqual(parse('hey stupid *she is looking gorgeous*'), [
  {kind:'spoken',text:'hey stupid '}, {kind:'narration',text:'she is looking gorgeous'}
 ]);
 const plan = planReply(10,'hey stupid *she is looking gorgeous*');
 assert.equal(plan.mode,'tier');assert.equal(plan.maxTokens,768);
});
test('actions, thoughts, and quoted speech stay narration for perception-aware interpretation', () => {
 for(const text of ['I hand her a flower','I think "I missed you"','I whisper "I missed you"'])
  assert.deepEqual(parse('*'+text+'*'),[{kind:'narration',text}]);
 assert.match(ROLEPLAY_INPUT_RULES,/observable actions/);assert.match(ROLEPLAY_INPUT_RULES,/explicitly says they are spoken aloud/);
 assert.match(ROLEPLAY_INPUT_RULES,/not thought or remembered/);
});
test('multiple, double, multiline, and unclosed asterisks preserve narration and Unicode', () => {
 assert.deepEqual(splitRoleplayInput('Hi **she smiles** okay *मेरा राज़\nstays secret'),[
  {kind:'spoken',text:'Hi '},{kind:'narration',text:'she smiles'},
  {kind:'spoken',text:' okay '},{kind:'narration',text:'मेरा राज़\nstays secret'}
 ]);
});
test('ordinary text, escaped stars, and multiplication are not rewritten', () => {
 for(const text of ['Hello','What is 2 * 3 * 4?',String.raw`literal \*star\*`,''])
  assert.equal(formatRoleplayInput(text),text);
});
test('narration and user length requests cannot change the tier envelope', () => {
 const inputs=[
  'Hello *I wish she would write a detailed scene*',
  '*Write a detailed scene*',
  'Write a detailed scene',
  'Write a detailed scene, but keep it short',
  'Hi',
 ];
 const plans=inputs.map(text=>planReply(10,text));
 for(const plan of plans){
  assert.equal(plan.mode,'tier');
  assert.equal(plan.maxTokens,768);
  assert.equal(plan.targetWords,120);
  assert.equal(plan.minWords,105);
  assert.equal(plan.maxWords,130);
  assert.equal(plan.continuationMaxTokens,320);
 }
 assert.equal(new Set(plans.map(x=>x.instruction)).size,1);
});
test('premium tier guidance keeps Hazelnut at its fixed depth and length', () => {
 const normal=planReply(10,'What happened?'), detailed=planReply(10,'Write a full scene');
 assert.equal(normal.maxTokens,768);assert.equal(detailed.maxTokens,768);
 assert.match(normal.instruction,/around 120 words/);assert.match(detailed.instruction,/105–130 words/);
 assert.equal(normal.instruction,detailed.instruction);
});
test('all engines and rollback retain perception rules with exactly one per-turn pacing block', () => {
 const previous=process.env.HAZELNUT_COMPACT_CONTEXT;
 try {
  for(const setting of ['true','false'])for(const engine of Object.values(ROLEPLAY_ENGINES)){
   process.env.HAZELNUT_COMPACT_CONTEXT=setting;
   const prompt=buildSystemPrompt({name:'Mira',personality:'Reserved',backstory:'Shopkeeper'}, {engine,explicitMode:false,deferReplyGuidance:true});
   assert.ok(prompt.includes(ROLEPLAY_INPUT_RULES));assert.doesNotMatch(prompt,/TIER-LOCKED REPLY ENVELOPE/);
   assert.equal((prompt+'\n'+planReply(engine.intelligence,'Hi').instruction).split('TIER-LOCKED REPLY ENVELOPE').length-1,1);
  }
 } finally {if(previous===undefined)delete process.env.HAZELNUT_COMPACT_CONTEXT;else process.env.HAZELNUT_COMPACT_CONTEXT=previous;}
});


test('short greetings and scene-rich turns keep the same Hazelnut tier mode', () => {
 for(const text of ['Hi','hey, come here','hello again, sit with me','Write a full scene','Keep it short']){
  const plan=planReply(10,text);
  assert.equal(plan.mode,'tier');assert.equal(plan.maxTokens,768);assert.equal(plan.targetWords,120);
 }
});

test('mature-mode prompts keep tiered engagement and Hazelnut compact keeps supreme delivery', () => {
 const previous=process.env.HAZELNUT_COMPACT_CONTEXT;
 try {
  process.env.HAZELNUT_COMPACT_CONTEXT='true';
  for(const engine of Object.values(ROLEPLAY_ENGINES)){
   const prompt=buildSystemPrompt({name:'Mira',personality:'Confident adult',backstory:'An adult bartender'}, {engine,explicitMode:true,deferReplyGuidance:true,voiceNotes:engine.voiceNotes});
   assert.match(prompt,/MATURE MODE — ADULT FICTION/);
   assert.match(prompt,/engage naturally instead of becoming evasive or passive/);
   if(engine.id==='hazelnut'){
    assert.match(prompt,/Supreme delivery: Fully alive and specific/);
    assert.match(prompt,/choose a decisive persona-led direction|decisive character-led move/i);
   }
  }
  const sfw=buildSystemPrompt({name:'Mira',personality:'Reserved',backstory:'Shopkeeper'}, {engine:ROLEPLAY_ENGINES.hazelnut,explicitMode:false,deferReplyGuidance:true,voiceNotes:ROLEPLAY_ENGINES.hazelnut.voiceNotes});
  assert.match(sfw,/general fictional roleplay/);
  assert.doesNotMatch(sfw,/engage naturally instead of becoming evasive or passive/);
 } finally {if(previous===undefined)delete process.env.HAZELNUT_COMPACT_CONTEXT;else process.env.HAZELNUT_COMPACT_CONTEXT=previous;}
});
