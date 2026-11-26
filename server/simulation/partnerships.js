const {createHash, randomUUID}=require('node:crypto');
const {ageOnDate}=require('./aging');

const MIN_AGE=18, MIN_INTERACTIONS=5, FORMATION_COOLDOWN=6, MIN_PARTNERSHIP_DAYS=5;
const idKey=(a,b)=>JSON.stringify([a,b].sort());
const hashKey=(a,b)=>createHash('sha256').update(idKey(a,b)).digest('hex');
function related(a,b,characters=[]) {
  const aParents=Array.isArray(a.parentIds)?a.parentIds:[];
  const bParents=Array.isArray(b.parentIds)?b.parentIds:[];
  const grandparents=ids=>ids.flatMap(id=>{
    const parent=characters.find(c=>c.id===id);
    return Array.isArray(parent?.parentIds)?parent.parentIds:[];
  });
  const aGrandparents=grandparents(aParents), bGrandparents=grandparents(bParents);
  const tags=new Set(['parent','child','sibling']);
  return aParents.includes(b.id)||bParents.includes(a.id)||aParents.some(id=>bParents.includes(id))||
    aGrandparents.includes(b.id)||bGrandparents.includes(a.id)||
    aGrandparents.some(id=>bParents.includes(id)||bGrandparents.includes(id))||
    bGrandparents.some(id=>aParents.includes(id))||
    tags.has(a.relationships?.[b.id]?.tag)||tags.has(b.relationships?.[a.id]?.tag);
}
function mutualContext(a,b) {
  const r=a.relationships?.[b.id], s=b.relationships?.[a.id];
  return !!r && !!s && [r,s].every(x=>x.affection>=6 && x.trust>=5.5 && x.attraction>=4 && x.interactionCount>=MIN_INTERACTIONS);
}
function willing(a,b) {
  const traits=[...(a.personality||[]),...(b.personality||[])];
  const shared=(a.personality||[]).filter(t=>(b.personality||[]).includes(t)).length;
  const threshold=Math.min(75,Math.max(20,45+shared*5+traits.filter(t=>t==='kind'||t==='flirtatious').length*3-traits.filter(t=>t==='cautious').length*6));
  return parseInt(hashKey(a.id,b.id).slice(0,8),16)%100 < threshold;
}
class Partnerships {
  constructor(world,calendar,history,saved) {
    this.world=world;this.calendar=calendar;this.history=history;
    this.active=new Map();this.byCharacter=new Map();this.courtships=Object.create(null);this.cooldowns=Object.create(null);
    if(saved===undefined)return;
    if(!saved||saved.version!==1||!Array.isArray(saved.active)||!saved.courtships||typeof saved.courtships!=='object'||Array.isArray(saved.courtships)||!saved.cooldowns||typeof saved.cooldowns!=='object'||Array.isArray(saved.cooldowns)) throw new Error('Invalid partnership state');
    for(const p of saved.active) {
      if(!p||typeof p.id!=='string'||!Array.isArray(p.partners)||p.partners.length!==2||p.partners.some(id=>typeof id!=='string'||!id)||p.partners[0]===p.partners[1]||!Number.isSafeInteger(p.startedDay)||p.startedDay<1||p.startedDay>world.time.day||this.active.has(p.id)||p.partners.some(id=>this.byCharacter.has(id))) throw new Error('Invalid active partnership');
      if(p.strain!==undefined&&(!p.strain||!Number.isSafeInteger(p.strain.days)||p.strain.days<1||
          !Number.isSafeInteger(p.strain.lastDay)||p.strain.lastDay<p.startedDay||p.strain.lastDay>world.time.day)) throw new Error('Invalid partnership strain');
      const record={id:p.id,partners:[...p.partners],startedDay:p.startedDay,
        ...(p.strain?{strain:{...p.strain}}:{})};
      this.active.set(record.id,record);for(const id of record.partners)this.byCharacter.set(id,record);
    }
    for(const [key,c] of Object.entries(saved.courtships)) {
      if(!/^[a-f0-9]{64}$/.test(key)||!c||!Array.isArray(c.partners)||c.partners.length!==2||c.partners.some(id=>typeof id!=='string'||!id)||c.partners[0]===c.partners[1]||hashKey(...c.partners)!==key||!Number.isSafeInteger(c.firstDay)||c.firstDay<1||!Number.isSafeInteger(c.lastDay)||c.lastDay<c.firstDay||c.lastDay>world.time.day||!Number.isSafeInteger(c.days)||c.days<1||c.days>c.lastDay-c.firstDay+1||!Array.isArray(c.initiators)||c.initiators.length<1||c.initiators.length>2||new Set(c.initiators).size!==c.initiators.length||c.initiators.some(id=>!c.partners.includes(id))) throw new Error('Invalid courtship state');
      this.courtships[key]={...c,partners:[...c.partners],initiators:[...c.initiators]};
    }
    for(const [id,day] of Object.entries(saved.cooldowns)) {
      if(!id||!Number.isSafeInteger(day)||day<1)throw new Error('Invalid partnership cooldown');
      this.cooldowns[id]=day;
    }
  }
  partnerOf(id) { const p=this.byCharacter.get(id);return p ? p.partners.find(other=>other!==id) : null; }
  eligible(a,b) {
    if(!a||!b||a.id===b.id||!this.world.characters.includes(a)||!this.world.characters.includes(b)||
        !a.birthDate||!b.birthDate||this.byCharacter.has(a.id)||this.byCharacter.has(b.id)||related(a,b,this.world.characters))return false;
    const date=this.calendar.current();
    return ageOnDate(a.birthDate,date)>=MIN_AGE&&ageOnDate(b.birthDate,date)>=MIN_AGE&&
      this.world.time.day >= (this.cooldowns[a.id]||0)&&this.world.time.day >= (this.cooldowns[b.id]||0);
  }
  clearCourtships(ids) {
    for(const [key,c] of Object.entries(this.courtships)) if(c.partners.some(id=>ids.includes(id)))delete this.courtships[key];
  }
  prune(day) {
    for(const [key,c] of Object.entries(this.courtships)) if(day-c.lastDay>12)delete this.courtships[key];
    for(const [id,until] of Object.entries(this.cooldowns)) if(day>=until)delete this.cooldowns[id];
  }
  record(id,description,partners,metadata) {
    try { this.history.record({id,type:'relationship_changed',description,entities:partners.map(id=>({kind:'character',id})),metadata});return true; }
    catch(err) { console.error('Unable to record partnership transition:',err.message);return false; }
  }
  onInteraction(a,b,action) {
    if(!a||!b||a.id===b.id)return;
    const day=this.world.time.day;
    for(const id of [a.id,b.id]) if(this.cooldowns[id] && day>=this.cooldowns[id]) delete this.cooldowns[id];
    const current=this.byCharacter.get(a.id);
    if(current && this.byCharacter.get(b.id)===current) { this.considerSeparation(current,a,b,action);return; }
    const key=hashKey(a.id,b.id);
    if(!['flirt','confess'].includes(action)&&!this.courtships[key])return;
    if(!this.eligible(a,b)||!mutualContext(a,b)||!willing(a,b)) { delete this.courtships[key];return; }
    if(!['flirt','confess'].includes(action))return;
    const partners=[a.id,b.id].sort();
    let c=this.courtships[key];
    if(!c||day-c.lastDay>12) c=this.courtships[key]={partners,firstDay:day,lastDay:day,days:1,initiators:[a.id]};
    else {
      if(!c.initiators.includes(a.id))c.initiators.push(a.id);
      if(day>c.lastDay){c.days++;c.lastDay=day;}
    }
    const cautious=[...(a.personality||[]),...(b.personality||[])].includes('cautious');
    if(c.days<(cautious?4:3)||c.initiators.length<2||day-c.firstDay<2)return;
    const id=randomUUID();
    if(!this.record(`partnership:${id}:formed`,'A romantic partnership began',partners,{milestone:'partnership_formed',partnershipId:id}))return;
    const p={id,partners,startedDay:day};this.active.set(id,p);
    for(const person of partners)this.byCharacter.set(person,p);
    this.clearCourtships(partners);
  }
  considerSeparation(p,a,b,action) {
    const day=this.world.time.day;
    const r=a.relationships[b.id],s=b.relationships[a.id];
    if(!r||!s)return;
    const severe=[r,s].some(x=>x.affection<=2||x.trust<=2.5);
    if(!severe) { delete p.strain; return; }
    if(day-p.startedDay<MIN_PARTNERSHIP_DAYS||!['argue','confront'].includes(action))return;
    if(!p.strain||day-p.strain.lastDay>12) p.strain={days:1,lastDay:day};
    else if(day>p.strain.lastDay){p.strain.days++;p.strain.lastDay=day;}
    if(p.strain.days<3)return;
    if(this.marriages?.separate(p)) { delete p.strain; return; }
    if(!this.record(`partnership:${p.id}:ended`,'A romantic partnership ended',p.partners,
        {milestone:'partnership_ended',partnershipId:p.id,startedDay:p.startedDay}))return;
    this.endForDivorce(p,day);
  }
  endForDivorce(p,day) {
    this.marriages?.forgetPartnership(p.id);
    this.active.delete(p.id);
    for(const id of p.partners){this.byCharacter.delete(id);this.cooldowns[id]=day+FORMATION_COOLDOWN;}
    this.clearCourtships(p.partners);
    this.households?.partnershipEnded(p);
  }
  toJSON() {
    return {version:1,active:[...this.active.values()].map(p=>({...p,partners:[...p.partners]})),
      courtships:this.courtships,cooldowns:this.cooldowns};
  }
}
module.exports={Partnerships,related,mutualContext,willing};
