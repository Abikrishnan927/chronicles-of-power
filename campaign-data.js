window.COPContent = (()=>{
const SOURCES = [
  {title:"Emergency (India), 1975–1977 — PIB Archives factsheet",detail:"Government of India factsheet summarizing the period, its dates, Article 352, and the Shah Commission’s remit. Campaign context reference.",url:"https://www.pib.gov.in/FactsheetDetails.aspx?Id=149224&lang=1&reg=3",type:"Government of India · Primary institutional summary"},
  {title:"The Shah Commission of Inquiry — Archives of Contemporary India",detail:"Archival collection description for the inquiry into the Emergency and its three reports. Evidence on censorship, detention, and state power is historically documented; individual interpretations should be checked against the reports themselves.",url:"https://archives.ashoka.edu.in/paper_details/120",type:"Ashoka University Archives · Archival collection"},
  {title:"India: Emergency powers and constitutional records — Parliament Digital Library",detail:"Parliamentary records on statutory approval of the proclamation, including the July 1975 resolution.",url:"https://eparlib.sansad.in/handle/123456789/854888?view_type=search",type:"Parliament of India · Parliamentary record"},
  {title:"General Elections, 1977 — Election Commission of India",detail:"Election Commission publication and statistical records for the 1977 general election. The election and transfer of power are historical; campaign alternatives are simulated.",url:"https://www.eci.gov.in/statistical-reports",type:"Election Commission of India · Official election records"},
  {title:"Revocation of Emergency proclamation — Ministry of Home Affairs Gazette",detail:"Gazette notification revoking the June 1975 proclamation in March 1977.",url:"https://www.mha.gov.in/sites/default/files/RTI_ISIdiv_210814_0021_408.PDF",type:"Government of India · Gazette document"},
  {title:"Foreign Relations of the United States, 1969–1976, Volume E–8, Document 229",detail:"Declassified U.S. diplomatic document discussing the Emergency, censorship, opposition constraints, and contemporary assessments. It reflects a diplomatic perspective, not a complete account.",url:"https://history.state.gov/historicaldocuments/frus1969-76ve08/d229",type:"U.S. Department of State · Declassified diplomatic record"}
];

const EVENTS = [
 {id:"emergency",title:"India’s Emergency",period:"1975 — 1977",place:"New Delhi, India",category:"Political emergency",art:"art-emergency",glyph:"§",status:"playable",summary:"A 21-month suspension of ordinary democratic processes became a defining test of India’s institutions.",date:"25 June 1975",year:1975},
 {id:"cuba",title:"Cuban Missile Crisis",period:"1962",place:"Havana · Washington · Moscow",category:"Nuclear crisis",art:"art-cuba",glyph:"◉",status:"reference",summary:"A tense thirteen-day confrontation brought the United States and Soviet Union to the edge of nuclear conflict.",date:"October 1962",year:1962},
 {id:"wwi",title:"The Great War Begins",period:"1914 — 1918",place:"Sarajevo · Europe",category:"Military conflict",art:"art-war",glyph:"✦",status:"reference",summary:"An assassination in Sarajevo set off a chain of alliances, mobilizations, and decisions across Europe.",date:"28 July 1914",year:1914},
 {id:"berlin",title:"The Berlin Wall Opens",period:"1989",place:"Berlin, Germany",category:"Political transition",art:"art-berlin",glyph:"▥",status:"reference",summary:"A confusing press conference and a public rush at border crossings accelerated a momentous opening.",date:"9 November 1989",year:1989},
 {id:"space",title:"Race to the Moon",period:"1957 — 1969",place:"Kennedy Space Center, Florida · Washington · Moscow",category:"Technology race",art:"art-space",glyph:"✧",status:"reference",summary:"A superpower rivalry transformed science, engineering, and the politics of exploration.",date:"1957 — 1969",year:1961},
 {id:"independence",title:"India’s Independence",period:"1947",place:"Delhi · South Asia",category:"Independence movement",art:"art-independence",glyph:"✳",status:"reference",summary:"The end of British rule arrived alongside Partition, mass displacement, and a new constitutional future.",date:"15 August 1947",year:1947},
 {id:"oil",title:"Oil Shock & Global Reordering",period:"1973 — 1974",place:"Riyadh, Saudi Arabia (producer-state reference) · Global",category:"Economic crisis",art:"art-crisis",glyph:"⌁",status:"reference",summary:"Oil embargoes and production cuts reshaped energy policy, prices, and diplomatic relationships worldwide.",date:"October 1973",year:1973}
 ,...(window.COPImportedEvents||[])
];

EVENTS.forEach(event=>{event.campaignType=event.campaignType||(event.imported?'archive':event.id==='emergency'?'curated':'simulation');event.simulationAvailable=event.imported?event.isPlayable===true:(event.simulationAvailable??true);event.region=event.region||(/India|Delhi/.test(event.place)?'South Asia':/Cuba|Washington|Moscow|Earth orbit/.test(event.place)?'Americas':/Europe|Sarajevo|Berlin|Germany/.test(event.place)?'Europe':/Middle East|Doha|Saudi Arabia/.test(event.place)?'Middle East':'Global');event.country=event.country||event.place.split(/[·,]/).pop().trim();event.sourceRefs=Array.isArray(event.sourceRefs)?event.sourceRefs:[]});
const EVENT_COUNTRIES={emergency:'India',cuba:'Cuba · United States · Soviet Union',wwi:'Bosnia and Herzegovina · Europe',berlin:'Germany',space:'United States · Soviet Union',independence:'India',oil:'Multiple countries'};
EVENTS.forEach(event=>{event.country=EVENT_COUNTRIES[event.id]||event.country});
const EVENT_SOURCE_URLS={
 emergency:[SOURCES[0].url,SOURCES[1].url,SOURCES[2].url,SOURCES[3].url,SOURCES[4].url],
 cuba:['https://history.state.gov/departmenthistory/short-history/cubanmissile'],
 wwi:['https://www.theworldwar.org/learn/about-wwi/june-28-1914'],
 berlin:['https://www.berlin.de/geschichte/8482274-3689745-oeffnung-und-fall-der-mauer.html'],
 space:['https://www.nasa.gov/mission/apollo-11/'],
 independence:['https://history.state.gov/countries/india'],
 oil:['https://history.state.gov/milestones/1969-1976/oil-embargo']
};
EVENTS.forEach(event=>{event.sourceRefs=event.sourceRefs.length?event.sourceRefs:(EVENT_SOURCE_URLS[event.id]||[])});
const EVENT_PARTICIPANTS={emergency:'Government of India · opposition parties · civil institutions',cuba:'Cuba · United States · Soviet Union',wwi:'Austria-Hungary · Serbia · European powers',berlin:'East Germany · Berlin border authorities · residents of East and West Berlin',space:'United States · Soviet Union · NASA',independence:'Indian national leadership · British government · India and Pakistan',oil:'Arab oil producers · United States · oil-importing states'};
EVENTS.forEach(event=>{event.participants=event.participants||EVENT_PARTICIPANTS[event.id]||event.country});
const eventSources=[
 ['Cuban Missile Crisis — U.S. Department of State, Office of the Historian','Official historical overview of the October 1962 crisis.','Cuba'],
 ['Sarajevo, 28 June 1914 — National WWI Museum and Memorial','Institutional account of the assassination that preceded the July Crisis.','WWI'],
 ['The opening of the Berlin Wall — Berlin.de','Berlin government chronology of the border opening on 9 November 1989.','Berlin'],
 ['Apollo 11 — NASA','NASA mission record for the July 1969 lunar landing.','NASA'],
 ['India — U.S. Department of State, Office of the Historian','Country chronology covering Indian independence and the 1947 partition context.','India'],
 ['Oil Embargo, 1973–1974 — U.S. Department of State, Office of the Historian','Official history of the 1973–74 embargo and energy crisis.','Oil']
];
for(const [i,item] of eventSources.entries()){const id=['cuba','wwi','berlin','space','independence','oil'][i];SOURCES.push({title:item[0],detail:item[1]+' The citation supports the documented record; the linked generic simulation is counterfactual.',url:EVENT_SOURCE_URLS[id][0],type:'Institutional / government historical source'})}

// WGS84 longitude/latitude points for campaign discovery, not claims about event boundaries.
EVENTS.find(event=>event.id==="emergency").coordinates=[77.2090,28.6139];
EVENTS.find(event=>event.id==="cuba").coordinates=[-82.3666,23.1136];
EVENTS.find(event=>event.id==="wwi").coordinates=[18.4131,43.8563];
EVENTS.find(event=>event.id==="berlin").coordinates=[13.4050,52.5200];
EVENTS.find(event=>event.id==="space").coordinates=[-80.6041,28.6084];
EVENTS.find(event=>event.id==="independence").coordinates=[77.2090,28.6139];
EVENTS.find(event=>event.id==="oil").coordinates=[46.6753,24.7136];

const CAMPAIGN = {title:"India’s Emergency",subtitle:"A REPUBLIC AT THE CROSSROADS",start:"25 JUNE 1975",role:"Indira Gandhi",roleNote:"Prime Minister of India · playable historical role",intro:"On the night of 25 June 1975, a national Emergency was proclaimed under Article 352. The period that followed tested the press, civil liberties, political opposition, and the institutions of the republic. You will navigate selected dilemmas from the perspective of the prime minister. This simulation is not a reconstruction of private conversations.",facts:[ ["LOCATION","New Delhi, India"],["PERIOD","1975 — 1977"],["MODE","Alternate history"]]};

const NODES = [
 {id:"opening",date:"25 JUNE 1975",title:"The Republic at midnight",brief:"Political unrest, a court judgment, and mounting opposition have created a moment of acute uncertainty. An Emergency proclamation has been issued. Your first response will shape how power is exercised and scrutinized.",historic:"Historically, the proclamation was issued on 25 June 1975 under Article 352. This playable scene condenses the moment; the presented dialogue and choice framing are fictionalized for the simulation.",options:[
  {id:"tighten",title:"Centralize control",desc:"Restrict political organizing and strengthen executive direction.",effects:{stability:7,trust:-9,liberties:-18,legitimacy:-8},outcome:"Executive control tightens quickly, while civil liberties and public trust come under severe pressure.",delay:"Independent scrutiny weakens; reports of state action become harder to assess."},
  {id:"guardrails",title:"Set public guardrails",desc:"Publish a time limit and invite parliamentary scrutiny.",effects:{stability:-3,trust:8,liberties:5,legitimacy:9},outcome:"Publicly stated limits create political friction, but provide institutions a visible standard to test.",delay:"Parliamentary scrutiny remains possible, though political tension continues."},
  {id:"dialogue",title:"Open channels to opponents",desc:"Seek a mediated political settlement while maintaining ordinary protections.",effects:{stability:-7,trust:10,liberties:8,legitimacy:7},outcome:"Dialogue reduces some immediate pressure but leaves your government exposed to criticism from its own allies.",delay:"Opposition groups gain space to coordinate; a negotiated path remains uncertain."}
 ]},
 {id:"press",date:"JULY 1975",title:"The signal in the newsroom",brief:"Reports are being prepared about detentions and restrictions. Advisers argue that tighter information controls would prevent unrest; others warn that secrecy may damage confidence and leave officials without reliable feedback.",historic:"Press censorship and restrictions on civil liberties during the Emergency are documented in the Shah Commission materials and contemporary records. The counterfactual paths here are modelled possibilities, not historical outcomes.",options:[
  {id:"censor",title:"Order pre-publication censorship",desc:"Control what can be reported before it reaches the public.",effects:{stability:5,trust:-12,liberties:-15,legitimacy:-7},outcome:"Critical reporting is constrained. The government faces less immediate public scrutiny, but independent information channels narrow.",delay:"Public and international criticism may rise; decision-makers receive a less complete picture."},
  {id:"limited",title:"Require correction, not approval",desc:"Address demonstrably false claims with a reviewable process.",effects:{stability:1,trust:4,liberties:3,legitimacy:3},outcome:"A narrower rule gives officials a response while preserving more room for reporting.",delay:"The process depends on whether review stays independent and transparent."},
  {id:"freepress",title:"Protect independent reporting",desc:"Keep the press free to report and contest government claims.",effects:{stability:-4,trust:9,liberties:12,legitimacy:8},outcome:"Critical coverage intensifies political pressure, while citizens retain channels to scrutinize state action.",delay:"A more open information environment can improve scrutiny but also amplify confrontation."}
 ]},
 {id:"election",date:"JANUARY 1977",title:"Return the question to voters",brief:"After months of Emergency rule, the government must decide whether to seek a fresh mandate, maintain restrictions, or begin a phased restoration of political competition. There is no risk-free path.",historic:"Indira Gandhi announced general elections in January 1977. Voting took place in March; the opposition won and the Emergency was revoked on 21 March. This campaign’s other endings are speculative, and the actual result is shown as documented history only in comparison mode.",options:[
  {id:"election",title:"Call a general election",desc:"Lift restrictions and put the government’s mandate to a vote.",effects:{stability:-2,trust:8,liberties:10,legitimacy:12},outcome:"An election returns political legitimacy to voters. The result is uncertain; campaign conditions and prior choices shape this simulation.",delay:"A peaceful transfer, renewed mandate, or contested aftermath becomes possible."},
  {id:"phaseout",title:"Restore protections in stages",desc:"Announce a timetable for civil-liberty protections and open political activity.",condition:{stateMin:{trust:35}},effects:{stability:3,trust:5,liberties:8,legitimacy:5},outcome:"A staged restoration lowers immediate uncertainty, while the credibility of the timetable becomes central.",delay:"Public confidence depends on whether promised milestones are met."},
  {id:"mediated",title:"Negotiate a cross-party transition",desc:"Use the early dialogue channel to agree a public timetable with opposition leaders.",condition:{priorChoice:"dialogue"},effects:{stability:-1,trust:7,liberties:8,legitimacy:10},outcome:"A negotiated timetable gives political rivals a role in the transition, though its durability remains uncertain.",delay:"The agreement depends on continued participation and credible milestones."},
  {id:"extend",title:"Extend emergency rule",desc:"Keep restrictions in place and defer electoral competition.",effects:{stability:4,trust:-14,liberties:-12,legitimacy:-13},outcome:"The government retains short-term control, but the legitimacy costs deepen and institutional trust erodes.",delay:"Domestic and international opposition may intensify; future crises become harder to contain."}
 ]}
];

const INITIAL_STATE={stability:55,trust:48,liberties:52,legitimacy:50};
const OTHER_INFO={cuba:"The October 1962 crisis involved U.S., Soviet, and Cuban decisions around missile deployments and a U.S. naval quarantine. A source-linked generic model is playable; its outcomes are hypothetical.",wwi:"The First World War began in 1914 after a chain of decisions and mobilizations. The Sarajevo assassination was a precipitating event, not a complete explanation of the war. A generic model is playable.",berlin:"The Berlin Wall border crossings opened on 9 November 1989 during rapid political change in East Germany. A source-linked generic model is playable.",space:"The space race spans multiple nations and milestones from the late 1950s through the Apollo era. This record focuses on the Apollo 11 landing; its generic model is hypothetical.",independence:"India became independent on 15 August 1947 as partition created India and Pakistan. A source-linked generic model is playable.",oil:"The 1973–74 oil embargo reshaped energy markets and diplomacy. The generic model is hypothetical and does not reconstruct any one state's actual policy process."};

return {SOURCES,EVENTS,CAMPAIGN,NODES,INITIAL_STATE,OTHER_INFO};
})();
