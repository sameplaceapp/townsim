const {createHash,randomUUID}=require('node:crypto');
const {Character}=require('./character');
const {ageOnDate}=require('./aging');
const {related,mutualContext}=require('./partnerships');
const {isAdult}=require('./development');

const defaults={minAge:20,maxGestationalAge:45,maxOtherAge:60,minPartnershipDays:24,gestationDays:9,birthCooldownDays:24,maxChildren:3,maxPopulation:40,maxBirthsPerYear:3,dailyChance:0.015};
const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest();
// Existing residents have no biological data. Give each a stable simulation role,
// without guessing from their name, occupation, or appearance.
const role=person=>person.reproductiveRole ?? (hash(person.id,'role')[0]%2?'gestational':'other');
class Reproduction {
  constructor(world,calendar,history,partnerships,households,config,saved){
    this.world=world;this.calendar=calendar;this.history=history;this.partnerships=partnerships;this.households=households;
    this.config={...defaults,...config};
    for(const key of Object.keys(defaults)){
      const env='REPRODUCTION_'+key.replace(/[A-Z]/g,c=>'_'+c).toUpperCase();
      if(process.env[env]!==undefined){if(!process.env[env].trim())throw new Error(`Invalid reproduction setting: ${env}`);this.config[key]=Number(process.env[env]);}
    }
    for(const key of ['minAge','maxGestationalAge','maxOtherAge','minPartnershipDays','gestationDays','birthCooldownDays','maxChildren','maxPopulation','maxBirthsPerYear'])
      if(!Number.isSafeInteger(this.config[key])||this.config[key]<0)throw new Error(`Invalid reproduction setting: ${key}`);
    if(this.config.gestationDays<1||this.config.minAge<18||this.config.maxGestationalAge<this.config.minAge||this.config.maxOtherAge<this.config.minAge||!Number.isFinite(this.config.dailyChance)||this.config.dailyChance<0||this.config.dailyChance>1)throw new Error('Invalid reproduction settings');
    this.pending=[];this.lastCheckedDay=world.time.day;this.lastBirth={};this.recentBirths=[];this.deferred={};
    if(saved!==undefined){
      if(!saved||saved.version!==1||!Array.isArray(saved.pending)||!Number.isSafeInteger(saved.lastCheckedDay)||saved.lastCheckedDay<1||saved.lastCheckedDay>world.time.day||!saved.lastBirth||typeof saved.lastBirth!=='object'||Array.isArray(saved.lastBirth)||!Array.isArray(saved.recentBirths))throw new Error('Invalid reproduction state');
      const ids=new Set(),parents=new Set();
      for(const p of saved.pending){
        if(!p||typeof p.id!=='string'||!/^pregnancy:[a-f0-9-]+$/.test(p.id)||ids.has(p.id)||!Array.isArray(p.parents)||p.parents.length!==2||p.parents.some(id=>typeof id!=='string'||!id||parents.has(id))||p.parents[0]===p.parents[1]||!p.parents.includes(p.gestationalParent)||typeof p.residenceId!=='string'||!p.residenceId||!Number.isSafeInteger(p.startedDay)||p.startedDay<1||p.startedDay>world.time.day||!Number.isSafeInteger(p.dueDay)||p.dueDay<=p.startedDay)throw new Error('Invalid pending pregnancy');
        ids.add(p.id);p.parents.forEach(id=>parents.add(id));this.pending.push(structuredClone(p));
      }
      for(const [id,day] of Object.entries(saved.lastBirth))if(!id||!Number.isSafeInteger(day)||day<1||day>world.time.day)throw new Error('Invalid birth cooldown');
      if(saved.recentBirths.some(day=>!Number.isSafeInteger(day)||day<1||day>world.time.day))throw new Error('Invalid birth rate state');
      this.lastCheckedDay=saved.lastCheckedDay;this.lastBirth={...saved.lastBirth};this.recentBirths=[...saved.recentBirths];
    }
  }
  reason(p){
    const day=this.world.time.day, people=p.partners.map(id=>this.world.characters.find(c=>c.id===id)),[a,b]=people;
    if(!a||!b||!isAdult(a)||!isAdult(b))return 'missing or dependent parent';
    if(related(a,b,this.world.characters))return 'close biological relatives';
    const roles=people.map(role);if(!roles.includes('gestational')||!roles.includes('other'))return 'incompatible reproductive roles';
    const ages=people.map(c=>ageOnDate(c.birthDate,this.calendar.current()));
    if(ages.some((age,i)=>age<this.config.minAge||age>(roles[i]==='gestational'?this.config.maxGestationalAge:this.config.maxOtherAge)))return 'age outside eligible range';
    if(day-p.startedDay<this.config.minPartnershipDays||p.strain||!mutualContext(a,b))return 'partnership not stable or established';
    if(this.partnerships.marriages?.current.get(a.id)?.status==='separated')return 'marital separation';
    const household=this.households.byMember.get(a.id);
    if(!household||household!==this.households.byMember.get(b.id)||!this.households.isResidence(household.residenceId))return 'parents do not share a valid home';
    const reserved=this.pending.filter(x=>x.residenceId===household.residenceId).length;
    if(this.households.occupancy(household.residenceId)+reserved>=this.households.capacity(household.residenceId))return 'housing capacity';
    if(this.pending.some(x=>x.parents.some(id=>p.partners.includes(id))))return 'already expecting';
    if(people.some(c=>day-(this.lastBirth[c.id]||-Infinity)<this.config.birthCooldownDays))return 'birth cooldown';
    if(people.some(c=>this.world.characters.filter(child=>child.parentIds?.includes(c.id)).length>=this.config.maxChildren))return 'family size limit';
    if(this.world.characters.length+this.pending.length>=this.config.maxPopulation)return 'population limit';
    if(this.recentBirths.length+this.pending.length>=this.config.maxBirthsPerYear)return 'birth rate limit';
    const traits=people.flatMap(c=>c.personality||[]),preference=hash(...p.partners.slice().sort(),'family')[0];
    const threshold=Math.max(35,Math.min(190,125+traits.filter(t=>t==='kind').length*8-traits.filter(t=>t==='cautious').length*12));
    if(preference>=threshold)return 'family preference';
    return null;
  }
  dayStarted(day){
    if(day<=this.lastCheckedDay)return;
    this.lastCheckedDay=day;this.recentBirths=this.recentBirths.filter(d=>day-d<this.calendar.daysPerYear);this.deferred={};
    for(const p of [...this.pending])if(day>=p.dueDay)this.deliver(p);
    for(const p of this.partnerships.active.values()){
      const reason=this.reason(p);if(reason){this.deferred[p.id]=reason;continue;}
      const traits=p.partners.flatMap(id=>this.world.characters.find(c=>c.id===id).personality||[]);
      const chance=Math.min(1,this.config.dailyChance*(traits.includes('kind')?1.15:1)*(traits.includes('cautious')?0.8:1));
      if(hash(p.id,day,'family-planning').readUInt32BE(0)/0x100000000>=chance)continue;
      const gestationalParent=p.partners.find(id=>role(this.world.characters.find(c=>c.id===id))==='gestational');
      this.pending.push({id:`pregnancy:${randomUUID()}`,parents:[...p.partners],gestationalParent,startedDay:day,dueDay:day+this.config.gestationDays,residenceId:this.households.byMember.get(gestationalParent).residenceId});
    }
  }
  deliver(p){
    const parent=this.world.characters.find(c=>c.id===p.gestationalParent),household=parent&&this.households.byMember.get(parent.id);
    if(!parent||!household||!this.households.isResidence(household.residenceId)){this.deferred[p.id]='parent or residence unavailable';return;}
    p.residenceId=household.residenceId;
    if(this.households.occupancy(household.residenceId)>=this.households.capacity(household.residenceId)){this.deferred[p.id]='housing capacity';return;}
    const id=`child:${p.id.slice('pregnancy:'.length)}`;
    if(this.world.characters.some(c=>c.id===id)){this.pending=this.pending.filter(x=>x!==p);return;}
    if(this.history.get(`birth:${id}`))throw new Error('Birth history exists without the corresponding child; refusing to duplicate it');
    const names=['Alex','Amelia','Avery','Eli','Ella','Finn','Hazel','Jamie','Jules','Maya','Milo','Nora','Olive','Owen','Rowan','Sam','Theo','Willow'];
    const digest=hash(id,'name'),name=names[digest.readUInt32BE(0)%names.length];
    const date=this.calendar.current(),building=this.world.buildings[household.residenceId];
    const child=new Character({id,name,job:'dependent',personality:['quiet'],home:household.residenceId,color:'#e9c9a0',birthDate:{year:date.year,dayOfYear:date.dayOfYear}}, {x:building.door[0],y:building.door[1]});
    child.parentIds=[...p.parents];child.lifecycle='infant';child.workplace=null;child.schedule={};child.activity='sleep';child.location=household.residenceId;child.inside=true;
    this.history.record({id:`birth:${id}`,type:'birth',description:`${name} was born`,entities:[{kind:'character',id},...p.parents.map(id=>({kind:'character',id})),{kind:'building',id:household.residenceId}],metadata:{childId:id,parentIds:[...p.parents],householdId:household.id,pregnancyId:p.id}});
    this.world.characters.push(child);household.members.push(id);this.households.byMember.set(id,household);
    for(const parentId of p.parents)this.lastBirth[parentId]=this.world.time.day;
    this.recentBirths.push(this.world.time.day);this.pending=this.pending.filter(x=>x!==p);
  }
  toJSON(){return {version:1,pending:this.pending,lastCheckedDay:this.lastCheckedDay,lastBirth:this.lastBirth,recentBirths:this.recentBirths};}
}
module.exports={Reproduction,role};
