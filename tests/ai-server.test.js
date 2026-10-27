const test=require('node:test');
const assert=require('node:assert/strict');
const {createServer,loadImportedEvents}=require('../server.js');
const {createAIService}=require('../ai-service.js');

const event={id:'integration-event',title:'Example reform',date:'1900',year:1900,category:'Political change',summary:'A short sourced event record.',country:'Example Republic',countries:['Example Republic'],people:['Reform Council'],sourceRefs:['https://example.org/source']};
const response={summary:'Open a channel for talks.',interpretation:'Build agreement.',actions:['Open dialogue and negotiation'],risks:[],possibleConsequences:['The model may improve trust.'],clarificationNeeded:false};
function mockFetch(){return async(url,options)=>{if(url.endsWith('/api/tags'))return{ok:true,json:async()=>({models:[{name:'qwen2.5:3b'}]})};const request=JSON.parse(options.body),system=request.messages[0].content,output=request.format?.properties?.actions?response:system.includes('careful historical advisor')?{answer:'The record is brief.',uncertainty:'Some detail is missing.',hypotheticalBoundary:'Game indicators are fictional.',sourceRefs:['https://example.org/source']}:system.includes('fictional alternate-history diplomatic')?{message:'We can begin talks.',intent:'Open a negotiation',proposedActionText:null,caveat:'Fictional dialogue; no agreement was made.'}:system.includes('Propose one concise')?{title:'A proposed conference',narrative:'A fictional conference is proposed.',relevance:'The player opened dialogue.',actionText:'Open dialogue and negotiation',risks:['Talks could stall.']}:response;return{ok:true,json:async()=>({message:{content:JSON.stringify(output)}})};};}
async function withServer(t,ai){const server=createServer({ai}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return`http://127.0.0.1:${server.address().port}`;}

test('Express serves the map app and exposes the local Ollama health endpoint',async t=>{
  const ai=createAIService({events:[event],fetchImpl:mockFetch()}),base=await withServer(t,ai);
  const health=await fetch(`${base}/api/health`);assert.equal(health.status,200);assert.equal((await health.json()).provider,'local-ollama');
  const gameHealth=await fetch(`${base}/api/game/health`);assert.equal(gameHealth.status,200);assert.equal((await gameHealth.json()).ok,true);
  const page=await fetch(`${base}/index.html`);assert.equal(page.status,200);const html=await page.text();assert.match(html,/id="world-map"/);assert.match(html,/catalog-loader\.js/);
  assert.match(html,/support-error\.js/);
  const config=await fetch(`${base}/deployment-config.js`);assert.equal(config.status,200);assert.match(await config.text(),/backendConfigured:true/);
  const staticData=await fetch(`${base}/data/history-events.json`);assert.equal(staticData.status,200);assert.match(staticData.headers.get('content-type'),/json/);
});
test('game AI health preserves 503 and returns safe troubleshooting details when Ollama is unavailable',async t=>{
  const ai=createAIService({events:[event],fetchImpl:async()=>{throw new TypeError('private connection diagnostic');}}),base=await withServer(t,ai);
  const response=await fetch(`${base}/api/game/health`),body=await response.json();
  assert.equal(response.status,503);assert.equal(body.error.code,'503');assert.equal(body.error.title,'Service Unavailable');
  assert.equal(body.error.requestId,response.headers.get('x-request-id'));assert.match(body.error.cause,/Ollama/);
  assert.doesNotMatch(JSON.stringify(body),/private connection diagnostic|stack|Error:/i);
});
test('historical catalogue pages expose every unique imported record without overlap',async t=>{
  const base=await withServer(t,createAIService({events:[event],fetchImpl:mockFetch()}));
  const source=loadImportedEvents(),ids=new Set(source.map(item=>item.id));
  assert.equal(source.length,10000);
  assert.equal(ids.size,source.length);
  const received=[],seen=new Set();
  for(let offset=0;offset<source.length;offset+=1000){
    const response=await fetch(`${base}/api/history/events?offset=${offset}&limit=1000`);
    assert.equal(response.status,200);
    const page=await response.json();
    assert.equal(page.total,source.length);
    assert.equal(page.offset,offset);
    assert.equal(page.events.length,Math.min(1000,source.length-offset));
    for(const item of page.events){assert.ok(!seen.has(item.id),`repeated event ${item.id}`);seen.add(item.id);received.push(item.id)}
  }
  assert.equal(received.length,source.length);
  assert.equal(seen.size,source.length);
  const invalid=await fetch(`${base}/api/history/events?offset=-1&limit=1000`);assert.equal(invalid.status,400);const invalidBody=await invalid.json();assert.equal(invalidBody.error.code,'400');assert.equal(invalidBody.error.title,'Bad Request');assert.ok(invalidBody.error.requestId);
  assert.equal((await fetch(`${base}/api/history/events?offset=0&limit=1001`)).status,400);
});
test('decision endpoint accepts bounded JSON and validates output before returning a preview',async t=>{
  const ai=createAIService({events:[event],fetchImpl:mockFetch()}),base=await withServer(t,ai);
  const result=await fetch(`${base}/api/ai/decision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId:event.id,date:event.date,role:event.country,state:{stability:50,trust:50,liberties:50,legitimacy:50},order:'Please negotiate an agreement',model:'browser-cannot-choose-model'})});
  assert.equal(result.status,200);const data=await result.json();assert.equal(data.engineAction,'Open dialogue and negotiation');assert.deepEqual(data.actions,['Open dialogue and negotiation']);assert.ok(data.effects.trust>0);
});
test('advisor, diplomacy, and event endpoints use the same validated local service',async t=>{
  const ai=createAIService({events:[event],fetchImpl:mockFetch()}),base=await withServer(t,ai),context={eventId:event.id,date:event.date,role:event.country,state:{stability:50,trust:50,liberties:50,legitimacy:50}};
  const advisor=await fetch(`${base}/api/ai/advisor`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...context,question:'What does the event record say?'})});assert.equal(advisor.status,200);assert.equal((await advisor.json()).sourceRefs[0],event.sourceRefs[0]);
  const diplomacy=await fetch(`${base}/api/ai/diplomacy`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...context,counterpart:'Reform Council',messages:[{role:'user',content:'Can we begin public talks?'}]})});assert.equal(diplomacy.status,200);assert.equal((await diplomacy.json()).proposal,null);
  const dynamic=await fetch(`${base}/api/ai/events`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...context,decisions:['Opened negotiations']})});assert.equal(dynamic.status,200);const proposed=await dynamic.json();assert.equal(proposed.status,'pending');assert.equal(proposed.historical,false);
});
test('oversized request bodies are rejected with a clear client error',async t=>{
  const ai=createAIService({events:[event],fetchImpl:mockFetch()}),base=await withServer(t,ai);
  const result=await fetch(`${base}/api/ai/advisor`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:'x'.repeat(40000)})});
  assert.equal(result.status,413);const body=await result.json();assert.equal(body.error.code,'413');assert.equal(body.error.title,'Request Too Large');assert.equal(body.error.requestId,result.headers.get('x-request-id'));
});
