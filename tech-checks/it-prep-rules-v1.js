// Authoritative IT Prep checklist adapter.
// Primary checklist definitions remain in tech-check-rules.js; this module gives IT Prep one stable API.
function checklist(item,unitNo,deps={}){
  if(window.TechCheckRules?.itChecklist)return window.TechCheckRules.itChecklist(item,unitNo);
  if(typeof deps.fallbackChecklist==='function')return deps.fallbackChecklist(item,unitNo);
  throw new Error('IT Prep checklist rules are not available.');
}
function isHeliosDeploy(item){
  return window.TechCheckRules?.isHeliosDeploy
    ? window.TechCheckRules.isHeliosDeploy(item)
    : (item?.equipment_type==='Helios'&&['DELIVERY','SWAP','BACKUP'].includes(item?.purpose));
}
window.TechCheckITPrepRules=Object.freeze({checklist,isHeliosDeploy});
