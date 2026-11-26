const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/js/welcome.js'),'utf8');
function fixture() {
  const els={};
  const make=()=>({hidden:true,textContent:'',children:[],addEventListener(){},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;}});
  const document={getElementById(id){return els[id] ||= make();},createElement:make};
  let value=null, fail=false, requests=[];
  const localStorage={getItem(){return value;},setItem(k,v){if(fail)throw new Error('unavailable');value=v;}};
  const fetch=async()=>{const result=requests.shift();if(result instanceof Error)throw result;return result;};
  const performance={getEntriesByType:()=>[{type:'navigate'}]};
  const Welcome=vm.runInNewContext(`${source}\nWelcomeBack`,{document,localStorage,fetch,performance});
  return {welcome:new Welcome(()=>{}),els,requests,performance,storage:()=>value,setFailure:v=>{fail=v;}};
}
const marker=(eventCount=0,lastEventId=null,minute=0,worldId='one')=>({worldId,eventCount,lastEventId,time:{day:1,hour:6,minute}});
const ok=result=>({ok:true,json:async()=>result});

test('first visit, prepared report, dismiss and reload update the marker once',async()=>{
  const f=fixture();
  f.requests.push(ok({mode:'first',marker:marker()})); await f.welcome.prepare();
  assert.equal(f.els['welcome-back'].hidden,true);
  f.requests.push(ok({mode:'return',marker:marker(1,'evt',5),elapsedMinutes:5,count:1,
    events:[{description:'Friendship established',time:{day:1},entities:[{kind:'character',id:'alice'}]}]}));
  await f.welcome.prepare();
  assert.equal(f.els['welcome-back'].hidden,false);
  assert.equal(JSON.parse(f.storage()).lastEventId,'evt');
  f.welcome.dismiss(); f.performance.getEntriesByType=()=>[{type:'reload'}];
  f.requests.push(ok({mode:'return',marker:marker(1,'evt',6),elapsedMinutes:1,count:0,events:[]}));
  await f.welcome.prepare(); assert.equal(f.els['welcome-back'].hidden,true);
  f.welcome.observe(marker(1,'evt',7));
  assert.equal(JSON.parse(f.storage()).time.minute,7);
  f.welcome.observe(marker(0,null,6));
  assert.equal(JSON.parse(f.storage()).lastEventId,'evt');
});

test('failed preparation preserves prior marker, reconnects avoid repeats, and world changes reset',async()=>{
  const f=fixture();
  f.requests.push(ok({mode:'first',marker:marker()})); await f.welcome.prepare();
  const before=f.storage();
  f.welcome.suspend(); f.requests.push(new Error('offline')); await f.welcome.prepare(true);
  f.welcome.observe(marker(1,'unseen',2)); assert.equal(f.storage(),before);
  f.requests.push(ok({mode:'return',marker:marker(0,null,3),elapsedMinutes:3,count:0,events:[]}));
  await f.welcome.prepare(true); assert.equal(f.els['welcome-back'].hidden,true);
  f.requests.push(ok({mode:'first',marker:marker(0,null,0,'other')})); await f.welcome.prepare();
  assert.equal(JSON.parse(f.storage()).worldId,'other');
  f.setFailure(true); f.welcome.observe(marker(1,'evt',1,'other'));
  assert.equal(JSON.parse(f.storage()).lastEventId,null);
});

test('an in-flight report cannot advance the visit marker after disconnection',async()=>{
  const f=fixture();
  f.requests.push(ok({mode:'first',marker:marker()})); await f.welcome.prepare();
  const before=f.storage();
  let release;
  f.requests.push({ok:true,json:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.welcome.prepare();
  await new Promise(resolve => setImmediate(resolve));
  f.welcome.suspend();
  release({mode:'return',marker:marker(1,'unseen',1),elapsedMinutes:1,count:1,events:[]});
  await pending;
  f.welcome.observe(marker(1,'unseen',1));
  assert.equal(f.storage(),before);
});
