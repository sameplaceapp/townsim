const {createHash,randomUUID}=require('node:crypto');
const {ageOnDate}=require('./aging');
const {related}=require('./partnerships');

const MARRIAGE_WAIT=12, SEPARATION_WAIT=6, MARRIAGE_INTERACTIONS=3;
const timeCopy=t=>({day:t.day,hour:t.hour,minute:t.minute});
const validTime=t=>t&&Number.isSafeInteger(t.day)&&t.day>=1&&Number.isInteger(t.hour)&&t.hour>=0&&t.hour<24&&Number.isInteger(t.minute)&&t.minute>=0&&t.minute<60;
const minute=t=>((t.day-1)*24+t.hour)*60+t.minute;
function willingToMarry(a,b,pastCount) {
  const ids=[a.id,b.id].sort();
  const traits=[...(a.personality||[]),...(b.personality||[])];
  const threshold=Math.max(15,Math.min(70,40+traits.filter(t=>t==='kind').length*4-traits.filter(t=>t==='cautious').length*6-Math.min(pastCount,3)*5));
  return parseInt(createHash('sha256').update(JSON.stringify([ids,pastCount])).digest('hex').slice(0,8),16)%100<threshold;
}
function strong(a,b) {
  const r=a.relationships?.[b.id],s=b.relationships?.[a.id];
  return !!r&&!!s&&[r,s].every(x=>x.affection>=7&&x.trust>=6&&x.attraction>=4&&x.interactionCount>=8);
}
function severe(a,b) {
  const r=a.relationships?.[b.id],s=b.relationships?.[a.id];
  return !!r&&!!s&&[r,s].some(x=>x.affection<=2||x.trust<=2.5);
}
class Marriages {
  constructor(world,calendar,history,partnerships,saved) {
    this.world=world;this.calendar=calendar;this.history=history;this.partnerships=partnerships;
    this.records=[];this.current=new Map();this.past=new Map();this.intent=Object.create(null);
    if(saved===undefined)return;
    if(!saved||saved.version!==1||!Array.isArray(saved.records)||!saved.intent||typeof saved.intent!=='object'||Array.isArray(saved.intent))throw new Error('Invalid marriage state');
    const ids=new Set();
    const checkEvent=(eventId,type,record,at)=>{
      const event=history.get(eventId);
      if(!event||event.type!==type||event.metadata.marriageId!==record.id||
         minute(event.time)!==minute(at)||
         !record.spouses.every(id=>event.entities.some(entity=>entity.kind==='character'&&entity.id===id)))throw new Error('Missing or inconsistent marriage history');
    };
    for(const record of saved.records) {
      if(!record||typeof record.id!=='string'||!record.id||ids.has(record.id)||typeof record.partnershipId!=='string'||
        !Array.isArray(record.spouses)||record.spouses.length!==2||record.spouses.some(id=>typeof id!=='string'||!id)||record.spouses[0]===record.spouses[1]||
        !['married','separated','divorced'].includes(record.status)||!validTime(record.marriedAt)||
        typeof record.marriageEventId!=='string'||!Array.isArray(record.separations)||minute(record.marriedAt)>minute(world.time))throw new Error('Invalid marriage record');
      ids.add(record.id);
      checkEvent(record.marriageEventId,'marriage',record,record.marriedAt);
      let prior=minute(record.marriedAt);
      for(const [index,separation] of record.separations.entries()) {
        if(!separation||!validTime(separation.at)||minute(separation.at)<prior||minute(separation.at)>minute(world.time)||typeof separation.eventId!=='string')throw new Error('Invalid marital separation');
        prior=minute(separation.at);
        checkEvent(separation.eventId,'separation',record,separation.at);
        if(index<record.separations.length-1&&separation.reconciledAt===undefined)throw new Error('Unresolved prior separation');
        if(separation.reconciledAt!==undefined){if(!validTime(separation.reconciledAt)||minute(separation.reconciledAt)<prior||minute(separation.reconciledAt)>minute(world.time)||typeof separation.reconciliationEventId!=='string')throw new Error('Invalid marital reconciliation');checkEvent(separation.reconciliationEventId,'relationship_changed',record,separation.reconciledAt);prior=minute(separation.reconciledAt);}
      }
      const last=record.separations.at(-1);
      if((record.status==='separated'&&(!last||last.reconciledAt))||
         (record.status==='married'&&last&&!last.reconciledAt)||
         (record.status==='divorced'&&(!last||last.reconciledAt||!validTime(record.divorcedAt)||minute(record.divorcedAt)<prior||minute(record.divorcedAt)>minute(world.time)||typeof record.divorceEventId!=='string'))||
         (record.status!=='divorced'&&(record.divorcedAt!==undefined||record.divorceEventId!==undefined)))throw new Error('Inconsistent marriage status');
      if(record.status==='divorced')checkEvent(record.divorceEventId,'divorce',record,record.divorcedAt);
      if(record.divorceStrain!==undefined&&(record.status!=='separated'||!record.divorceStrain||
        !Number.isSafeInteger(record.divorceStrain.days)||record.divorceStrain.days<1||
        !Number.isSafeInteger(record.divorceStrain.lastDay)||record.divorceStrain.lastDay<last.at.day||
        record.divorceStrain.lastDay>world.time.day))throw new Error('Invalid divorce strain');
      const copy=structuredClone(record);this.records.push(copy);
      for(const id of copy.spouses) {
        if(copy.status==='divorced') {const list=this.past.get(id)||[];list.push(copy);this.past.set(id,list);}
        else {if(this.current.has(id))throw new Error('Conflicting marriages');this.current.set(id,copy);}
      }
      if(copy.status!=='divorced') {
        const p=partnerships.active.get(copy.partnershipId);
        if(!p||p.startedDay>copy.marriedAt.day||p.partners.length!==2||!p.partners.every(id=>copy.spouses.includes(id)))throw new Error('Marriage does not match active partnership');
      } else if(partnerships.active.has(copy.partnershipId)) throw new Error('Divorced marriage still has its original partnership');
    }
    for(const list of this.past.values()) list.sort((a,b)=>minute(a.divorcedAt)-minute(b.divorcedAt));
    for(const [id,value] of Object.entries(saved.intent)) {
      if(!partnerships.active.has(id)||partnerships.active.get(id).partners.some(person=>this.current.has(person))||!value||!Number.isSafeInteger(value.firstDay)||value.firstDay<1||
         !Number.isSafeInteger(value.lastDay)||value.lastDay<value.firstDay||value.lastDay>world.time.day||
         !Number.isSafeInteger(value.days)||value.days<1||value.days>value.lastDay-value.firstDay+1||
         !Array.isArray(value.initiators)||value.initiators.length<1||value.initiators.length>2||
         new Set(value.initiators).size!==value.initiators.length||value.initiators.some(x=>!partnerships.active.get(id).partners.includes(x)))throw new Error('Invalid marriage intent');
      this.intent[id]={...value,initiators:[...value.initiators]};
    }
  }
  info(id) {
    const current=this.current.get(id),previous=this.past.get(id)||[];
    return {maritalStatus:current?.status||(previous.length?'divorced':'never_married'),
      spouseId:current?current.spouses.find(other=>other!==id):null,
      previousSpouses:previous.slice(-5).map(r=>({id:r.spouses.find(other=>other!==id),marriedAt:r.marriedAt,divorcedAt:r.divorcedAt}))};
  }
  record(id,type,description,spouses,metadata) {
    try {this.history.record({id,type,description,entities:spouses.map(id=>({kind:'character',id})),metadata});return true;}
    catch(err){console.error('Unable to record marriage transition:',err.message);return false;}
  }
  onInteraction(a,b,action) {
    if(!a||!b||a.id===b.id)return;
    const record=this.current.get(a.id);
    if(record) {
      if(this.current.get(b.id)!==record)return;
      if(record.status==='separated')this.considerResolution(record,a,b,action);
      return;
    }
    if(this.current.has(b.id))return;
    const p=this.partnerships.byCharacter.get(a.id);
    if(!p||this.partnerships.byCharacter.get(b.id)!==p)return;
    const day=this.world.time.day;
    if(day-p.startedDay<MARRIAGE_WAIT||!a.birthDate||!b.birthDate||
       ageOnDate(a.birthDate,this.calendar.current())<18||ageOnDate(b.birthDate,this.calendar.current())<18||
       related(a,b,this.world.characters)||!strong(a,b)) {delete this.intent[p.id];return;}
    if(!['flirt','confess','comfort','gift'].includes(action))return;
    const pastCount=(this.past.get(a.id)?.length||0)+(this.past.get(b.id)?.length||0);
    if(!willingToMarry(a,b,pastCount))return;
    let intent=this.intent[p.id];
    if(!intent||day-intent.lastDay>12)intent=this.intent[p.id]={firstDay:day,lastDay:day,days:1,initiators:[a.id]};
    else {if(!intent.initiators.includes(a.id))intent.initiators.push(a.id);if(day>intent.lastDay){intent.days++;intent.lastDay=day;}}
    if(intent.days<MARRIAGE_INTERACTIONS||intent.initiators.length<2||day-intent.firstDay<2)return;
    const id=randomUUID(), eventId=`marriage:${id}:formed`, spouses=[a.id,b.id].sort(), remarriage=pastCount>0;
    if(!this.record(eventId,'marriage',remarriage?'A remarriage began':'A marriage began',spouses,{milestone:remarriage?'remarriage':'marriage',marriageId:id,partnershipId:p.id}))return;
    const marriage={id,partnershipId:p.id,spouses,status:'married',marriedAt:timeCopy(this.world.time),marriageEventId:eventId,separations:[]};
    this.records.push(marriage);for(const spouse of spouses)this.current.set(spouse,marriage);delete this.intent[p.id];
  }
  separate(partnership) {
    const marriage=this.current.get(partnership.partners[0]);
    if(!marriage||marriage.partnershipId!==partnership.id)return false;
    if(marriage.status==='separated')return true;
    const eventId=`marriage:${marriage.id}:separation:${marriage.separations.length+1}`;
    if(!this.record(eventId,'separation','A married couple separated',marriage.spouses,{milestone:'marital_separation',marriageId:marriage.id}))return true;
    marriage.separations.push({at:timeCopy(this.world.time),eventId});marriage.status='separated';delete marriage.divorceStrain;
    return true;
  }
  considerResolution(record,a,b,action) {
    const separation=record.separations.at(-1),day=this.world.time.day;
    if(!severe(a,b)) {
      delete record.divorceStrain;
      if(['comfort','forgive','apologize'].includes(action)&&strong(a,b)) {
        const eventId=`marriage:${record.id}:reconciliation:${record.separations.length}`;
        if(this.record(eventId,'relationship_changed','A separated couple reconciled',record.spouses,{milestone:'marital_reconciliation',marriageId:record.id})) {
          separation.reconciledAt=timeCopy(this.world.time);separation.reconciliationEventId=eventId;record.status='married';
        }
      }
      return;
    }
    if(day-separation.at.day<SEPARATION_WAIT||!['argue','confront'].includes(action))return;
    const strain=record.divorceStrain;
    if(!strain||day-strain.lastDay>12)record.divorceStrain={days:1,lastDay:day};
    else if(day>strain.lastDay){strain.days++;strain.lastDay=day;}
    if(record.divorceStrain.days<3)return;
    const p=this.partnerships.active.get(record.partnershipId);
    if(!p)return;
    const eventId=`marriage:${record.id}:divorced`;
    if(!this.record(eventId,'divorce','A marriage ended in divorce',record.spouses,{milestone:'divorce',marriageId:record.id,partnershipId:p.id}))return;
    record.status='divorced';record.divorcedAt=timeCopy(this.world.time);record.divorceEventId=eventId;delete record.divorceStrain;
    for(const id of record.spouses){this.current.delete(id);const list=this.past.get(id)||[];list.push(record);this.past.set(id,list);}
    this.partnerships.endForDivorce(p,day);
  }
  prune(day) {for(const [id,value] of Object.entries(this.intent))if(day-value.lastDay>12||!this.partnerships.active.has(id))delete this.intent[id];}
  forgetPartnership(id) { delete this.intent[id]; }
  toJSON(){return {version:1,records:this.records,intent:this.intent};}
}
module.exports={Marriages,willingToMarry,strong};
