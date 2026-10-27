/* Universal, deterministic scenario scaffolding. It never edits an event's historical record. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.COPScenarios=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const ACTIONS=Object.freeze([
    'Open dialogue and negotiation','Expand representative participation','Increase executive control',
    'Strengthen protections and oversight','Change economic policy','Pursue a diplomatic initiative',
    'Commit resources to a strategic program'
  ]);
  const TEMPLATES=[
    [/war|battle|conflict|invasion|military|siege|revolt|rebellion/,'Conflict and settlement','Maintain cohesion while managing conflict, logistics, and a path to settlement.'],
    [/revolution|uprising|coup|protest|movement|strike/,'Political transition','Manage public support, institutional legitimacy, reform, and unrest.'],
    [/independence|liberation|decolon|secession/,'State formation','Build recognition and institutions while balancing negotiation and resistance.'],
    [/treaty|agreement|pact|convention|accord/,'Diplomatic negotiation','Seek an agreement while weighing concessions, trust, and external relations.'],
    [/leader|president|king|queen|emperor|succession|election|assassination/,'Leadership and legitimacy','Consolidate legitimacy and govern domestic affairs amid external pressures.'],
    [/economic|crisis|depression|famine|trade|financial|recession/,'Economic resilience','Allocate limited capacity while pursuing recovery and public confidence.'],
    [/science|discovery|invention|technology|research/,'Knowledge and adoption','Balance research investment, public benefit, and institutional adoption.'],
    [/explor|expedition|voyage|discovery/,'Expedition planning','Coordinate logistics and knowledge gathering; claims are not inferred.'],
    [/culture|social|rights|reform|religious/,'Social change','Navigate public opinion, reform, and institutional response.'],
    [/disaster|earthquake|flood|storm|volcan|drought|tsunami/,'Relief and recovery','Prioritize relief, infrastructure, and recovery under constrained capacity.'],
    [/empire|kingdom|republic|state formation|unification|founding/,'Administration and state formation','Balance administration, diplomacy, and internal stability.']
  ];
  const clean=value=>String(value||'').trim();
  function build(event){
    if(!event||!clean(event.id)||!clean(event.title))throw new TypeError('A scenario requires an event id and title.');
    const category=clean(event.category||'').toLowerCase(),text=`${event.title} ${event.description||''} ${category}`.toLowerCase();
    const template=TEMPLATES.find(([pattern])=>pattern.test(text));
    const detailed=!!(event.summary||event.description)&&!!(event.date||event.year)&&!!(event.sourceRefs||[]).length;
    const tier=detailed?'2':'3';
    const actionSets={
      'Conflict and settlement':['Pursue a diplomatic initiative','Open dialogue and negotiation','Increase executive control','Change economic policy','Commit resources to a strategic program'],
      'Political transition':['Open dialogue and negotiation','Expand representative participation','Strengthen protections and oversight','Increase executive control'],
      'State formation':['Pursue a diplomatic initiative','Open dialogue and negotiation','Expand representative participation','Strengthen protections and oversight','Change economic policy'],
      'Diplomatic negotiation':['Open dialogue and negotiation','Pursue a diplomatic initiative','Change economic policy','Expand representative participation'],
      'Leadership and legitimacy':['Open dialogue and negotiation','Expand representative participation','Strengthen protections and oversight','Pursue a diplomatic initiative','Increase executive control'],
      'Economic resilience':['Change economic policy','Open dialogue and negotiation','Commit resources to a strategic program','Pursue a diplomatic initiative'],
      'Knowledge and adoption':['Commit resources to a strategic program','Change economic policy','Open dialogue and negotiation','Pursue a diplomatic initiative'],
      'Expedition planning':['Commit resources to a strategic program','Pursue a diplomatic initiative','Change economic policy','Open dialogue and negotiation'],
      'Social change':['Expand representative participation','Strengthen protections and oversight','Open dialogue and negotiation','Increase executive control'],
      'Relief and recovery':['Change economic policy','Commit resources to a strategic program','Pursue a diplomatic initiative','Open dialogue and negotiation'],
      'Administration and state formation':['Change economic policy','Pursue a diplomatic initiative','Expand representative participation','Strengthen protections and oversight','Increase executive control']
    };
    const supportedActions=actionSets[template?.[1]]||ACTIONS;
    const sourceRefs=Array.isArray(event.sourceRefs)?event.sourceRefs.filter(x=>typeof x==='string'):[];
    const candidates=[...(event.countries||[]),event.country,event.participants,...(event.people||[])].map(clean).filter(Boolean);
    const participant=candidates[0]||'Local decision council (hypothetical role)';
    const roles=[...new Set([participant,...candidates.slice(1,3)])];
    const year=Number.isFinite(Number(event.year))?Number(event.year):null;
    const date=clean(event.date||event.period)||(year?`c. ${year} (year-only record)`:'Date unspecified');
    const assumptions=[
      `Tier ${tier} generic simulation: ${tier==='2'?'partial record; no authored scenario is available.':'limited record; this is a hypothetical scenario inspired by the event theme.'}`,
      `Participant role: ${participant}${candidates.length?' (derived from imported participant/country metadata).':' (invented game role; no participant is established by this record).'}`,
      'All 0–100 indicators are invented gameplay scales, not historical measurements.',
      'Actions and consequences are deterministic abstractions; no territorial, military, or ownership change is inferred.'
    ];
    return Object.freeze({id:`generated-${event.id}`,title:`${event.title} — ${template?.[1]||'Historical decision scenario'}`,date,context:clean(event.summary||event.description)||'The imported record contains limited historical detail. Play proceeds as a hypothetical scenario inspired by its recorded theme.',sourceRefs,participant,roles,startingState:{stability:50,trust:50,liberties:50,legitimacy:50},objectives:[template?.[2]||'Manage stability and legitimacy while balancing public trust and civic freedoms.','Reach a favorable modeled outcome within six decisions.'],supportedActions,challenges:['Uncertain information','Competing priorities','Unmodeled historical complexity'],constraints:['No unsupported historical facts are added.','No map changes occur without sourced coordinates and an authored effect.'],assumptions,tier,maxTurns:6,theme:template?.[1]||'Historical decision scenario',hypothetical:true});
  }
  function initialize(event,role,scenario=build(event)){if(!scenario.roles.includes(role||scenario.roles[0]))throw new TypeError('Choose a listed scenario participant.');return{mode:'historical-simulation',eventId:event.id,scenarioId:scenario.id,role:role||scenario.roles[0],turn:0,node:0,date:scenario.date,state:{...scenario.startingState},choices:[],entries:[{date:scenario.date,text:`Hypothetical simulation opened: ${event.title}`,kind:'hypothetical'}],ended:false,outcome:null,created:Date.now()};}
  function nextTurn(game,year){if(game.ended)throw new Error('This scenario has ended. Restart it to play again.');game.turn++;game.node=game.turn;if(Number.isFinite(year))game.date=`Modeled turn ${game.turn} · c. ${Math.trunc(year+game.turn)}`;else game.date=`Modeled turn ${game.turn}`;if(game.turn>=6){game.ended=true;game.outcome=game.state.trust>=45&&game.state.legitimacy>=45?'favorable-modeled-outcome':'strained-modeled-outcome';}return game;}
  function evaluateOutcome(game){if(game.ended)return game.outcome;if(game.turn>=6)return game.state.trust>=45&&game.state.legitimacy>=45?'favorable-modeled-outcome':'strained-modeled-outcome';return 'in-progress';}
  return Object.freeze({ACTIONS,build,initialize,nextTurn,evaluateOutcome});
});
