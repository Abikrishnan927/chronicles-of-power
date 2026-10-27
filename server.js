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
  if(process.env.NODE_ENV==='production')app.set('trust proxy',1);
  const allowedOrigins=(process.env.CORS_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean);
  app.use((req,res,next)=>{
    const origin=req.get('origin');
    if(origin&&allowedOrigins.includes(origin)){
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Request-Id');
    }else if(origin&&allowedOrigins.length&&req.path.startsWith('/api/')){
      return res.status(403).json({error:{code:'403',title:'Forbidden',message:'This website origin is not allowed to use the API.',retryable:false}});
    }
    if(req.method==='OPTIONS')return res.sendStatus(204);
    next();
  });
  app.use(createSupportRequestLogger(support.logger));
  app.use(express.json({limit:'32kb',strict:true}));
  app.get('/deployment-config.js',(req,res)=>{
    const backendBaseUrl=process.env.PUBLIC_API_BASE_URL||'';
    const accountApiBaseUrl=process.env.ACCOUNT_API_BASE_URL||'';
    res.type('application/javascript').send(`window.COPDeployment=Object.freeze({basePath:new URL('.',document.currentScript.src).pathname,backendConfigured:true,backendBaseUrl:${JSON.stringify(backendBaseUrl)},accountApiConfigured:${Boolean(accountApiBaseUrl)},accountApiBaseUrl:${JSON.stringify(accountApiBaseUrl)},asset(path){return new URL(String(path).replace(/^\\/+/,''),location.origin+this.basePath).href;},api(path){const base=this.backendBaseUrl||location.origin;return new URL(String(path).replace(/^\\/+/,''),base.replace(/\\/+$/,'')+'/').href;}});`);
  });
  createSupportRoutes(app,support);
  const importedEvents=loadImportedEvents();
  app.get('/api/history/events',(req,res)=>{
    const offsetText=req.query.offset??'0',limitText=req.query.limit??'1000';
    if(!/^(0|[1-9]\d*)$/.test(String(offsetText))||!/^[1-9]\d*$/.test(String(limitText)))return sendApiError(req,res,400,'offset must be a non-negative integer and limit must be a positive integer.',{retryable:false});
    const offset=Number(offsetText),limit=Number(limitText);
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(limit)||limit>1000)return sendApiError(req,res,400,'limit must be between 1 and 1000 and offset must be a safe integer.',{retryable:false});
    const query=String(req.query.q||'').trim().toLowerCase().slice(0,100);
    const matching=query?importedEvents.filter(event=>[event.title,event.summary,event.description,event.country,...(event.countries||[]),...(event.people||[])].filter(Boolean).join(' ').toLowerCase().includes(query)):importedEvents;
    res.json({events:matching.slice(offset,offset+limit),total:matching.length,offset,limit});
  });
  app.get('/api/game/health',async(req,res)=>{const health=await ai.health();const ok=health.available&&health.modelAvailable;const unavailable=!health.available;res.status(ok?200:503).json({...health,ok,provider:'local-ollama',...(!ok?{error:buildApiError(req,503,unavailable?'The local game AI service is not responding.':'The configured game AI model is unavailable.',{siteCode:null,cause:unavailable?'The local Ollama service could not be reached.':'The configured model is not available in Ollama.',steps:unavailable?['Check that Ollama is running.','Retry the health check.']:['Check the configured model name.','Install the model using the setup instructions.']})}:{})});});
  const route=method=>async(req,res,next)=>{try{res.json(await ai[method](req.body));}catch(error){next(error);}};
  app.post('/api/ai/decision',route('decision'));
  app.post('/api/ai/advisor',route('advisor'));
  app.post('/api/ai/diplomacy',route('diplomacy'));
  app.post('/api/ai/events',route('proposeEvent'));
  app.use((req,res,next)=>/^\/(?:backend|scripts|tests|\.private|node_modules)(?:\/|$)/.test(req.path)?res.status(404).end():next());
  app.use(express.static(__dirname,{dotfiles:'deny',index:'index.html',fallthrough:true}));
  createSupportFallback(app,support);
  return app;
}
if(require.main===module){
  loadLocalEnv();
  let ai;try{ai=createAIService({events:loadEvents()});}catch(error){console.error(`[Chronicles AI] Configuration error: ${error.message}`);process.exitCode=1;}
  if(ai){const port=Number(process.env.PORT)||3000,host=process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');const server=createServer({ai}).listen(port,host,()=>console.log(`Chronicles of Power API listening on ${host}:${port} (game AI model: ${ai.model})`));server.requestTimeout=100000;}
}
module.exports={createServer,loadEvents,loadImportedEvents,loadLocalEnv};
