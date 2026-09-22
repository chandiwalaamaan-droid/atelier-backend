const test=require('node:test');
const assert=require('node:assert/strict');
const {selectHazelnutContext,estimateTokens,recallTerms}=require('../dist/lib/hazelnutContext');
const {buildSystemPrompt,withPersonaAnchor}=require('../dist/lib/providers');
const {planReply}=require('../dist/lib/providers/replyPolicy');
const {ROLEPLAY_ENGINES}=require('../dist/lib/providers/engines');
const engine=ROLEPLAY_ENGINES.hazelnut;
const character={name:'Mira',personality:'Reserved, dry humor, observant',backstory:'Keeps a small bookshop.',roleplayNotes:'No horror. Do not reveal the unopened letter.',memorySummary:'Facts: Rae left a blue umbrella.\nBoundaries: Rae dislikes horror.\nScene: The shop is closing.\nRelationship: A cautious friendship.\nOpen threads: Return the umbrella.'};
const row=(id,role,content)=>({id:String(id).padStart(4,'0'),role,content,createdAt:new Date(Number(id)*1000)});
function history(n=30){return Array.from({length:n},(_,i)=>row(i,i%2?'assistant':'user',i%2?('The rain taps against the window as Mira looks toward the quiet street. '.repeat(7)+'She returns to the conversation.'):('We examine another shelf and discuss the shop. '.repeat(3))));}
function prompt(compact){
 const previous=process.env.HAZELNUT_COMPACT_CONTEXT;
 process.env.HAZELNUT_COMPACT_CONTEXT=compact?'true':'false';
 try{
  const messages=[{role:'system',content:buildSystemPrompt(character,{engine,voiceNotes:engine.voiceNotes,explicitMode:false,deferReplyGuidance:true})}];
  if(!compact)withPersonaAnchor(messages,character,10);
  return messages[0].content+'\n\n'+planReply(10,'Where did I leave my umbrella?').instruction;
 }finally{if(previous===undefined)delete process.env.HAZELNUT_COMPACT_CONTEXT;else process.env.HAZELNUT_COMPACT_CONTEXT=previous;}
}
test('compact premium prompt keeps identity, boundaries, memory and one pacing block',()=>{
 const p=prompt(true);
 for(const text of ['Mira','Reserved, dry humor, observant','No horror','unopened letter','blue umbrella','cautious friendship','Return the umbrella'])assert.ok(p.includes(text),text);
 assert.equal(p.split('Reply pacing').length-1,1);
 assert.ok(estimateTokens(p)<estimateTokens(prompt(false))*.75);
 assert.match(p,/never invent shared history/);assert.match(p,/user's speech, feelings, actions, and consent/);
});
test('long chats retain an exact recent suffix and select a specific old callback',()=>{
 const input=history();input[0]=row(0,'user','I left the brass compass inside the blue drawer.');input[28]=row(28,'user','Where is my brass compass?');
 const original=structuredClone(input);
 const r=selectHazelnutContext({history:input,query:input[28].content,systemTokens:1000,targetTokens:2400});
 assert.deepEqual(r.messages.slice(-4),input.slice(-4).map(({role,content})=>({role,content})));
 assert.match(r.memory,/brass compass inside the blue drawer/);assert.match(r.memory,/"speaker":"user"/);
 assert.ok(r.messages.length<input.length);assert.deepEqual(input,original);assert.ok(r.diagnostics.estimatedInputTokens<=2400);
});
test('older boundaries and pending promises outrank repeated scenery',()=>{
 const input=history();input[2]=row(2,'user','Please never bring snakes into this story. I promised to return her silver pendant.');
 const r=selectHazelnutContext({history:input,query:'What happens next?',systemTokens:900,targetTokens:2400});
 assert.match(r.memory,/never bring snakes/);assert.match(r.memory,/silver pendant/);
});
test('oversized current messages are preserved in full and explicitly exceed the soft target',()=>{
 const input=[row(1,'user','Long background. '.repeat(700)),row(2,'assistant','I understand.'),row(3,'user','Please explain the decision.')];
 const r=selectHazelnutContext({history:input,query:input[2].content,systemTokens:1000,targetTokens:1800});
 assert.deepEqual(r.messages,input.map(({role,content})=>({role,content})));assert.equal(r.diagnostics.protectedOverflow,true);
});
test('Continue keeps the unfinished assistant tail and never creates a user turn',()=>{
 const input=[row(1,'assistant','Welcome.'),row(2,'user','Tell me.'),row(3,'assistant','The key was hidden in')];
 const r=selectHazelnutContext({history:input,query:'Continue',systemTokens:100});
 assert.equal(r.messages.at(-1).content,'The key was hidden in');assert.equal(r.messages.filter(x=>x.role==='user').length,1);
});
test('archived recall is deduplicated and corrections are ordered chronologically',()=>{
 const input=history(20);input[18]=row(18,'user','Where is the pendant?');
 const archived=[row(-1,'user','Correction: the pendant is in the safe.'),row(-2,'user','The pendant was on the desk.')];
 const r=selectHazelnutContext({history:input,recalled:[...archived,...archived],query:'pendant',systemTokens:900,targetTokens:2400});
 assert.ok(r.memory.indexOf('on the desk')<r.memory.indexOf('in the safe'));assert.equal(r.memory.split('in the safe').length-1,1);
});
test('Unicode retrieval and unpunctuated lines preserve source text',()=>{
 const input=history();input[0]=row(0,'user','मेरा नीला छाता दुकान में है\nThe café key is in drawer 3.');
 const r=selectHazelnutContext({history:input,query:'नीला छाता café key',systemTokens:900,targetTokens:2600});
 assert.match(r.memory,/मेरा नीला छाता दुकान में है/);assert.match(r.memory,/café key/);
 assert.ok(recallTerms('नीला छाता').includes('छाता'));
});
test('greetings do not create recall queries and empty history remains empty',()=>{
 assert.deepEqual(recallTerms('Hi, how are you?'),[]);
 const r=selectHazelnutContext({history:[],query:'Hello',systemTokens:900});assert.deepEqual(r.messages,[]);assert.equal(r.memory,'');
});
test('synthetic long-chat comparison reports input estimates, without claiming live model quality',()=>{
 for(const n of [12,24,36]){
  const input=history(n),oldPrompt=prompt(false),newPrompt=prompt(true);
  const r=selectHazelnutContext({history:input,query:'blue umbrella',systemTokens:estimateTokens(newPrompt)});
  const before=estimateTokens(oldPrompt)+input.reduce((n,m)=>n+estimateTokens(m.content)+5,0);
  const after=r.diagnostics.estimatedInputTokens;
  assert.ok(after<before*.75,`n=${n}, before=${before}, after=${after}`);
  console.log(JSON.stringify({benchmark:'synthetic-input-estimate',historyMessages:n,before,after,reductionPercent:Math.round((1-after/before)*100)}));
 }
});

test('archived excerpts preserve private narration separately from spoken words',()=>{
 const input=history(20);
 const recalled=[row(-1,'user','The pendant is missing. *I secretly hid the pendant in my drawer. She looks gorgeous.*')];
 const r=selectHazelnutContext({history:input,recalled,query:'pendant gorgeous drawer',systemTokens:900,targetTokens:2800});
 const entries=JSON.parse(r.memory.slice(r.memory.indexOf('[{"speaker"')));
 assert.ok(entries.some(e=>e.kind==='spoken'&&e.quote==='The pendant is missing.'));
 assert.ok(entries.some(e=>e.kind==='narration'&&e.quote==='I secretly hid the pendant in my drawer.'));
 assert.ok(entries.some(e=>e.kind==='narration'&&e.quote==='She looks gorgeous.'));
});
