const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { buildStoryContext } = require('../dist/lib/storyContext');
function mock(file, exports) {
  const filename = require.resolve(path.join(__dirname, '..', 'dist', file));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
let rows = [], calls = 0, fail = false, failSave = false, release = null, block = false, captured, capturedParams, capturedSystemOptions, userExplicitMode=false, replyText = "A quiet room.", finishReason = "stop", summaryCalls=0, summaryFail=false, summaryBlock=false, summaryRelease=null, summaryInputs=null, archiveQueries=[], archiveFail=false;
const character = { id:'char-a', ownerId:'user-a', name:'The guide', personality:'Curious', backstory:'', greeting:'Hello.', roleplayNotes:'', tagline:'A traveler', memorySummary:'', summarizedThrough:0, examples:'[]', explicitEverUsed:false };
const matches = (r,w={}) => Object.entries(w).every(([k,v]) => k === 'OR' ? v.some(x=>matches(r,x)) : k === 'content' && v && typeof v === 'object' ? r.content.toLowerCase().includes(v.contains.toLowerCase()) : k === 'createdAt' ? (!v.gt || r.createdAt > v.gt) && (!v.lt || r.createdAt < v.lt) : r[k] === v);
const ordered = (w, order) => rows.filter(r=>matches(r,w)).sort((a,b)=>(a.createdAt-b.createdAt)*(JSON.stringify(order).includes('desc')?-1:1));
const create = data => { const row={id:'generated-'+(rows.length+1),createdAt:new Date(Date.now()+rows.length),...data};rows.push(row);return row; };
const prisma = {
 character: { findUnique: async ({where}) => where.id === character.id ? {...character} : null, update: async ({data}) => Object.assign(character,data), updateMany:async({where,data})=>{if(!matches(character,where))return {count:0};Object.assign(character,data);return {count:1}} },
 user: {findUnique:async()=>({membershipTier:'free',explicitMode:userExplicitMode})},
 message: {
   findUnique:async ({where})=>rows.find(r=>r.id===where.id)||null,
   findFirst:async ({where,orderBy})=>ordered(where,orderBy)[0]||null,
   findMany:async ({where,orderBy,skip=0,take})=>{if(where.OR){archiveQueries.push({where,take});if(archiveFail)throw Error("archive offline");}return ordered(where,orderBy).slice(skip,take===undefined?undefined:skip+take)},
   count:async ({where})=>rows.filter(r=>matches(r,where)).length,
   create:async ({data})=>create(data),
   upsert:async ({where,update,create:data})=>{const row=rows.find(r=>r.id===where.id);return row?Object.assign(row,update):create(data)},
   update:async ({where,data})=>{if(failSave)throw Error('save unavailable');return Object.assign(rows.find(r=>r.id===where.id),data)},
   delete:async ({where})=>{rows=rows.filter(r=>r.id!==where.id)},
 }
};
mock('lib/db.js',{prisma});
mock('lib/auth.js',{getCurrentUserId:async req=>req.headers['x-test-user']||'user-a'});
mock('lib/rateLimit.js',{checkRateLimit:()=>({limited:false})});

mock('lib/providers/index.js',{
 summarizeConversation:async(...args)=>{summaryCalls++;summaryInputs=args;if(summaryBlock)await new Promise(r=>summaryRelease=r);if(summaryFail)throw Error('summary unavailable');return 'Facts: The brass compass is in the blue drawer.\nBoundaries: No horror.';},
 buildSystemPrompt:(_character,options)=>{capturedSystemOptions=options;return 'Character instructions.';}, RECENT_MESSAGE_WINDOW:20, SUMMARIZE_TRIGGER:1000,
 parseSpiceLevel:()=>undefined,parseRoleplayStyle:()=>undefined, maxTokensForIntelligence:()=>500,
 withPersonaAnchor:()=>{}, cleanAssistantResponse:x=>x,
 streamChatWithFallback:async (messages,onChunk,onFailover,signal,params)=>{calls++;captured=messages;capturedParams=params;if(block) await new Promise(r=>release=r);if(fail) throw Error('provider unavailable');onChunk(replyText);return {text:replyText,provider:'test',finishReason};}
});
const router = require('../dist/routes/chat').default;
const app=express();app.use(express.json());app.use('/api/chat',router);
let server,base;
test.before(async()=>{await new Promise(r=>{server=app.listen(0,'127.0.0.1',r)});base=`http://127.0.0.1:${server.address().port}/api/chat/char-a`});
test.after(()=>new Promise(r=>server.close(r)));
test.beforeEach(()=>{rows=[];calls=0;fail=false;failSave=false;block=false;release=null;capturedSystemOptions=undefined;userExplicitMode=false;replyText="A quiet room.";finishReason="stop";summaryCalls=0;summaryFail=false;summaryBlock=false;summaryRelease=null;summaryInputs=null;archiveQueries=[];archiveFail=false;character.summarizedThrough=0;character.memorySummary="";character.explicitEverUsed=false;});
const post = (body,headers={}) => fetch(base,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const turn={message:'Hello',requestId:'12345678-abcd-1234-abcd-123456789000'};
test('completed retries replay without another generation or duplicate rows',async()=>{
 await (await post({...turn,story:{personaName:'Rae',scene:'A train station',boundaries:'No horror',tone:'gentle'}})).text();
 assert.equal(rows.length,2);assert.match(captured[0].content,/A train station/);assert.match(captured[0].content,/No horror/);
 assert.equal(await (await post(turn)).text(),'A quiet room.');assert.equal(rows.length,2);assert.equal(calls,1);
});
test('failed provider retries preserve exactly one user turn',async()=>{
 fail=true;assert.match(await (await post(turn)).text(),/fatal/);assert.equal(rows.length,1);
 fail=false;await (await post(turn)).text();assert.equal(rows.length,2);assert.equal(rows.filter(r=>r.role==='user').length,1);
});
test('request IDs cannot silently change message content',async()=>{
 await (await post(turn)).text();assert.equal((await post({...turn,message:'Changed'})).status,409);assert.equal(rows.length,2);
});
test('regeneration updates in place and a failed save preserves the original',async()=>{
 await (await post(turn)).text();const id=rows[1].id;
 await (await post({regenerate:true})).text();assert.equal(rows.length,2);assert.equal(rows[1].id,id);
 rows[1].content='Keep this answer.';failSave=true;await (await post({regenerate:true})).text();assert.equal(rows[1].content,'Keep this answer.');
});
test('concurrent sends and destructive mutations are rejected during a reply',async()=>{
 block=true;const pending=post(turn);
 for(let i=0;i<100&&!release;i++) await new Promise(r=>setTimeout(r,5));
 assert.ok(release);assert.equal((await post({...turn,requestId:'another-valid-request-id'})).status,409);
 assert.equal((await fetch(base,{method:'DELETE'})).status,409);
 release();await (await pending).text();assert.equal(rows.length,2);
});
test('ownership is checked before reading or generating',async()=>{
 assert.equal((await post(turn,{'x-test-user':'stranger'})).status,404);assert.equal(rows.length,0);assert.equal(calls,0);
});
test('story input is bounded and optional',()=>{
 assert.equal(buildStoryContext(null),'');assert.equal(buildStoryContext({tone:'constructor'}),'');
 const result=buildStoryContext({scene:'x'.repeat(9000),personaName:4,boundaries:'No horror',tone:'dialogue'});
 assert.ok(result.length<2500);assert.match(result,/Never invent the user's/);assert.match(result,/No horror/);
});

test('engine switches replan pacing in an existing conversation and preserve the full response',async()=>{
 replyText='*Opens a book.* First. *Points.* Second. *Closes it.* Third. "That is everything."';
 const budgets=[];
 for(const engineId of ['vanilla','strawberry','chocolate','hazelnut']){
  const wire=await (await post({message:'Tell me what happened',engineId})).text();
  budgets.push(capturedParams.maxTokens);
  assert.equal(rows.at(-1).content,replyText);assert.ok(wire.startsWith(replyText));assert.match(wire,/reply_final/);
  assert.ok(captured[0].content.includes(engineId[0].toUpperCase()+engineId.slice(1)));
 }
 assert.equal(new Set(budgets).size,4);
});
test('unresolved cutoff is saved and surfaced, never silently declared complete',async()=>{
 replyText='The rest is';finishReason='length';
 const wire=await (await post(turn)).text();assert.match(wire,/reply_incomplete/);assert.equal(rows.at(-1).content,replyText);
});

function seedHistory(count=24){
 for(let i=0;i<count;i++)create({id:'history-'+i,characterId:'char-a',userId:'user-a',role:i%2?'assistant':'user',content:i%2?'Mira watches the rain. '.repeat(70):'We discuss the shelves. '.repeat(12),createdAt:new Date(1000+i*1000)});
}
async function settle(predicate){for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate(),'background task finished');}
test('Hazelnut selects archived facts only from the owned conversation',async()=>{
 create({id:'archived',characterId:'char-a',userId:'user-a',role:'user',content:'The brass compass is in the blue drawer.',createdAt:new Date(0)});
 create({id:'private',characterId:'different-character',userId:'other-user',role:'user',content:'My brass compass secret is FOREIGN.',createdAt:new Date(1)});
 seedHistory(14);character.summarizedThrough=1;character.memorySummary='Facts: We visited the shop.';
 await (await post({message:'Where is my brass compass?',engineId:'hazelnut'})).text();
 assert.equal(archiveQueries.length,1);assert.equal(archiveQueries[0].where.userId,'user-a');assert.equal(archiveQueries[0].where.characterId,'char-a');assert.equal(archiveQueries[0].take,16);
 assert.match(captured[0].content,/brass compass is in the blue drawer/);assert.doesNotMatch(JSON.stringify(captured),/FOREIGN/);
 assert.equal(captured.at(-1).content,'Where is my brass compass?');assert.equal(calls,1);assert.equal(summaryCalls,0);
});
test('optional archive failures preserve the latest exchange and do not fail the reply',async()=>{
 seedHistory(14);character.summarizedThrough=2;archiveFail=true;
 const wire=await (await post({message:'Where is the compass?',engineId:'hazelnut'})).text();assert.match(wire,/reply_final/);assert.equal(captured.at(-1).content,'Where is the compass?');assert.equal(calls,1);
});

test('missing explicitMode inherits the saved account preference, while explicit false overrides it',async()=>{
 userExplicitMode=true;
 await (await post({message:'Hello',engineId:'hazelnut'})).text();
 assert.equal(capturedSystemOptions.explicitMode,true);
 await (await post({message:'Hello again',engineId:'hazelnut',explicitMode:false})).text();
 assert.equal(capturedSystemOptions.explicitMode,false);
});


test('Chocolate uses the canonical NVIDIA-first fallback chain',async()=>{
 await (await post({message:'Hello',engineId:'chocolate'})).text();
 assert.equal('groqFirst' in capturedParams,false);
 assert.equal(capturedParams.maxTokens,224);
});

test('Hazelnut keeps one fixed tier envelope regardless of message type',async()=>{
 for(const message of ['Hello','What happened at the bookshop?','Write a full scene','Keep it short','*She looks away*']){
  const before=calls;
  await (await post({message,engineId:'hazelnut'})).text();
  assert.equal(calls,before+1);assert.equal(summaryCalls,0);
  assert.equal(capturedParams.maxTokens,256);
  assert.equal(capturedParams.continuationMaxTokens,160);
  assert.equal(capturedParams.targetWords,120);
  assert.equal(capturedParams.minWords,105);
  assert.equal(capturedParams.maxWords,130);
  assert.equal(capturedParams.temperature,.87);assert.equal(capturedParams.topP,.95);
  assert.equal('groqFirst' in capturedParams,false);
  assert.match(captured[0].content,/around 120 words/);
 }
});
test('failed memory updates leave the cursor untouched and are retried later',async()=>{
 seedHistory();summaryFail=true;await (await post({message:'Hello',engineId:'hazelnut'})).text();
 await settle(()=>summaryCalls===1);await new Promise(r=>setTimeout(r,5));assert.equal(character.summarizedThrough,0);assert.equal(character.memorySummary,'');
 summaryFail=false;await (await post({message:'Hello again',engineId:'hazelnut'})).text();await settle(()=>character.summarizedThrough>0);
 assert.equal(summaryCalls,2);assert.equal(character.summarizedThrough,summaryInputs[2].length);assert.ok(character.summarizedThrough>=16);
});
test('concurrent background memory work uses one call and advances only through its snapshot',async()=>{
 seedHistory();summaryBlock=true;await (await post({message:'Hello',engineId:'hazelnut'})).text();await settle(()=>!!summaryRelease);
 await (await post({message:'Hello again',engineId:'hazelnut'})).text();assert.equal(summaryCalls,1);
 summaryRelease();await settle(()=>character.summarizedThrough>0);assert.equal(character.summarizedThrough,16);assert.equal(summaryInputs[2].length,16);
});
test('memory backlog folds a bounded contiguous prefix rather than skipping records',async()=>{
 seedHistory(100);await (await post({message:'Hello',engineId:'hazelnut'})).text();await settle(()=>character.summarizedThrough>0);
 assert.ok(summaryInputs[2].length<=24);assert.equal(character.summarizedThrough,summaryInputs[2].length);
 assert.equal(summaryInputs[2][0].id,'history-0');
});
test('runtime rollback restores full recent Hazelnut context and avoids archive retrieval',async()=>{
 process.env.HAZELNUT_COMPACT_CONTEXT='false';
 try{seedHistory(20);await (await post({message:'Where is the compass?',engineId:'hazelnut'})).text();assert.equal(captured.length,22);assert.equal(archiveQueries.length,0);assert.equal(summaryCalls,0);}
 finally{delete process.env.HAZELNUT_COMPACT_CONTEXT;}
});

test('all engines label narration only for generation, preserving stored input through regenerate and Continue',async()=>{
 const input='hey stupid *she is looking gorgeous*';
 for(const engineId of ['vanilla','strawberry','chocolate','hazelnut']){
  replyText='*She raises an eyebrow.* That is your greeting?';
  await (await post({message:input,engineId})).text();
  assert.equal(rows.filter(r=>r.role==='user').at(-1).content,input);
  assert.deepEqual(JSON.parse(captured.at(-1).content.slice('ROLEPLAY_INPUT '.length)),[
   {kind:'spoken',text:'hey stupid '},{kind:'narration',text:'she is looking gorgeous'}
  ]);
  const expected={vanilla:128,strawberry:104,chocolate:224,hazelnut:256}[engineId];
  const continuationExpected=engineId==='strawberry'?104:160;
  assert.equal(capturedParams.maxTokens,expected);assert.equal(capturedParams.continuationMaxTokens,continuationExpected);
 }
 const userCount=rows.filter(r=>r.role==='user').length;
 await (await post({regenerate:true,engineId:'hazelnut'})).text();
 assert.match(captured.at(-1).content,/ROLEPLAY_INPUT/);
 await (await post({sceneDirective:'Continue the current moment',engineId:'hazelnut'})).text();
 assert.equal(rows.filter(r=>r.role==='user').length,userCount);
 assert.equal(captured.at(-1).role,'assistant');assert.equal(captured.at(-1).content,replyText);
 assert.ok(captured.filter(m=>m.role==='user').every(m=>m.content.startsWith('ROLEPLAY_INPUT ')));
});
