const test=require('node:test'),assert=require('node:assert/strict');
const {inheritPersonality,TRAITS}=require('../server/simulation/personalityInheritance');
const traitSet=new Set(TRAITS);
const first={id:'parent_a',personality:['cheerful','hardworking','artistic'],mood:'angry',moodHistory:['sad']};
const second={id:'parent_b',personality:['kind','cautious','humble'],mood:'sad'};
const same=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
test('seeded inheritance is valid, uses both parents, varies, and never clones either parent',()=>{
 const observed=new Set();let both=0,variants=0;
 for(let i=0;i<1000;i++){
  const id=`child:${i}`,result=inheritPersonality(id,[first,second]);
  assert.deepEqual(result,inheritPersonality(id,[first,second]));
  assert.ok(result.traits.length>=2&&result.traits.length<=3);assert.equal(new Set(result.traits).size,result.traits.length);
  assert.ok(result.traits.every(t=>traitSet.has(t)));assert.ok(!same(result.traits,first.personality));assert.ok(!same(result.traits,second.personality));
  assert.ok(!result.traits.includes('angry')&&!result.traits.includes('sad'));
  if(result.traits.some(t=>first.personality.includes(t))&&result.traits.some(t=>second.personality.includes(t)))both++;
  if(result.sources.some(s=>!s.parentIds.length))variants++;
  observed.add(result.traits.slice().sort().join(','));
 }
 assert.ok(both>900,`both parents influenced ${both} of 1000`);assert.ok(variants>100&&variants<400,`variation occurred ${variants} times`);assert.ok(observed.size>20);
 assert.deepEqual(first.personality,['cheerful','hardworking','artistic']);assert.deepEqual(second.personality,['kind','cautious','humble']);
});
test('missing or invalid parent traits use the available parent and safe bounded variation',()=>{
 const one=inheritPersonality('single-parent',[first,null]);assert.ok(one.traits.some(t=>first.personality.includes(t)));
 assert.deepEqual(one.parents,[{id:'parent_a',traits:first.personality}]);assert.ok(!same(one.traits,first.personality));
 const none=inheritPersonality('no-parents',[null,undefined]);assert.equal(none.parents.length,0);assert.ok(none.traits.length>=2&&none.traits.length<=3);assert.ok(none.traits.every(t=>traitSet.has(t)));
 const invalid=inheritPersonality('bad-traits',[{id:'x',personality:['sad',null,33,'kind','kind']},{}]);assert.deepEqual(invalid.parents,[{id:'x',traits:['kind']}]);assert.ok(invalid.traits.includes('kind'));
});
test('incompatible parental traits do not create contradictory combinations',()=>{
 const a={id:'a',personality:['cheerful','hardworking','adventurous']},b={id:'b',personality:['grumpy','lazy','cautious']};
 for(let i=0;i<500;i++){
  const result=inheritPersonality(`conflict:${i}`,[a,b]);
  for(const [x,y] of [['cheerful','grumpy'],['hardworking','lazy'],['adventurous','cautious']])assert.ok(!(result.traits.includes(x)&&result.traits.includes(y)));
  assert.ok(!same(result.traits,a.personality)&&!same(result.traits,b.personality));
 }
});
test('inheritance is inexpensive at population scale',()=>{
 const start=performance.now();for(let i=0;i<10000;i++)inheritPersonality(`performance:${i}`,[first,second]);
 // Deliberately generous to avoid tying correctness to a particular host's speed.
 assert.ok(performance.now()-start<10000,'10,000 births exceeded the generous test budget');
});
