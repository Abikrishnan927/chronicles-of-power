/* Deterministic simulation rules, kept independent of rendering and browser UI. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.COPSimulation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const clampScore=value=>Math.max(0,Math.min(100,value));
  function applyEffects(state,effects){
    const next={...state};
    for(const [key,delta] of Object.entries(effects||{})){
      if(!Number.isFinite(next[key])||!Number.isFinite(delta))throw new TypeError(`Invalid simulation value for ${key}`);
      next[key]=clampScore(next[key]+delta);
    }
    return next;
  }
  function validateSave(value,nodeCount){
    return !!value&&Number.isInteger(value.node)&&value.node>=0&&value.node<=nodeCount&&value.state&&
      ['stability','trust','liberties','legitimacy'].every(key=>Number.isFinite(value.state[key]))&&
      Array.isArray(value.choices)&&Array.isArray(value.entries);
  }
  function isAvailable(option,state,choices){
    const rule=option.condition;
    if(!rule)return true;
    if(rule.stateMin&&Object.entries(rule.stateMin).some(([key,min])=>!Number.isFinite(state[key])||state[key]<min))return false;
    if(rule.priorChoice&&!choices.some(choice=>choice.choice===rule.priorChoice))return false;
    return true;
  }
  function lockReason(option,state,choices){
    const rule=option.condition||{};
    if(rule.priorChoice&&!choices.some(choice=>choice.choice===rule.priorChoice))return `requires earlier choice: ${rule.priorChoice}`;
    if(rule.stateMin){const missing=Object.entries(rule.stateMin).find(([key,min])=>!Number.isFinite(state[key])||state[key]<min);if(missing)return `requires ${missing[0]} at ${missing[1]} or higher`;}
    return 'requirements not met';
  }
  function endingFor(state){
    if(state.liberties>=65&&state.legitimacy>=62)return 'open-mandate';
    if(state.liberties<35||state.trust<25)return 'legitimacy-strain';
    if(state.stability>=60&&state.legitimacy<45)return 'uneasy-calm';
    return 'negotiated-transition';
  }
  function interpretAction(text,context){
    if(context&&(!context.scenarioId||!context.date||!Array.isArray(context.allowedRoles)||!context.allowedRoles.includes(context.role)))return {clarification:'The selected scenario, start date, or decision-maker role is invalid. Choose a listed role and try again.'};
    const q=String(text||'').trim().toLowerCase();if(q.length<8)return {clarification:'Describe a policy, diplomatic move, political decision, or public action in a little more detail.'};
    const rules=[
      {match:/negot|dialog|mediate|talk|reconcile|coalition|peace/,label:'Open dialogue and negotiation',effects:{stability:-2,trust:5,liberties:2,legitimacy:4}},
      {match:/elect|vote|referendum|mandate|parliament|represent/,label:'Expand representative participation',effects:{stability:-2,trust:4,liberties:5,legitimacy:6}},
      {match:/executive control|censor|ban|suppress|arrest|detain|crackdown|curfew|restrict|force|military|emergency rule/,label:'Increase executive control',effects:{stability:4,trust:-5,liberties:-7,legitimacy:-4}},
      {match:/reform|protect|rights|libert|release|oversight|independent|transparen|accountab/,label:'Strengthen protections and oversight',effects:{stability:-1,trust:4,liberties:5,legitimacy:4}},
      {match:/trade|sanction|tariff|aid|investment|embargo|energy|oil|economic|price/,label:'Change economic policy',effects:{stability:2,trust:1,liberties:0,legitimacy:1}},
      {match:/treaty|alliance|diplomat|foreign|summit|withdraw|deploy|missile|negotiate with/,label:'Pursue a diplomatic initiative',effects:{stability:1,trust:2,liberties:0,legitimacy:2}},
      {match:/launch|space|research|science|technology|program/,label:'Commit resources to a strategic program',effects:{stability:1,trust:2,liberties:0,legitimacy:1}}
    ];const rule=rules.find(r=>r.match.test(q));return rule?{label:rule.label,effects:rule.effects}:{clarification:'I could not confidently classify this action. Specify whether it changes political participation, executive control, civil protections, economic policy, or diplomacy. No state has been changed.'};
  }
  return Object.freeze({applyEffects,validateSave,endingFor,clampScore,isAvailable,lockReason,interpretAction});
});
