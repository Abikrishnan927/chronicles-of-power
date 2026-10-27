const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const sim=require('../engine.js');
const history=import('../scripts/history-pipeline.mjs');
const wikidataHistory=import('../scripts/import-wikidata-events.mjs').then(m=>m);

test('decision effects update only selected variables',()=>{
  const before={stability:50,trust:40,liberties:60,legitimacy:55};
  const after=sim.applyEffects(before,{trust:-9,liberties:5});
  assert.deepEqual(after,{stability:50,trust:31,liberties:65,legitimacy:55});
  assert.equal(before.trust,40,'input state is immutable');
});

test('world-state indicators stay inside the documented 0–100 scale',()=>{
  assert.equal(sim.applyEffects({trust:96},{trust:12}).trust,100);
  assert.equal(sim.applyEffects({trust:3},{trust:-20}).trust,0);
});

test('invalid numeric simulation changes fail visibly',()=>{
  assert.throws(()=>sim.applyEffects({trust:50},{trust:NaN}),/Invalid simulation value/);
});

test('save validation rejects malformed or out-of-range checkpoints',()=>{
  const good={node:2,state:{stability:1,trust:2,liberties:3,legitimacy:4},choices:[],entries:[]};
  assert.equal(sim.validateSave(good,3),true);
  assert.equal(sim.validateSave({...good,node:4},3),false);
  assert.equal(sim.validateSave({...good,state:{...good.state,trust:'high'}},3),false);
});

test('endings follow state thresholds in priority order',()=>{
  assert.equal(sim.endingFor({liberties:70,legitimacy:70,trust:5,stability:5}),'open-mandate');
  assert.equal(sim.endingFor({liberties:20,legitimacy:70,trust:80,stability:80}),'legitimacy-strain');
  assert.equal(sim.endingFor({liberties:50,legitimacy:40,trust:40,stability:65}),'uneasy-calm');
  assert.equal(sim.endingFor({liberties:50,legitimacy:50,trust:50,stability:50}),'negotiated-transition');
});

test('later options unlock from prior decisions or state requirements',()=>{
  const mediated={id:'mediated',condition:{priorChoice:'dialogue'}};
  const phaseout={id:'phaseout',condition:{stateMin:{trust:35}}};
  assert.equal(sim.isAvailable(mediated,{trust:50},[]),false);
  assert.equal(sim.isAvailable(mediated,{trust:20},[{choice:'dialogue'}]),true);
  assert.equal(sim.isAvailable(phaseout,{trust:34},[]),false);
  assert.equal(sim.isAvailable(phaseout,{trust:35},[]),true);
});

test('freeform actions are deterministic and unclear actions do not mutate state',()=>{
  const open=sim.interpretAction('Call a public election and restore voting rights');
  assert.deepEqual(open,{label:'Expand representative participation',effects:{stability:-2,trust:4,liberties:5,legitimacy:6}});
  assert.match(sim.interpretAction('do something').clarification,/could not confidently classify/);
  const crackdown=sim.interpretAction('Censor the newspapers and detain organizers');
  assert.equal(crackdown.label,'Increase executive control');
  assert.match(sim.interpretAction('Pursue a foreign policy initiative',{scenarioId:'cuba',date:'October 1962',role:'Invalid role',allowedRoles:['President']}).clarification,/role is invalid/);
  assert.equal(sim.interpretAction('Pursue a foreign policy initiative',{scenarioId:'cuba',date:'October 1962',role:'President',allowedRoles:['President']}).label,'Pursue a diplomatic initiative');
});

test('campaign content has unique identifiers, explicit statuses, and bounded choices',()=>{
  const sandbox={window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../campaign-data.js'),'utf8'),sandbox);
  const content=sandbox.window.COPContent;
  assert.equal(new Set(content.EVENTS.map(event=>event.id)).size,content.EVENTS.length);
  assert.ok(content.EVENTS.every(event=>['playable','reference','research','partial'].includes(event.status)));
  assert.equal(content.EVENTS.filter(event=>event.status==='playable').length,1);
  assert.equal(new Set(content.NODES.map(node=>node.id)).size,content.NODES.length);
  assert.ok(content.NODES.every(node=>node.options.length>=2&&node.options.length<=5));
  assert.ok(content.EVENTS.every(event=>Array.isArray(event.coordinates)&&event.coordinates.length===2&&Math.abs(event.coordinates[0])<=180&&Math.abs(event.coordinates[1])<=90));
});

test('the application shell uses MapLibre and no longer contains the schematic SVG map',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  assert.match(html,/id="world-map" class="map-canvas"/);
  assert.match(html,/maplibre-gl@6\.14\.0/);
  assert.doesNotMatch(html,/<svg class="world-map"/);
});

test('every current event launches as curated or generic simulation and counts are data-derived',()=>{
  const sandbox={window:{COPImportedEvents:[]}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../campaign-data.js'),'utf8'),sandbox);
  const events=sandbox.window.COPContent.EVENTS;
  assert.equal(events.length,7);
  assert.ok(events.every(event=>event.simulationAvailable===true));
  assert.ok(events.every(event=>event.sourceRefs.length>0));
  assert.ok(events.every(event=>event.participants&&event.country&&event.region));
  assert.equal(events.filter(event=>event.campaignType==='curated').length,1);
  assert.equal(events.filter(event=>event.campaignType==='simulation').length,6);
});

test('annual Wikipedia event entries preserve date precision and extract linked events',async()=>{
  const api=await history;
  const entries=api.parseAnnualEventLines('== Events ==\n* January 2 – [[Treaty of Example]] signed between two states.\n* 3 March — [[Example uprising]] begins.\n== Births ==\n* [[Person]] born.\n',1500);
  assert.equal(entries.length,2);
  assert.equal(entries[0].date,'1500-01-02');
  assert.match(entries[0].eventTitle,/Treaty of Example/);
  assert.equal(entries[1].date,'1500-03-03');
  assert.equal(api.parseWikidataDate({time:'+1500-00-00T00:00:00Z',precision:9}).date,'1500');
  assert.equal(api.parseWikidataDate({time:'+1500-03-00T00:00:00Z',precision:10}).date,'1500-03');
});

test('Wikidata date precision does not invent historical month or day values',async()=>{
  const {parseDate}=await wikidataHistory;
  assert.deepEqual(parseDate('+1543-01-01T00:00:00Z',9),{year:1543,date:'1543',datePrecision:'year',dateApproximate:true});
  assert.deepEqual(parseDate('+1543-06-01T00:00:00Z',10),{year:1543,date:'1543-06',datePrecision:'month',dateApproximate:true});
  assert.deepEqual(parseDate('+1543-06-17T00:00:00Z',11),{year:1543,date:'1543-06-17',datePrecision:'day',dateApproximate:false});
  assert.equal(parseDate('+1025-01-01T00:00:00Z',11),null);
});

test('regional Wikidata searches constrain sourced events to declared countries or continents',async()=>{
  const {queryFor,args}=await wikidataHistory;
  assert.match(queryFor(1901,1910,50,0,'South Asia'),/wd:Q668/);
  assert.match(queryFor(1901,1910,50,0,'Africa'),/\?country wdt:P30 wd:Q15/);
  assert.throws(()=>args(['--region','Made-up']),/Unknown --region/);
});

test('bundled large archive contains 10,000 sourced, non-playable unique events across all centuries',()=>{
  const records=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/history-events.json'),'utf8'));
  assert.equal(records.length,10000);
  assert.equal(new Set(records.map(event=>event.id)).size,10000);
  assert.ok(records.every(event=>event.imported===true&&!event.isPlayable&&event.simulationAvailable===false));
  assert.ok(records.every(event=>event.sourceRefs?.length&&event.sourceRefs.every(url=>url.startsWith('https://'))));
  const centuries=new Set(records.map(event=>Math.floor((event.year-1)/100)+1));
  for(let century=11;century<=21;century++)assert.ok(centuries.has(century),`missing ${century}th-century coverage`);
  const sandbox={window:{COPImportedEvents:records}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../campaign-data.js'),'utf8'),sandbox);
  const events=sandbox.window.COPContent.EVENTS;
  assert.equal(events.filter(event=>event.imported).length,10000);
  assert.equal(events.length,records.length+7,'existing authored campaigns remain in the combined catalog');
  assert.equal(new Set(events.map(event=>event.id)).size,events.length);
  assert.ok(records.every(event=>!event.coordinates||(event.coordinates[0]>=-180&&event.coordinates[0]<=180&&event.coordinates[1]>=-90&&event.coordinates[1]<=90)));
});

test('catalog deduplication uses Wikidata and Wikipedia aliases and reports source quality',async()=>{
  const api=await history;
  const records=[{id:'wd-q1',wikidataId:'Q1',wikipediaPageId:23,title:'Treaty',date:'1500',year:1500,region:'Asia',category:'Diplomacy',sourceRefs:['https://example.org'],isPlayable:false,scenarioStatus:'not-created',countries:[],description:'Summary'}, {id:'wiki-23',wikipediaPageId:23,title:'Another title',date:'1501',year:1501,region:'Unknown',category:'Other',sourceRefs:['https://example.net'],isPlayable:false,scenarioStatus:'not-created',countries:[],description:'Summary'}];
  assert.equal(api.uniqueEvents(records).records.length,1);
  const report=api.makeReport(records);
  assert.equal(report.totalRecords,2);
  assert.equal(report.uniqueEvents,1);
  assert.equal(report.sourceUrlsRetained,2);
  assert.equal(report.playableCampaigns,0);
});

test('downloaded catalog records remain read-only until explicit promotion',()=>{
  const records=JSON.parse(fs.readFileSync(require.resolve('../data/history-events.json'),'utf8'));
  assert.ok(records.length>0);
  assert.ok(records.every(event=>event.imported===true&&event.confidence==='unverified'&&event.isPlayable===false&&event.simulationAvailable===false&&event.scenarioStatus==='not-created'));
  assert.ok(records.every(event=>event.sourceRefs.length>0&&event.sourceRetrievedAt));
});

test('event review workflow requires reviewed scenario data before playability',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cop-review-'));
  try{
    fs.mkdirSync(path.join(dir,'data'));
    const record={id:'event-example',title:'Example event',date:'1500',year:1500,sourceRefs:['https://example.org'],imported:true,isPlayable:false,scenarioStatus:'not-created',simulationAvailable:false,status:'research',campaignType:'archive'};
    fs.writeFileSync(path.join(dir,'data','history-events.json'),JSON.stringify([record]));
    const scenario={startingState:{stability:50,trust:50,liberties:50,legitimacy:50},objectives:['Protect civilian institutions'],roles:['Governor'],supportedActions:['Open dialogue and negotiation'],assumptions:['Starting indicators are authored game values.']};
    fs.writeFileSync(path.join(dir,'scenario.json'),JSON.stringify(scenario));
    const script=path.join(__dirname,'..','scripts','review-event.mjs');
    const args=['--id','event-example','--stage','playable','--reviewer','Researcher','--notes','Compared against cited sources.','--scenario-file','scenario.json'];
    const result=spawnSync(process.execPath,[script,...args,'--database',path.join(dir,'data','history-events.json'),'--script-output',path.join(dir,'historical-events.js')],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const reviewed=JSON.parse(fs.readFileSync(path.join(dir,'data','history-events.json'),'utf8'))[0];
    assert.equal(reviewed.isPlayable,true);
    assert.equal(reviewed.reviewStatus,'reviewed');
    assert.equal(reviewed.scenarioStatus,'playable');
    assert.deepEqual(reviewed.scenario.startingState,scenario.startingState);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('map lifecycle uses actual MapLibre resize, vertical full-world fit, and container observation',()=>{
  const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
  assert.match(app,/worldMap\.getContainer\(\)\.clientHeight/);
  assert.match(app,/center:\[0,0\],zoom:worldZoom/);
  assert.match(app,/Math\.max\(\.15,Math\.min\(13/);
  assert.match(app,/new ResizeObserver\(scheduleMapResize\)/);
  assert.match(app,/worldMap\.resize\(\)/);
});

test('catalog ingestion rejects duplicate historical records and retains source references',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cop-ingest-'));
  try{
    const source=[{id:'sample-event',title:'Sample event',date:'1500',year:1500,period:'1500',place:'Example City',country:'Example Republic',region:'Europe',category:'Political transition',summary:'Source-reviewed test record.',coordinates:null,sourceRefs:['https://example.org/record']}];
    fs.writeFileSync(path.join(dir,'events.json'),JSON.stringify(source));
    const script=path.join(__dirname,'..','scripts','ingest-events.mjs');
    const result=spawnSync(process.execPath,[script,'events.json'],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const generated=fs.readFileSync(path.join(dir,'historical-events.js'),'utf8');
    assert.ok(generated.includes('https://example.org/record'));
    assert.ok(generated.includes('"isPlayable": false'));
    fs.writeFileSync(path.join(dir,'events.json'),JSON.stringify([...source,...source]));
    const duplicate=spawnSync(process.execPath,[script,'events.json'],{cwd:dir,encoding:'utf8'});
    assert.notEqual(duplicate.status,0);
    assert.match(duplicate.stderr,/Duplicate/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
