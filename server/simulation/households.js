const {createHash,randomUUID}=require('node:crypto');
const {ageOnDate}=require('./aging');
const {isAdult}=require('./development');
const nowTime=world=>({...world.time});
const validTime=t=>t&&Number.isSafeInteger(t.day)&&t.day>=1&&Number.isInteger(t.hour)&&t.hour>=0&&t.hour<24&&Number.isInteger(t.minute)&&t.minute>=0&&t.minute<60;
const minute=t=>((t.day-1)*24+t.hour)*60+t.minute;
function willingToShare(a,b) {
  const ids=[a.id,b.id].sort(),traits=[...(a.personality||[]),...(b.personality||[])];
  const threshold=Math.max(20,Math.min(70,50-traits.filter(t=>t==='cautious').length*8+traits.filter(t=>t==='kind').length*3));
  return parseInt(createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0,8),16)%100<threshold;
}
class Households {
  constructor(world,worldId,calendar,history,partnerships,saved) {
    this.world=world;this.calendar=calendar;this.history=history;this.partnerships=partnerships;
    this.records=new Map();this.byMember=new Map();this.intent=Object.create(null);
    if(saved===undefined){this.initialize(worldId);return;}
    if(!saved||saved.version!==1||!Array.isArray(saved.records)||!saved.intent||typeof saved.intent!=='object'||Array.isArray(saved.intent))throw new Error('Invalid household state');
    const people=new Map(world.characters.map(c=>[c.id,c]));
    for(const row of saved.records){
      if(!row||typeof row.id!=='string'||!row.id||this.records.has(row.id)||!['active','merged','inactive'].includes(row.status)||
        !Array.isArray(row.members)||!row.members.length||row.members.some(id=>typeof id!=='string'||!id)||new Set(row.members).size!==row.members.length||
        !(row.residenceId===null||(row.status==='active'?this.isResidence(row.residenceId):typeof row.residenceId==='string'&&!!row.residenceId))||
        !(row.createdAt===null||validTime(row.createdAt))||!validTime(row.observedAt)||
        minute(row.observedAt)>minute(world.time)||(row.createdAt&&minute(row.createdAt)>minute(world.time))||
        !Number.isSafeInteger(row.lastMoveDay)||row.lastMoveDay<1||row.lastMoveDay>world.time.day)throw new Error('Invalid household record');
      if(row.status==='merged'&&(!validTime(row.endedAt)||minute(row.endedAt)>minute(world.time)||typeof row.mergedInto!=='string'))throw new Error('Invalid merged household');
      if(row.status==='inactive'&&(!validTime(row.endedAt)||minute(row.endedAt)>minute(world.time)))throw new Error('Invalid inactive household');
      if(row.cohabitation!==undefined&&(!row.cohabitation||typeof row.cohabitation.partnershipId!=='string'||
        typeof row.cohabitation.moverId!=='string'||!row.members.includes(row.cohabitation.moverId)||
        !(row.cohabitation.previousResidenceId===null||(typeof row.cohabitation.previousResidenceId==='string'&&!!row.cohabitation.previousResidenceId))))throw new Error('Invalid household cohabitation');
      const copy=structuredClone(row);this.records.set(copy.id,copy);
      if(copy.status==='active')for(const id of copy.members){
        const person=people.get(id);
        if(!person||this.byMember.has(id)||(copy.residenceId!==null&&person.home!==copy.residenceId))throw new Error('Inconsistent household membership');
        this.byMember.set(id,copy);
      }
    }
    for(const person of world.characters)if(!this.byMember.has(person.id))throw new Error('Resident has no household');
    for(const row of this.records.values())if(row.status==='merged'&&!this.records.has(row.mergedInto))throw new Error('Missing merged household destination');
    for(const [id,value] of Object.entries(saved.intent)){
      const p=partnerships.active.get(id);
      if(!p||!value||!Number.isSafeInteger(value.firstDay)||value.firstDay<1||!Number.isSafeInteger(value.lastDay)||value.lastDay<value.firstDay||value.lastDay>world.time.day||
        !Number.isSafeInteger(value.days)||value.days<1||value.days>value.lastDay-value.firstDay+1||!Array.isArray(value.initiators)||value.initiators.length<1||value.initiators.length>2||
        new Set(value.initiators).size!==value.initiators.length||value.initiators.some(person=>!p.partners.includes(person)))throw new Error('Invalid household intent');
      this.intent[id]={...value,initiators:[...value.initiators]};
    }
  }
  isResidence(id){const building=typeof id==='string'?this.world.buildings[id]:null;return !!building&&building.type==='home'&&Array.isArray(building.door)&&building.door.length===2;}
  capacity(id){const capacity=this.world.buildings[id]?.capacity;return capacity===undefined?4:Number.isSafeInteger(capacity)&&capacity>=0?capacity:0;}
  occupancy(id){let n=0;for(const row of this.records.values())if(row.status==='active'&&row.residenceId===id)n+=row.members.length;return n;}
  initialize(worldId){
    const groups=new Map();
    for(const character of this.world.characters){
      const home=this.isResidence(character.home)?character.home:null;
      const key=home===null?`unassigned:${character.id}`:`home:${home}`;
      if(!groups.has(key))groups.set(key,{home,members:[]});groups.get(key).members.push(character.id);
    }
    for(const [key,group] of groups){
      const id='household:'+createHash('sha256').update(JSON.stringify([worldId,key])).digest('hex');
      const row={id,status:'active',members:group.members,residenceId:group.home,createdAt:null,observedAt:nowTime(this.world),lastMoveDay:this.world.time.day};
      this.records.set(id,row);for(const member of row.members)this.byMember.set(member,row);
    }
  }
  info(id){const row=this.byMember.get(id);return row?{id:row.id,residenceId:row.residenceId,members:[...row.members],status:row.status}:null;}
  record(id,type,description,entities,metadata){
    const buildings=[...new Set([metadata.fromResidenceId,metadata.toResidenceId].filter(Boolean))];
    try{this.history.record({id,type,description,entities:[...entities.map(id=>({kind:'character',id})),...buildings.map(id=>({kind:'building',id}))],metadata});return true;}
    catch(err){console.error('Unable to record household transition:',err.message);return false;}
  }
  onInteraction(a,b,action){
    if(!a||!b||!isAdult(a)||!isAdult(b)||a.id===b.id)return;
    const partnership=this.partnerships.byCharacter.get(a.id);
    if(!partnership||this.partnerships.byCharacter.get(b.id)!==partnership)return;
    const ha=this.byMember.get(a.id),hb=this.byMember.get(b.id),day=this.world.time.day;
    if(!ha||!hb||ha===hb||ha.members.length!==1||hb.members.length!==1||day-partnership.startedDay<12||
       day-ha.lastMoveDay<6||day-hb.lastMoveDay<6||!a.birthDate||!b.birthDate||
       ageOnDate(a.birthDate,this.calendar.current())<18||ageOnDate(b.birthDate,this.calendar.current())<18||!willingToShare(a,b)){
      delete this.intent[partnership.id];return;
    }
    const ra=a.relationships?.[b.id],rb=b.relationships?.[a.id];
    if(!ra||!rb||[ra,rb].some(r=>r.affection<6||r.trust<5.5)){delete this.intent[partnership.id];return;}
    if(!['flirt','confess','comfort','gift'].includes(action))return;
    let value=this.intent[partnership.id];
    if(!value||day-value.lastDay>12)value=this.intent[partnership.id]={firstDay:day,lastDay:day,days:1,initiators:[a.id]};
    else {if(!value.initiators.includes(a.id))value.initiators.push(a.id);if(day>value.lastDay){value.days++;value.lastDay=day;}}
    if(value.days<3||value.initiators.length<2||day-value.firstDay<2)return;
    const options=[ha,hb].filter(h=>h.residenceId!==null&&this.occupancy(h.residenceId)+(ha.residenceId===hb.residenceId?0:1)<=this.capacity(h.residenceId))
      .sort((x,y)=>x.residenceId.localeCompare(y.residenceId));
    if(!options.length)return;
    const target=options[0],source=target===ha?hb:ha,mover=source.members[0];
    const eventId=`household:${partnership.id}:formed`;
    if(!this.record(eventId,'household_formed','Partners formed a shared household',partnership.partners,
      {householdId:target.id,previousHouseholdId:source.id,moverId:mover,fromResidenceId:source.residenceId,toResidenceId:target.residenceId,partnershipId:partnership.id}))return;
    source.status='merged';source.endedAt=nowTime(this.world);source.mergedInto=target.id;
    target.members.push(mover);target.lastMoveDay=day;
    target.cohabitation={partnershipId:partnership.id,moverId:mover,previousResidenceId:source.residenceId};
    this.byMember.set(mover,target);this.world.characters.find(c=>c.id===mover).home=target.residenceId;
    delete this.intent[partnership.id];
  }
  splitIfPossible(row){
    const c=row.cohabitation,day=this.world.time.day;
    if(!c||row.status!=='active'||day-row.lastMoveDay<6)return;
    const p=this.partnerships.active.get(c.partnershipId);
    if(p&&p.partners.every(id=>row.members.includes(id)))return;
    const mover=this.world.characters.find(person=>person.id===c.moverId);
    if(!mover||row.members.length<2)return;
    const options=Object.keys(this.world.buildings).filter(id=>this.isResidence(id)&&id!==row.residenceId&&this.occupancy(id)===0&&this.capacity(id)>=1).sort();
    const destination=options.includes(c.previousResidenceId)?c.previousResidenceId:options[0];
    if(!destination)return;
    const id=`household:${randomUUID()}`;
    if(!this.record(`household:${c.partnershipId}:split`,'household_relocated','A resident moved to a separate household',[mover.id],
      {householdId:id,previousHouseholdId:row.id,fromResidenceId:row.residenceId,toResidenceId:destination,partnershipId:c.partnershipId}))return;
    const next={id,status:'active',members:[mover.id],residenceId:destination,createdAt:nowTime(this.world),observedAt:nowTime(this.world),lastMoveDay:day};
    row.members=row.members.filter(member=>member!==mover.id);row.lastMoveDay=day;delete row.cohabitation;
    this.records.set(id,next);this.byMember.set(mover.id,next);mover.home=destination;
  }
  partnershipEnded(partnership){
    delete this.intent[partnership.id];
    const household=this.byMember.get(partnership.partners[0]);
    if(household?.cohabitation?.partnershipId===partnership.id)this.splitIfPossible(household);
  }
  placeUnassigned(row){
    const day=this.world.time.day;
    if(row.status!=='active'||row.residenceId!==null||row.members.length!==1||day-row.lastMoveDay<6)return;
    const person=this.world.characters.find(c=>c.id===row.members[0]);
    const destination=Object.keys(this.world.buildings).filter(id=>this.isResidence(id)&&this.occupancy(id)===0&&this.capacity(id)>=1).sort()[0];
    if(!person||!destination)return;
    const hash=createHash('sha256').update(row.id).digest('hex');
    if(!this.record(`household:${hash}:move:${day}`,'household_relocated','A resident moved into an available home',[person.id],
      {householdId:row.id,fromResidenceId:null,toResidenceId:destination}))return;
    row.residenceId=destination;row.lastMoveDay=day;person.home=destination;
  }
  syncPopulation(){
    const people=new Map(this.world.characters.map(person=>[person.id,person]));
    for(const row of this.records.values())if(row.status==='active'){
      const remaining=row.members.filter(id=>people.has(id));
      if(remaining.length!==row.members.length){
        for(const id of row.members)if(!people.has(id))this.byMember.delete(id);
        if(!remaining.length){row.status='inactive';row.endedAt=nowTime(this.world);delete row.cohabitation;}
        else {row.members=remaining;if(row.cohabitation&&!remaining.includes(row.cohabitation.moverId))delete row.cohabitation;}
      }
    }
    for(const person of people.values())if(!this.byMember.has(person.id)){
      const home=this.isResidence(person.home)?person.home:null;
      const existing=home&&[...this.records.values()].find(row=>row.status==='active'&&row.residenceId===home);
      if(existing&&this.occupancy(home)<this.capacity(home)){existing.members.push(person.id);this.byMember.set(person.id,existing);continue;}
      const residenceId=home&&!existing&&this.capacity(home)>0?home:null;
      const row={id:`household:${randomUUID()}`,status:'active',members:[person.id],residenceId,createdAt:nowTime(this.world),observedAt:nowTime(this.world),lastMoveDay:this.world.time.day};
      this.records.set(row.id,row);this.byMember.set(person.id,row);
    }
  }
  dayStarted(day){
    this.syncPopulation();
    for(const [id,value] of Object.entries(this.intent))if(day-value.lastDay>12||!this.partnerships.active.has(id))delete this.intent[id];
    for(const row of this.records.values())if(row.status==='active'){
      if(row.cohabitation)this.splitIfPossible(row);
      else if(row.residenceId===null)this.placeUnassigned(row);
    }
  }
  toJSON(){this.syncPopulation();return {version:1,records:[...this.records.values()],intent:this.intent};}
}
module.exports={Households,willingToShare};
