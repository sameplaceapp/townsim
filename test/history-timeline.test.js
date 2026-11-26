const test = require('node:test');
const assert = require('node:assert/strict');
const { WorldHistory } = require('../server/history/worldHistory');
const express = require('express');

function fixture() {
  const world = {time:{day:1,hour:6,minute:0}};
  const history = new WorldHistory(world);
  for (let i=0; i<75; i++) {
    world.time = {day:1+Math.floor(i/10), hour:6, minute:i%10};
    history.record({id:`test:${i}`,type:i%2?'conflict':'relationship_changed',description:`Event ${i}`,
      entities:[{kind:'character',id:i%3?'alice':'bob'}]});
  }
  return {world,history};
}

test('reverse cursor pages remain ordered when events arrive and filters reach beyond the first page', () => {
  const {world,history}=fixture();
  const first=history.query({order:'desc',limit:10});
  assert.deepEqual(first.events.map(e=>e.id),Array.from({length:10},(_,i)=>`test:${74-i}`));
  world.time={day:9,hour:6,minute:0};
  history.record({id:'new',type:'conflict',description:'New event',entities:[]});
  history.record({id:'newer-same-minute',type:'conflict',description:'Another event',entities:[]});
  assert.deepEqual(history.query({order:'desc',limit:2}).events.map(e=>e.id),['newer-same-minute','new']);
  const second=history.query({order:'desc',limit:10,before:first.nextBefore});
  assert.deepEqual(second.events.map(e=>e.id),Array.from({length:10},(_,i)=>`test:${64-i}`));
  const filtered=history.query({order:'desc',type:'conflict',entity:'bob',kind:'character',fromDay:2,toDay:3,limit:25});
  assert.deepEqual(filtered.events.map(e=>e.id),['test:27','test:21','test:15']);
  assert.throws(()=>history.query({order:'desc',before:-1}),/Invalid/);
  assert.throws(()=>history.query({order:'desc',fromDay:3,toDay:2}),/Invalid/);
  assert.equal(history.query({limit:1}).events[0].id,'test:0');
});

test('history endpoint accepts reverse cursors and validates date and cursor input', async () => {
  const {history}=fixture(); const app=express(); app.set('engine',{history});
  app.use('/api',require('../server/api/routes'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
    const base=`http://127.0.0.1:${server.address().port}/api/history`;
    const r=await fetch(`${base}?order=desc&limit=2&fromDay=2&toDay=2`);
    assert.equal(r.status,200); const page=await r.json();
    assert.deepEqual(page.events.map(e=>e.id),['test:19','test:18']);
    const next=await (await fetch(`${base}?order=desc&limit=2&fromDay=2&toDay=2&before=${page.nextBefore}`)).json();
    assert.deepEqual(next.events.map(e=>e.id),['test:17','test:16']);
    for(const suffix of ['?order=bad','?order=desc&before=-1','?order=desc&fromDay=3&toDay=2','?order=asc&before=2','?fromDay=x']) {
      assert.equal((await fetch(base+suffix)).status,400);
    }
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
