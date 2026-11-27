// Disposable fixture; births are explicitly delivered only in this test world.
const fs=require('fs'),path=require('path');
const {StateManager}=require('../server/persistence/stateManager');
const {SimulationEngine}=require('../server/simulation/engine');
const base=require('../config/default.json');
const config={...base,reproduction:{...base.reproduction,dailyChance:0}};
const [mode,file]=process.argv.slice(2);
if(!['create','inspect'].includes(mode)||!file||!path.isAbsolute(file)){console.error('Usage: node scripts/personality-demo.js create|inspect /absolute/path/to/fixture.json');process.exit(1);}
if(mode==='create'&&(fs.existsSync(file)||fs.existsSync(file+'.bak'))){console.error('Fixture exists; refusing to overwrite');process.exit(1);}
if(mode==='inspect'&&!fs.existsSync(file)){console.error('Fixture does not exist');process.exit(1);}
process.env.LLM_DAILY_LIMIT='0';delete process.env.LLM_API_KEY_FILE;
const engine=new SimulationEngine(config,null,()=>0,new StateManager(file));
if(mode==='create'){
 const [a,b]=engine.world.characters;
 a.personality=['cheerful','artistic'];a.personalityAbbr='chf.art';b.personality=['kind','cautious'];b.personalityAbbr='knd.cts';
 const ha=engine.households.byMember.get(a.id),hb=engine.households.byMember.get(b.id);
 hb.status='merged';hb.endedAt={...engine.world.time};hb.mergedInto=ha.id;ha.members.push(b.id);engine.households.byMember.set(b.id,ha);b.home=ha.residenceId;
 engine.world.buildings[a.home].capacity=8;
 for(let i=1;i<=5;i++){
  const p={id:`pregnancy:00000000-0000-4000-8000-00000000000${i}`,parents:[a.id,b.id],gestationalParent:a.id,startedDay:1,dueDay:2,residenceId:a.home};
  engine.reproduction.pending.push(p);engine.reproduction.deliver(p);
 }
 engine.save();console.log('Created five controlled births in a disposable world.');
}
const births=engine.history.query({type:'birth'}).events;
for(const event of births){
 const data=event.metadata.personalityInheritance;if(!data)continue;
 const child=engine.world.characters.find(c=>c.id===event.metadata.childId);
 console.log(`${child.name} (${child.id}): ${data.sources.map(s=>`${s.trait} [${s.parentIds.join(' + ')||'variation'}]`).join(', ')}`);
}
console.log('Parent traits:',engine.world.characters.slice(0,2).map(p=>`${p.name}: ${p.personality.join(', ')}`).join('; '));
