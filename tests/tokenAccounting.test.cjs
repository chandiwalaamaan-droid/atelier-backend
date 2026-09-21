const test=require('node:test');
const assert=require('node:assert/strict');
const {withTokenAccounting,recordProviderAttempt,recordTokenUsage}=require('../dist/lib/providers/tokenStats');
const {completeOpenAICompatibleChat,streamOpenAICompatibleChat}=require('../dist/lib/providers/openaiCompatible');
const {streamChatWithFallback,summarizeWithFallback}=require('../dist/lib/providers');
const message=[{role:'user',content:'Hello'}];
test('request totals include multiple provider attempts and mark missing usage',async()=>{
 let result;await withTokenAccounting('hazelnut','reply',async()=>{
  recordProviderAttempt();recordProviderAttempt();recordTokenUsage('test',100,20,50);
  recordProviderAttempt();recordTokenUsage('test',80,10);
 },r=>result=r);
 assert.equal(result.attempts,3);assert.equal(result.promptTokens,180);assert.equal(result.completionTokens,30);assert.equal(result.cachedTokens,50);assert.equal(result.usageComplete,false);
});
test('concurrent replies and memory work never mix usage',async()=>{
 const results=[];await Promise.all([withTokenAccounting('hazelnut','reply',async()=>{recordProviderAttempt();await Promise.resolve();recordTokenUsage('test',100,20);},r=>results.push(r)),withTokenAccounting('hazelnut','memory',async()=>{recordProviderAttempt();recordTokenUsage('test',50,5);},r=>results.push(r))]);
 assert.equal(results.find(r=>r.kind==='reply').promptTokens,100);assert.equal(results.find(r=>r.kind==='memory').promptTokens,50);assert.ok(results.every(r=>r.usageComplete));
});
test('an interrupted or empty streaming call still accounts for reported tokens',async(t)=>{
 t.mock.method(global,'fetch',async()=>new Response('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'length'}],usage:{prompt_tokens:400,completion_tokens:100}})+'\n'));
 let report;await assert.rejects(withTokenAccounting('hazelnut','reply',()=>streamOpenAICompatibleChat('https://test.invalid','test','test',message,()=>{},1000),r=>report=r));
 assert.equal(report.promptTokens,400);assert.equal(report.completionTokens,100);assert.equal(report.succeeded,false);assert.equal(report.usageComplete,true);
});
test('a truncated summary is rejected but its usage is still counted',async(t)=>{
 t.mock.method(global,'fetch',async()=>Response.json({choices:[{message:{content:'Facts: unfinished'},finish_reason:'length'}],usage:{prompt_tokens:120,completion_tokens:30}}));
 let report;await assert.rejects(withTokenAccounting('hazelnut','memory',()=>completeOpenAICompatibleChat('https://test.invalid','test','test',message,1000,undefined,640,true),r=>report=r),/did not finish normally/);
 assert.equal(report.promptTokens,120);assert.equal(report.completionTokens,30);
});
test('all failed summary providers reject instead of returning stale memory',async(t)=>{
 t.mock.method(global,'fetch',async()=>{throw new Error('test unavailable')});
 await assert.rejects(summarizeWithFallback('Old facts.',message,{maxTokens:640,requireComplete:true}),/keep the existing summary cursor/);
});
test('normal summaries can complete without triggering any recovery request',async(t)=>{
 let calls=0;t.mock.method(global,'fetch',async()=>{calls++;return Response.json({choices:[{message:{content:'Facts: The book is blue.'},finish_reason:'stop'}]})});
 assert.equal(await completeOpenAICompatibleChat('https://test.invalid','test','test',message,1000,undefined,640,true),'Facts: The book is blue.');assert.equal(calls,1);
});
test('automatic continuation is included in one user-reply usage total',async(t)=>{
 const {streamCompleteReply}=require('../dist/lib/providers/completeReply');let calls=0;
 t.mock.method(global,'fetch',async()=>{
  const first=++calls===1;
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:first?'The key is in the draw':'The key is in the drawer.'},finish_reason:first?'length':'stop'}],usage:{prompt_tokens:first?900:950,completion_tokens:first?30:20}})+'\n');
 });
 let report;const result=await withTokenAccounting('hazelnut','reply',()=>streamCompleteReply((m,onToken,signal,p)=>streamOpenAICompatibleChat('https://test.invalid','test','test',m,onToken,1000,signal,undefined,p.maxTokens,p.onFinish),message,()=>{},undefined,{maxTokens:2048}),r=>report=r);
 assert.equal(result.text,'The key is in the drawer.');assert.equal(report.promptTokens,1850);assert.equal(report.completionTokens,50);assert.equal(report.attempts,2);assert.equal(report.finishReason,'stop');assert.equal(report.continuations,1);assert.equal(report.usageComplete,true);
});
test('Hazelnut memory uses a compact state record through the actual provider adapter',async(t)=>{
 const {summarizeConversation}=require('../dist/lib/providers');const old=process.env.NVIDIA_API_KEY;process.env.NVIDIA_API_KEY='test-only';t.after(()=>{if(old===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=old});
 let request,calls=0;t.mock.method(global,'fetch',async(url,options)=>{calls++;request=JSON.parse(options.body);return Response.json({choices:[{message:{content:'Facts: The key is blue.\nBoundaries: No horror.\nScene: Shop.\nRelationship: Friends.\nOpen threads: Return the key.'},finish_reason:'stop'}]})});
 const result=await summarizeConversation({name:'Mira'},'The shop is open.',[{role:'user',content:'My key is blue.'}],false,10);
 assert.equal(calls,1);assert.match(request.messages[0].content,/Facts; Boundaries; Scene; Relationship; Open threads/);assert.match(request.messages[1].content,/The shop is open/);assert.match(result,/No horror/);assert.equal(request.max_tokens,640);assert.equal(request.temperature,.2);
});
