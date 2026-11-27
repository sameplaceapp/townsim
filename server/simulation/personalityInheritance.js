const {createHash}=require('node:crypto');
const {traitAbbreviations}=require('../../config/characters.json');

// Personality is an existing list of named traits, not a numeric scale.
const TRAITS=Object.freeze(Object.keys(traitAbbreviations));
const VALID=new Set(TRAITS);
const OPPOSITES=[['cheerful','grumpy'],['hardworking','lazy'],['adventurous','cautious']];
const compatible=(traits,trait)=>!traits.includes(trait)&&!OPPOSITES.some(pair=>pair.includes(trait)&&traits.some(existing=>existing!==trait&&pair.includes(existing)));
const equalSet=(a,b)=>a.length===b.length&&a.every(trait=>b.includes(trait));

// The child's unique ID supplies deterministic bounded variation, so retrying
// the same birth after a restart cannot change the outcome. No parent is mutated.
function inheritPersonality(childId, parents){
  const available=(Array.isArray(parents)?parents:[]).filter(p=>p&&typeof p.id==='string'&&p.id).slice(0,2).map(p=>({
    id:p.id,traits:[...new Set((Array.isArray(p.personality)?p.personality:[]).filter(t=>typeof t==='string'&&VALID.has(t)))]
  }));
  let counter=0;
  function randomIndex(length){return createHash('sha256').update(JSON.stringify([childId,'personality',counter++])).digest().readUInt32BE(0)%length;}
  function pick(candidates){return candidates.length?candidates[randomIndex(candidates.length)]:null;}
  const traits=[];
  // Randomize parent order to avoid a systematic preference when traits conflict.
  const order=available.length===2&&randomIndex(2)===1?[available[1],available[0]]:available;
  for(const parent of order){
    const trait=pick(parent.traits.filter(t=>compatible(traits,t)));
    if(trait)traits.push(trait);
  }
  const parentTraits=new Set(available.flatMap(p=>p.traits));
  function variation(){return pick(TRAITS.filter(t=>!parentTraits.has(t)&&compatible(traits,t)))||pick(TRAITS.filter(t=>compatible(traits,t)));}
  while(traits.length<2){const trait=variation();if(!trait)break;traits.push(trait);}
  // A minority get an additional uncommon trait, retaining both parental influences.
  if(randomIndex(5)===0){const trait=variation();if(trait)traits.push(trait);}
  // Never copy a complete known parent's valid personality exactly.
  if(available.some(p=>p.traits.length&&equalSet(traits,p.traits))){
    const old=traits.pop();
    const candidates=TRAITS.filter(t=>t!==old&&compatible(traits,t)&&!available.some(p=>p.traits.length&&equalSet([...traits,t],p.traits)));
    const replacement=pick(candidates.filter(t=>!parentTraits.has(t)))||pick(candidates);
    traits.push(replacement||old);
  }
  return {version:1,traits:[...traits],parents:available.map(p=>({id:p.id,traits:[...p.traits]})),
    sources:traits.map(trait=>({trait,parentIds:available.filter(p=>p.traits.includes(trait)).map(p=>p.id)}))};
}
module.exports={inheritPersonality,TRAITS};
