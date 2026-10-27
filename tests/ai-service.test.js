const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createAIService,ACTIONS}=require('../ai-service.js');

const sampleEvent={id:'sample-event',title:'Example political reform',date:'1900',year:1900,category:'Political change',summary:'A short sourced record.',country:'Example Republic',countries:['Example Republic'],people:['Reform Council'],sourceRefs:['https://example.org/source']};
const game={eventId:sampleEvent.id,date:'1900',role:'Example Republic',state:{stability:50,trust:48,liberties:52,legitimacy:50}};
const fixtures={
  decision:{summary:'The order fits a diplomatic initiative.',interpretation:'Seek a negotiated agreement.',actions:['Open dialogue and negotiation'],risks:['Talks may stall.'],possibleConsequences:['Modeled trust may improve.'],clarificationNeeded:false},
  advisor:{answer:'The supplied record describes a political reform.',uncertainty:'The record is brief.',hypotheticalBoundary:'Your current scores are simulated.',sourceRefs:['https://example.org/source','https://evil.example/fake']},
  diplomacy:{message:'We are prepared to discuss an agreement.',intent:'Begin talks',proposedActionText:null,caveat:'Fictional alternate-history dialogue; no agreement has been made.'},
  event:{title:'A proposed reform conference',narrative:'A fictional conference is proposed for the next modeled turn.',relevance:'It follows the current dialogue decision.',actionText:'Open dialogue and negotiation',risks:['Talks may fail.']}
};
function fakeFetch({malformed=false,offline=false,model='qwen2.5:3b',recorded=[],decisionResponses=[]}={}){let decisionIndex=0;return async(url,options={})=>{if(offline)throw new TypeError('fetch failed');if(url.endsWith('/api/tags'))return{ok:true,json:async()=>({models:[{name:model}]})};const request=JSON.parse(options.body);recorded.push(request);const system=request.messages[0].content,isDecision=!!request.format?.properties?.actions;const data=malformed?'not-json':isDecision?(decisionResponses[decisionIndex++]??fixtures.decision):system.includes('careful historical advisor')?fixtures.advisor:system.includes('fictional alternate-history diplomatic')?fixtures.diplomacy:fixtures.event;return{ok:true,json:async()=>({message:{content:typeof data==='string'?data:JSON.stringify(data)}})};};}
function service(options={}){return createAIService({model:'qwen2.5:3b',events:[sampleEvent],fetchImpl:fakeFetch(options)});}

test('local-only URL and server-owned model configuration reject remote endpoints',()=>{
  assert.throws(()=>createAIService({baseUrl:'https://example.com',events:[sampleEvent]}),/loopback/);
  assert.throws(()=>createAIService({baseUrl:'http://127.0.0.1.evil.test:11434',events:[sampleEvent]}),/loopback/);
  assert.throws(()=>createAIService({model:'https://evil.example',events:[sampleEvent]}),/unsupported characters/);
});
test('health reports Ollama/model state and handles a stopped service',async()=>{
  assert.deepEqual(await service().health(),{available:true,model:'qwen2.5:3b',modelAvailable:true});
  const stopped=await service({offline:true}).health();assert.equal(stopped.available,false);assert.equal(stopped.modelAvailable,false);
  const missing=await service({model:'qwen3:8b'}).health();assert.equal(missing.available,true);assert.equal(missing.modelAvailable,false);
});
test('decision response uses only a canonical engine action and does not mutate submitted game state',async()=>{
  const recorded=[],api=service({recorded}),before=structuredClone(game),proposal=await api.decision({...game,order:'Negotiate a public agreement'});
  assert.equal(proposal.actionText,'Open dialogue and negotiation');assert.deepEqual(proposal.actions,['Open dialogue and negotiation']);assert.deepEqual(proposal.effects,{stability:-2,trust:5,liberties:2,legitimacy:4});assert.deepEqual(game,before);
  assert.ok(recorded[0].format.properties.actions.items.enum.includes(proposal.actions[0]));assert.ok(recorded[0].format.properties.actions.items.enum.every(action=>ACTIONS.includes(action)));assert.match(recorded[0].messages[1].content,/Example political reform/);assert.match(recorded[0].messages[0].content,/clarificationNeeded to true/);assert.doesNotMatch(recorded[0].messages[1].content,/DO NOT SEND THIS OTHER EVENT/);
});
test('decision parser accepts fenced JSON and optional lists may be omitted',async()=>{
  const response='```json\n'+JSON.stringify({summary:'Open talks.',interpretation:'Negotiate an agreement.',actions:['Open dialogue and negotiation'],clarificationNeeded:false})+'\n```';
  const proposal=await service({decisionResponses:[response]}).decision({...game,order:'Negotiate a public agreement'});
  assert.deepEqual(proposal.risks,[]);assert.deepEqual(proposal.possibleConsequences,[]);assert.equal(proposal.actionText,'Open dialogue and negotiation');
});
test('clarification responses contain no executable action or engine effects',async()=>{
  const clarification={summary:'The order is ambiguous.',interpretation:'Specify a political or diplomatic action.',actions:[],clarificationNeeded:true};
  const proposal=await service({decisionResponses:[clarification]}).decision({...game,order:'Make this better and handle it'});
  assert.equal(proposal.clarificationNeeded,true);assert.deepEqual(proposal.actions,[]);assert.equal(proposal.engineAction,null);assert.equal(proposal.effects,null);
});
test('invalid decisions are retried once and rejected without applying actions',async()=>{
  const recorded=[],invalid={summary:'Invented action.',interpretation:'Do something unusual.',actions:['Invent a new mechanic'],risks:[],possibleConsequences:[],clarificationNeeded:false};
  const api=service({recorded,decisionResponses:[invalid,invalid]});
  await assert.rejects(api.decision({...game,order:'Do something unusual in the scenario'}),error=>error.code==='invalid_model_response'&&error.message.includes('invalid decision twice'));
  assert.equal(recorded.length,2);assert.match(recorded[1].messages[0].content,/Return ONLY valid JSON/);
});
test('advisor only returns citations that belong to the selected historical record',async()=>{
  const reply=await service().advisor({...game,question:'What does this source say?'});assert.deepEqual(reply.sourceRefs,['https://example.org/source']);assert.match(reply.uncertainty,/brief/);
});
test('diplomacy is a separate fictional conversation and cannot create an agreement',async()=>{
  const reply=await service().diplomacy({...game,counterpart:'Reform Council',messages:[{role:'user',content:'Would you open formal talks?'}]});assert.equal(reply.proposal,null);assert.match(reply.caveat,/no agreement/i);
});
test('generated alternate events remain pending and use engine-valid actions',async()=>{
  const event=await service().proposeEvent({...game,decisions:['Opened talks']});assert.equal(event.status,'pending');assert.equal(event.historical,false);assert.ok(ACTIONS.includes(event.actionText));assert.ok(event.effects.trust>0);
});
test('malformed model output, unsupported actions, invalid state, and missing IDs are rejected',async()=>{
  await assert.rejects(service({malformed:true}).advisor({...game,question:'Tell me about this.'}),e=>e.code==='invalid_model_response');
  const invalid=fakeFetch();const illegal=createAIService({events:[sampleEvent],fetchImpl:async(url,options)=>{if(url.endsWith('/api/tags'))return invalid(url,options);return{ok:true,json:async()=>({message:{content:JSON.stringify({...fixtures.decision,actions:['Invent a new game mechanic']})}})}}});
  await assert.rejects(illegal.decision({...game,order:'Do something useful'}),e=>e.code==='invalid_model_response');
  await assert.rejects(service().decision({...game,state:{...game.state,trust:110},order:'Negotiate a public agreement'}),e=>e.code==='invalid_state');
  await assert.rejects(service().advisor({...game,eventId:'missing',question:'What happened?'}),e=>e.code==='event_not_found');
});
test('browser AI workflows require confirmation, cancellation is state-neutral, and generated events stay separate',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../ai-ui.js'),'utf8'),app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const cancel=ui.slice(ui.indexOf('cancel.onclick='),ui.indexOf('controls.append(confirm,cancel)'));
  assert.ok(cancel.includes('pendingDecision=null')&&cancel.includes('box.replaceChildren()'));
  assert.ok(!cancel.includes('COPRuntime.apply('));
  assert.ok(ui.includes('CONFIRM & APPLY THROUGH ENGINE')&&ui.includes('window.COPRuntime.apply(action)'));
  assert.ok(ui.includes('const action=proposal.actions[0]')&&ui.includes('if(proposal.clarificationNeeded)'));
  assert.ok(ui.includes('cop-diplomacy:${encodeURIComponent(ctx.eventId)}:${encodeURIComponent(ctx.counterpart)}'));
  assert.ok(ui.includes('window.COPRuntime.apply(event.actionText,event)'));
  assert.ok(app.includes('cop-alt-events-')&&app.includes("kind:'generated'"));
  assert.ok(!ui.includes('.innerHTML'), 'model text must not be inserted as untrusted HTML');
});

test('game and support API failures have safe, contextual paths to the support assistant',()=>{
  const root=path.join(__dirname,'..');
  const files=['ai-ui.js','catalog-loader.js','support-error.js','support/support.js'];
  for(const file of files)assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join(root,file),'utf8')));
  const helper=fs.readFileSync(path.join(root,'support-error.js'),'utf8');
  const sandbox={window:{},location:{pathname:'/campaign'},URLSearchParams};
  vm.runInNewContext(helper,sandbox);
  const link=sandbox.window.COPSupportErrorLink({
    code:'503',siteCode:'APP-1001',title:'Service Unavailable',
    message:'A support dependency is unavailable.',cause:'The service did not respond.',
    requestId:'00000000-0000-4000-8000-000000000001',steps:['Retry later.']
  },'asking for a proposal');
  const params=new URLSearchParams(link.split('?')[1]);
  assert.equal(params.get('errorCode'),'503');
  assert.equal(params.get('errorSiteCode'),'APP-1001');
  assert.equal(params.get('errorPage'),'/campaign');
  assert.equal(params.get('errorRequestId'),'00000000-0000-4000-8000-000000000001');
  assert.match(fs.readFileSync(path.join(root,'ai-ui.js'),'utf8'),/ASK SUPPORT ASSISTANT/);
});
