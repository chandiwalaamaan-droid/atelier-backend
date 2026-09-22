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
 assert.equal(plan.mode,'brief');assert.equal(plan.maxTokens,256);
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
test('narration requesting detail cannot enlarge the reply budget', () => {
 assert.equal(planReply(10,'Hello *I wish she would write a detailed scene*').mode,'brief');
 assert.equal(planReply(10,'*Write a detailed scene*').mode,'ordinary');
 assert.equal(planReply(10,'Write a detailed scene').mode,'detailed');
 assert.equal(planReply(10,'Write a detailed scene, but keep it short').mode,'brief');
});
test('ordinary premium replies are concise while explicit development has separate headroom', () => {
 const normal=planReply(10,'What happened?'), detailed=planReply(10,'Write a full scene');
 assert.equal(normal.maxTokens,768);assert.equal(detailed.maxTokens,2048);
 assert.match(normal.instruction,/1–3 sentences/);assert.doesNotMatch(detailed.instruction,/1–3 sentences/);
 assert.equal(normal.continuationMaxTokens,320);assert.equal(detailed.continuationMaxTokens,768);
});
test('all engines and rollback retain perception rules with exactly one per-turn pacing block', () => {
 const previous=process.env.HAZELNUT_COMPACT_CONTEXT;
 try {
  for(const setting of ['true','false'])for(const engine of Object.values(ROLEPLAY_ENGINES)){
   process.env.HAZELNUT_COMPACT_CONTEXT=setting;
   const prompt=buildSystemPrompt({name:'Mira',personality:'Reserved',backstory:'Shopkeeper'}, {engine,explicitMode:false,deferReplyGuidance:true});
   assert.ok(prompt.includes(ROLEPLAY_INPUT_RULES));assert.doesNotMatch(prompt,/Reply pacing/);
   assert.equal((prompt+'\n'+planReply(engine.intelligence,'Hi').instruction).split('Reply pacing').length-1,1);
  }
 } finally {if(previous===undefined)delete process.env.HAZELNUT_COMPACT_CONTEXT;else process.env.HAZELNUT_COMPACT_CONTEXT=previous;}
});
