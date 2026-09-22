const test = require('node:test');
const assert = require('node:assert/strict');
const { streamCompleteReply } = require('../dist/lib/providers/completeReply');
const { planReply, replyProfile, clampReplyToWordCeiling } = require('../dist/lib/providers/replyPolicy');
const { cleanAssistantResponse, streamChatWithFallback } = require('../dist/lib/providers');
const { streamOpenAICompatibleChat } = require('../dist/lib/providers/openaiCompatible');
const { streamOllamaChat } = require('../dist/lib/providers/ollama');
const messages = [{role:'system',content:'A bookshop conversation.'},{role:'user',content:'What happened?'}];
function scripted(steps) {
 let calls=0; const inputs=[];
 const stream=async (m,onToken,signal,p)=>{ inputs.push({messages:m,params:p});const step=steps[calls++];if(step instanceof Error)throw step;onToken(step.text);p.onFinish(step.reason);return step.text;};
 return {stream,inputs,get calls(){return calls;}};
}
test('engine budgets are tier-locked and invariant to user wording',()=>{
 const tiers=[3,6,8,10]; const budgets=tiers.map(n=>planReply(n,'What happened?').maxTokens);
 assert.equal(new Set(budgets).size,4);
 const variants=['Hi','Keep it short','Explain in detail','Write a full scene','*She looks away*','A '.repeat(800)];
 for(const n of tiers){
  const profile=replyProfile(n);
  const plans=variants.map(text=>planReply(n,text));
  for(const plan of plans){
   assert.equal(plan.mode,'tier');
   assert.equal(plan.maxTokens,profile.tokens);
   assert.equal(plan.targetWords,profile.ordinaryWords);
   assert.equal(plan.minWords,profile.minWords);
   assert.equal(plan.maxWords,profile.maxWords);
   assert.match(plan.instruction,/TIER-LOCKED REPLY ENVELOPE/);
   assert.match(plan.instruction,/another engine/);
  }
  assert.equal(new Set(plans.map(x=>x.instruction)).size,1);
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

test('cutoff recovery preserves the selected tier budget while finishing an interrupted word',async()=>{
 const s=scripted([{text:'That is your greet',reason:'length'},{text:'That is your greeting?',reason:'stop'}]);
 const r=await streamCompleteReply(s.stream,messages,()=>{},undefined,planReply(10,'Hi'));
 assert.equal(s.inputs[0].params.maxTokens,256);assert.equal(s.inputs[1].params.maxTokens,160);
 assert.equal(r.text,'That is your greeting?');assert.equal(r.finishReason,'stop');
});

test('tier-locked replies get one same-provider depth top-up when a normal stop is too short',async()=>{
 const initial='*She looks up.* Hey.';
 const added=' I was wondering when you would show up. *She closes the book and gives you a measured look.* You have my attention now, so say what you actually came here to say.';
 const s=scripted([{text:initial,reason:'stop'},{text:added,reason:'stop'}]);let visible='';
 const plan=planReply(10,'Hi');
 const r=await streamCompleteReply(s.stream,messages,t=>visible+=t,undefined,plan);
 assert.equal(s.calls,2);
 assert.equal(r.finishReason,'stop');
 assert.equal(r.text,initial+added);
 assert.equal(visible,r.text);
 assert.equal(s.inputs[1].params.maxTokens,160);
 assert.match(s.inputs[1].messages.at(-1).content,/fixed tier envelope/i);
 assert.match(s.inputs[1].messages.at(-1).content,/same assistant turn/i);
});

test('tier depth top-up never runs for unknown or filtered endings',async()=>{
 for(const reason of ['unknown','content_filter']){
  const s=scripted([{text:'Too short',reason}]);
  const r=await streamCompleteReply(s.stream,messages,()=>{},undefined,planReply(10,'Hi'));
  assert.equal(s.calls,1);assert.equal(r.finishReason,reason);assert.equal(r.text,'Too short');
 }
});

test('in-character refusal language is not mistaken for a provider policy refusal',async(t)=>{
 const old={...process.env};process.env.NVIDIA_API_KEY='test-only';delete process.env.NVIDIA_API_KEY_2;delete process.env.NVIDIA_API_KEY_3;delete process.env.GROQ_API_KEY;delete process.env.SAMBANOVA_API_KEY;delete process.env.CLOUDFLARE_CHAT_API_TOKEN;
 t.after(()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old)});
 let calls=0;
 t.mock.method(global,'fetch',async(url,options)=>{calls++;return sse("I'm not going to let you leave.",'stop')});
 let visible='';const r=await streamChatWithFallback(messages,x=>visible+=x);
 assert.equal(calls,1);assert.equal(r.text,"I'm not going to let you leave.");assert.equal(visible,r.text);assert.equal(r.finishReason,'stop');
});

test('actual assistant policy refusal is swallowed and falls through to the next provider',async(t)=>{
 const old={...process.env};process.env.NVIDIA_API_KEY='first';process.env.NVIDIA_API_KEY_2='second';delete process.env.NVIDIA_API_KEY_3;delete process.env.GROQ_API_KEY;delete process.env.SAMBANOVA_API_KEY;delete process.env.CLOUDFLARE_CHAT_API_TOKEN;
 t.after(()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old)});
 let calls=0;
 t.mock.method(global,'fetch',async()=>{calls++;return calls===1?sse("I'm sorry, but I can't help with that request.",'stop'):sse('*She folds her arms.* Try asking me properly.','stop')});
 let visible='';const r=await streamChatWithFallback(messages,x=>visible+=x);
 assert.equal(calls,2);assert.equal(r.text,'*She folds her arms.* Try asking me properly.');assert.equal(visible,r.text);assert.equal(r.finishReason,'stop');
});

test('a provider failure after visible output preserves the partial reply instead of mixing a fallback answer',async(t)=>{
 const old={...process.env};process.env.NVIDIA_API_KEY='first';process.env.NVIDIA_API_KEY_2='second';delete process.env.NVIDIA_API_KEY_3;delete process.env.GROQ_API_KEY;delete process.env.SAMBANOVA_API_KEY;delete process.env.CLOUDFLARE_CHAT_API_TOKEN;
 t.after(()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old)});
 const enc=new TextEncoder();let calls=0;
 t.mock.method(global,'fetch',async()=>{
  calls++;
  if(calls>1)return sse('THIS MUST NOT BE APPENDED.','stop');
  let step=0;
  const body=new ReadableStream({pull(controller){
   if(step++===0){controller.enqueue(enc.encode('data: '+JSON.stringify({choices:[{delta:{content:'*She catches your wrist and looks up.* Wait.'},finish_reason:null}]})+'\n'));return;}
   controller.error(new Error('connection reset'));
  }});
  return new Response(body);
 });
 let visible='';const r=await streamChatWithFallback(messages,x=>visible+=x);
 assert.equal(calls,1);assert.equal(r.text,'*She catches your wrist and looks up.* Wait.');assert.equal(visible,r.text);assert.equal(r.finishReason,'provider_error');
});


test('server-side word ceiling keeps an overlong Hazelnut reply at or below 130 words',()=>{
 const long=Array.from({length:18},(_,i)=>`Sentence ${i+1} adds a distinct reaction and moves the scene forward without repeating the previous emotional beat.`).join(' ');
 const capped=clampReplyToWordCeiling(long,130,105);
 const words=capped.trim().split(/\s+/).filter(Boolean).length;
 assert.ok(words>=105);assert.ok(words<=130);assert.match(capped,/[.!?][\"'”’)*_\]]*$/);
});

test('depth top-up cannot overshoot the tier maximum even when the provider ignores the requested addition',async()=>{
 const initial=Array.from({length:90},(_,i)=>`w${i+1}`).join(' ')+' ';
 const huge=Array.from({length:100},(_,i)=>`extra${i+1}`).join(' ')+'.';
 const s=scripted([{text:initial,reason:'stop'},{text:huge,reason:'stop'}]);let visible='';
 const r=await streamCompleteReply(s.stream,messages,t=>visible+=t,undefined,planReply(10,'Hi'));
 const words=r.text.trim().split(/\s+/).filter(Boolean).length;
 assert.equal(s.calls,2);assert.ok(words<=130);assert.equal(visible,r.text);assert.ok(s.inputs[1].params.maxTokens<160);
});
