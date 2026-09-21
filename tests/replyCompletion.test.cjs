const test = require('node:test');
const assert = require('node:assert/strict');
const { streamCompleteReply } = require('../dist/lib/providers/completeReply');
const { planReply, replyProfile } = require('../dist/lib/providers/replyPolicy');
const { cleanAssistantResponse, streamChatWithFallback } = require('../dist/lib/providers');
const { streamOpenAICompatibleChat } = require('../dist/lib/providers/openaiCompatible');
const { streamOllamaChat } = require('../dist/lib/providers/ollama');
const messages = [{role:'system',content:'A bookshop conversation.'},{role:'user',content:'What happened?'}];
function scripted(steps) {
 let calls=0; const inputs=[];
 const stream=async (m,onToken,signal,p)=>{ inputs.push({messages:m,params:p});const step=steps[calls++];if(step instanceof Error)throw step;onToken(step.text);p.onFinish(step.reason);return step.text;};
 return {stream,inputs,get calls(){return calls;}};
}
test('engine budgets differ and explicit detail gets headroom without forcing a minimum',()=>{
 const tiers=[3,6,8,10]; const budgets=tiers.map(n=>planReply(n,'What happened?').maxTokens);
 assert.equal(new Set(budgets).size,4);
 for(const n of tiers){
  assert.ok(planReply(n,'Explain in detail').maxTokens>replyProfile(n).tokens);
  assert.ok(planReply(n,'Keep it short').maxTokens<=512);
  assert.match(planReply(n,'Hi').instruction,/There is no minimum length/);
  assert.match(planReply(n,'Hi').instruction,/another engine/);
 }
});
test('normal unpunctuated dialogue and quoted endings are preserved without extra calls',async()=>{
 for(const text of ['Sure','"See you tomorrow."','हाँ, ठीक है','*She waves*']){
  const s=scripted([{text,reason:'stop'}]);let visible='';
  const r=await streamCompleteReply(s.stream,messages,t=>visible+=t);
  assert.equal(s.calls,1);assert.equal(r.finishReason,'stop');assert.equal(visible,text);
  assert.equal(cleanAssistantResponse(text,3),text);
 }
});
test('cleanup preserves multiple actions and the answer after them at every tier',()=>{
 const text='*She opens the door.* Hello. *She steps aside.* Come in. *She points upstairs.* Your room is ready. *She smiles.* The key is on the table.';
 for(const n of [3,6,8,10]) assert.equal(cleanAssistantResponse(text,n),text);
});
test('length cutoff recovers an unfinished word on the same stream and appends only the suffix',async()=>{
 const s=scripted([{text:'I left it in the cupb',reason:'length'},{text:'I left it in the cupboard.',reason:'stop'}]);let visible='';
 const r=await streamCompleteReply(s.stream,messages,t=>visible+=t,undefined,{maxTokens:896,temperature:.79});
 assert.equal(r.text,'I left it in the cupboard.');assert.equal(visible,r.text);assert.equal(r.finishReason,'stop');assert.equal(s.calls,2);
 assert.equal(s.inputs[1].params.temperature,.79);assert.equal(s.inputs[1].messages.filter(m=>m.role==='user').length,1);
});
test('cutoff at punctuation still recovers because a sentence can be an unfinished answer',async()=>{
 const s=scripted([{text:'First, open the door.',reason:'length'},{text:'First, open the door. Then turn left.',reason:'stop'}]);
 const r=await streamCompleteReply(s.stream,messages,()=>{});assert.equal(r.text,'First, open the door. Then turn left.');assert.equal(s.calls,2);
});
test('continuations are bounded and an unresolved cutoff remains explicit',async()=>{
 const s=scripted([{text:'One',reason:'length'},{text:'One two',reason:'length'},{text:'One two three',reason:'length'}]);
 const r=await streamCompleteReply(s.stream,messages,()=>{});assert.equal(s.calls,3);assert.equal(r.finishReason,'length');assert.equal(r.continuations,2);
});
test('failed or unanchored recovery preserves visible text instead of guessing a join',async()=>{
 for(const next of [new Error('offline'),{text:'Another unrelated answer.',reason:'stop'}]){
  const s=scripted([{text:'The unfinished reply',reason:'length'},next]);let visible='';
  const r=await streamCompleteReply(s.stream,messages,t=>visible+=t);assert.equal(r.text,'The unfinished reply');assert.equal(visible,r.text);assert.equal(r.finishReason,'length');
 }
});
test('user Stop never starts a continuation',async()=>{
 const controller=new AbortController();let calls=0;
 const r=await streamCompleteReply(async(m,onToken,signal,p)=>{calls++;onToken('Partial');p.onFinish('length');controller.abort();return 'Partial';},messages,()=>{},controller.signal);
 assert.equal(calls,1);assert.equal(r.finishReason,'cancelled');assert.equal(r.text,'Partial');
});
test('unknown endings and filtered responses do not trigger blind continuation',async()=>{
 for(const reason of ['unknown','content_filter']){const s=scripted([{text:'Response',reason}]);const r=await streamCompleteReply(s.stream,messages,()=>{});assert.equal(s.calls,1);assert.equal(r.finishReason,reason);}
});
const sse=(text,reason)=>new Response('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:reason}]}));
test('hosted SSE adapter preserves finish metadata even without final newline',async(t)=>{
 t.mock.method(global,'fetch',async()=>sse('"Goodnight."','length'));
 let reason,visible='';const result=await streamOpenAICompatibleChat('https://test.invalid','test','test',messages,t=>visible+=t,1000,undefined,undefined,512,r=>reason=r);
 assert.equal(result,'"Goodnight."');assert.equal(visible,result);assert.equal(reason,'length');
});
test('Ollama adapter preserves done_reason even without final newline',async(t)=>{
 t.mock.method(global,'fetch',async()=>new Response(JSON.stringify({message:{content:'A thought'},done:false})+'\n'+JSON.stringify({done:true,done_reason:'length'})));
 let reason;assert.equal(await streamOllamaChat(messages,()=>{},1000,undefined,{onFinish:r=>reason=r}),'A thought');assert.equal(reason,'length');
});
test('real provider chain forwards recovery params and uses the same provider for both routes',async(t)=>{
 const old={...process.env};process.env.NVIDIA_API_KEY='test-only';process.env.GROQ_API_KEY='test-only';
 t.after(()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old)});
 for(const groqFirst of [false,true]){
  const requests=[];
  const mock=t.mock.method(global,'fetch',async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return requests.length===1?sse('I found the bo','length'):sse('I found the book.','stop')});
  let visible='';const r=await streamChatWithFallback(messages,x=>visible+=x,undefined,undefined,{groqFirst,maxTokens:1536});
  assert.equal(requests.length,2);assert.equal(requests[0].url,requests[1].url);assert.match(requests[0].url,groqFirst?/groq/:/nvidia/);
  assert.equal(requests[0].body.max_tokens,1536);assert.equal(requests[1].body.max_tokens,1024);assert.equal(r.text,'I found the book.');assert.equal(visible,r.text);assert.equal(r.finishReason,'stop');
  mock.mock.restore();
 }
});
