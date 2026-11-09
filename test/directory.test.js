const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/ui.js'), 'utf8');
const UI = vm.runInNewContext(`${source}\nUI`);
function directory() {
  const ui = Object.create(UI.prototype);
  ui.charRosterEl = {innerHTML:'', querySelectorAll:()=>[]};
  ui.charCountEl = {textContent:''};
  ui.charDetailEl = {style:{display:'none'}};
  ui.directoryControlsEl = {};
  ui.directorySearchEl = {value:''};
  ui.directoryOccupationEl = {value:'',innerHTML:''};
  ui.directoryCountEl = {textContent:''};
  ui.nameCollator = new Intl.Collator(undefined,{sensitivity:'base',numeric:true});
  return ui;
}
const resident = (id,name,job) => ({id,name,job,activity:'idle',activityData:{},inside:false});

test('directory combines name and occupation, sorts, and updates with population changes', () => {
  const ui=directory();
  let chars=[resident('bob','Bob','baker'),resident('alice','Alice','artist'),resident('albert','Albert','baker')];
  ui.updateCharacterList(chars);
  assert.equal(ui.directoryCountEl.textContent,'3 of 3 residents');
  assert(ui.charRosterEl.innerHTML.indexOf('Albert') < ui.charRosterEl.innerHTML.indexOf('Alice'));
  assert(ui.charRosterEl.innerHTML.indexOf('Alice') < ui.charRosterEl.innerHTML.indexOf('Bob'));
  ui.directorySearchEl.value='AL'; ui.directoryOccupationEl.value='baker';
  ui.updateCharacterList(chars);
  assert.equal(ui.directoryCountEl.textContent,'1 of 3 residents');
  assert.match(ui.charRosterEl.innerHTML,/Albert/);
  assert.doesNotMatch(ui.charRosterEl.innerHTML,/Alice|Bob/);
  chars=[...chars,resident('alexa','Alexa','baker')];
  ui.updateCharacterList(chars);
  assert.equal(ui.directoryCountEl.textContent,'2 of 4 residents');
  chars=chars.filter(c=>c.id!=='albert');
  ui.updateCharacterList(chars);
  assert.equal(ui.directoryCountEl.textContent,'1 of 3 residents');
  assert.doesNotMatch(ui.charRosterEl.innerHTML,/Albert/);
  ui.directorySearchEl.value='missing'; ui.updateCharacterList(chars);
  assert.match(ui.charRosterEl.innerHTML,/No residents match/);
});

test('a departed selected resident closes the profile and clears follow', () => {
  const ui=directory();
  let followed='alice';
  ui.selectedCharId='alice';
  ui.followingCharId='alice';
  ui.charDetailEl.style.display='block';
  ui.onFollowCallback=id=>{followed=id};
  ui.updateCharacterList([resident('bob','Bob','baker')]);
  assert.equal(ui.selectedCharId,null);
  assert.equal(ui.followingCharId,null);
  assert.equal(followed,null);
  assert.equal(ui.charDetailEl.style.display,'none');
  assert.match(ui.charRosterEl.innerHTML,/Bob/);
});
