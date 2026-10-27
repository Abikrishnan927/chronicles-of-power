const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const express=require('express');
const {createAIService}=require('./ai-service');
const {createSupportRequestLogger,createSupportRoutes,createSupportFallback,sendApiError,buildApiError}=require('./support-server');

function loadLocalEnv(){const file=path.join(__dirname,'.env');if(!fs.existsSync(file))return;for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const match=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(match&&!Object.hasOwn(process.env,match[1]))process.env[match[1]]=match[2].replace(/^(["'])(.*)\1$/,'$2');}}
function loadImportedEvents(){const imported=JSON.parse(fs.readFileSync(path.join(__dirname,'data/history-events.json'),'utf8'));if(!Array.isArray(imported))throw new TypeError('Historical event database must contain a JSON array.');const ids=new Set();for(const event of imported){if(!event?.id||ids.has(event.id))throw new Error(`Historical event database contains a missing or duplicate ID: ${event?.id||'(missing)'}`);ids.add(event.id);}return imported;}
function loadEvents(){const sandbox={window:{COPImportedEvents:loadImportedEvents()}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'campaign-data.js'),'utf8'),sandbox,{timeout:5000});return sandbox.window.COPContent.EVENTS;}
function createServer({ai=createAIService({events:loadEvents()}),support={}}={}){
  const app=express();
  app.disable('x-powered-by');
  app.use(createSupportRequestLogger(support.logger));
  app.use(express.json({limit:'32kb',strict:true}));
  createSupportRoutes(app,support);
  const importedEvents=loadImportedEvents();
  app.get('/api/history/events',(req,res)=>{
    const offsetText=req.query.offset??'0',limitText=req.query.limit??'1000';
    if(!/^(0|[1-9]\d*)$/.test(String(offsetText))||!/^[1-9]\d*$/.test(String(limitText)))return sendApiError(req,res,400,'offset must be a non-negative integer and limit must be a positive integer.',{retryable:false});
    const offset=Number(offsetText),limit=Number(limitText);
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(limit)||limit>1000)return sendApiError(req,res,400,'limit must be between 1 and 1000 and offset must be a safe integer.',{retryable:false});
    res.json({events:importedEvents.slice(offset,offset+limit),total:importedEvents.length,offset,limit});
  });
  app.get('/api/game/health',async(req,res)=>{const health=await ai.health();const ok=health.available&&health.modelAvailable;const unavailable=!health.available;res.status(ok?200:503).json({...health,ok,provider:'local-ollama',...(!ok?{error:buildApiError(req,503,unavailable?'The local game AI service is not responding.':'The configured game AI model is unavailable.',{siteCode:null,cause:unavailable?'The local Ollama service could not be reached.':'The configured model is not available in Ollama.',steps:unavailable?['Check that Ollama is running.','Retry the health check.']:['Check the configured model name.','Install the model using the setup instructions.']})}:{})});});
  const route=method=>async(req,res,next)=>{try{res.json(await ai[method](req.body));}catch(error){next(error);}};
  app.post('/api/ai/decision',route('decision'));
  app.post('/api/ai/advisor',route('advisor'));
  app.post('/api/ai/diplomacy',route('diplomacy'));
  app.post('/api/ai/events',route('proposeEvent'));
  app.use(express.static(__dirname,{dotfiles:'deny',index:'index.html',fallthrough:true}));
  createSupportFallback(app,support);
  return app;
}
if(require.main===module){
  loadLocalEnv();
  let ai;try{ai=createAIService({events:loadEvents()});}catch(error){console.error(`[Chronicles AI] Configuration error: ${error.message}`);process.exitCode=1;}
  if(ai){const port=Number(process.env.PORT)||3000,host=process.env.HOST||'127.0.0.1';const server=createServer({ai}).listen(port,host,()=>console.log(`Chronicles of Power ready at http://localhost:${port} (Ollama model: ${ai.model})`));server.requestTimeout=100000;}
}
module.exports={createServer,loadEvents,loadImportedEvents,loadLocalEnv};
