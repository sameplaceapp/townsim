const {createHash}=require('node:crypto');
const {ageOnDate}=require('./aging');
const abbreviations=require('../../config/characters.json').traitAbbreviations;
const STAGES=['infant','child','teen','adult'];
const isAdult=c=>!c.lifecycle||c.lifecycle==='adult';
const isInfant=c=>c.lifecycle==='infant'||c.lifecycle==='dependent';
const isMinor=c=>!isAdult(c);
const hash=(id,salt)=>createHash('sha256').update(`${id}:${salt}`).digest().readUInt32BE(0);

class Development {
  constructor(world,calendar,history,configured,saved){
    this.world=world;this.calendar=calendar;this.history=history;
    const values=saved===undefined?{childAge:3,teenAge:13,adultAge:18,...configured}:saved;
    if(saved===undefined)for(const key of ['childAge','teenAge','adultAge']){
      const env='LIFECYCLE_'+key.replace(/[A-Z]/g,c=>'_'+c).toUpperCase();
      if(process.env[env]!==undefined){if(!process.env[env].trim())throw new Error(`Invalid lifecycle setting: ${env}`);values[key]=Number(process.env[env]);}
    }
    if(!values||saved!==undefined&&values.version!==1||!Number.isSafeInteger(values.childAge)||!Number.isSafeInteger(values.teenAge)||!Number.isSafeInteger(values.adultAge)||values.childAge<1||values.childAge>=values.teenAge||values.teenAge>=values.adultAge||values.adultAge<18)throw new Error('Invalid lifecycle age boundaries');
    this.boundaries={childAge:values.childAge,teenAge:values.teenAge,adultAge:values.adultAge};
    // Old worlds have adult residents without a lifecycle and newborns marked dependent.
    // Do not invent historical milestones when migrating an older save.
    for(const char of world.characters){
      if(!char.lifecycle){char.lifecycle='adult';continue;}
      if(char.lifecycle==='dependent')this.apply(char,this.stageFor(ageOnDate(char.birthDate,calendar.current())),true);
      else if(!STAGES.includes(char.lifecycle))throw new Error(`Invalid lifecycle for ${char.id}`);
      else if(char.lifecycle!=='adult'&&char.lifecycle!==this.stageFor(ageOnDate(char.birthDate,calendar.current())))throw new Error(`Inconsistent lifecycle for ${char.id}`);
    }
  }
  stageFor(age){const {childAge,teenAge,adultAge}=this.boundaries;return age>=adultAge?'adult':age>=teenAge?'teen':age>=childAge?'child':'infant';}
  developTrait(char,stage){
    const options=stage==='child'?['cheerful','kind','artistic','adventurous','practical']:['humble','cautious','artistic','adventurous','practical'];
    const interactions=Object.values(char.relationships||{}).reduce((n,r)=>n+(r.interactionCount||0),0);
    const choices=options.filter(trait=>!char.personality.includes(trait));
    if(choices.length&&char.personality.length<4)char.personality.push(choices[hash(char.id,`${stage}:${interactions}`)%choices.length]);
    char.personalityAbbr=char.personality.map(t=>abbreviations[t]||t.slice(0,3)).join('.');
    if(stage==='child'&&!char.interest)char.interest=['play','art','nature','music'][hash(char.id,'interest')%4];
    if(stage==='teen'&&!char.aspiration)char.aspiration=['helping others','creative work','exploring','practical skills'][hash(char.id,'aspiration')%4];
  }
  apply(char,stage,migrating=false){
    const previous=char.lifecycle;char.lifecycle=stage;
    if(stage==='child'||stage==='teen'){
      char.job='dependent';char.workplace=null;char.schedule={};
      if(previous==='infant'||previous==='dependent'){char.activity='idle';char.activityData={ticksRemaining:0};char.path=[];char.walking=false;}
      if(migrating&&stage==='teen')this.developTrait(char,'child');
      this.developTrait(char,stage);
    }else if(stage==='adult'&&previous!=='adult'&&previous!==undefined){
      if(migrating){this.developTrait(char,'child');this.developTrait(char,'teen');}
      char.job='unassigned';char.workplace=null;char.schedule={6:'wake_up',20:'go_home',22:'sleep'};
      char.activity='idle';char.activityData={ticksRemaining:0};char.path=[];char.walking=false;
    }
  }
  dayStarted(date){
    for(const char of this.world.characters){
      // Founders are already adults; only simulated dependents transition.
      if(isAdult(char))continue;
      const age=ageOnDate(char.birthDate,date),stage=this.stageFor(age);
      if(stage===char.lifecycle)continue;
      if(stage==='child'||stage==='adult')this.history.record({id:`lifecycle:${char.id}:${stage}`,type:'life_stage',
        description:stage==='child'?`${char.name} reached childhood`:`${char.name} reached adulthood`,
        entities:[{kind:'character',id:char.id}],metadata:{stage,age}});
      this.apply(char,stage);
    }
  }
  // A small set of safe household activities; children never use the adult LLM scheduler.
  schedule(char,hour,actions,interactions,drama){
    if(isInfant(char))return;
    if(hour===6){if(char.activity==='sleep'){char.activity='idle';char.activityData={ticksRemaining:0};}return;}
    if(hour===8||hour===14){
      const companions=this.world.characters.filter(c=>c.id!==char.id&&!isInfant(c)&&drama.canInteract(char,c));
      if(companions.length){const target=companions[hash(char.id,`${this.world.time.day}:${hour}`)%companions.length];
        actions.assignAction(char,{type:'chat',target:target.id});interactions.updateRelationship(char,target,'chat');char.addMemory(`chat.${target.id}.t${this.world.tick}`);return;}
    }
    if(hour===10){if(char.lifecycle==='teen'&&this.world.buildings.park)actions.assignAction(char,{type:'goto',target:'park',then:'play'});else actions.assignAction(char,{type:'play'});}
    else if(hour===12){actions.assignAction(char,{type:'goto',target:char.home,then:'eat'});}
    else if(hour===17){actions.assignAction(char,{type:'goto',target:char.home,then:'relax'});}
    else if(hour===22){actions.assignAction(char,{type:'goto',target:char.home,then:'sleep'});}
  }
  toJSON(){return {version:1,...this.boundaries};}
}
module.exports={Development,isAdult,isInfant,isMinor};
