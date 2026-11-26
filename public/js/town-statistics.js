class TownStatisticsPanel {
  constructor(onOpen) {
    this.onOpen=onOpen;
    this.panel=document.getElementById('town-stats-panel');
    this.openButton=document.getElementById('town-stats-open');
    this.status=document.getElementById('town-stats-status');
    this.chart=document.getElementById('town-stats-chart');
    this.empty=document.getElementById('town-stats-empty');
    this.older=document.getElementById('town-stats-older');
    this.newer=document.getElementById('town-stats-newer');
    this.before=null; this.previous=[]; this.generation=0;
    this.openButton.addEventListener('click',()=>this.open());
    document.getElementById('town-stats-close').addEventListener('click',()=>this.close());
    document.getElementById('town-stats-refresh').addEventListener('click',()=>this.load(this.before));
    this.older.addEventListener('click',()=>{ if(this.nextBefore !== null) this.load(this.nextBefore,'older'); });
    this.newer.addEventListener('click',()=>{ if(this.previous.length) this.load(this.previous.at(-1),'newer'); });
    this.panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();this.close();}});
  }
  open() { if(this.onOpen) this.onOpen(); this.panel.hidden=false; this.openButton.setAttribute('aria-expanded','true'); this.previous=[]; this.load(null); }
  close(restoreFocus=true) { this.panel.hidden=true; this.openButton.setAttribute('aria-expanded','false'); this.generation++; this.controller?.abort(); if(restoreFocus) this.openButton.focus(); }
  async load(before, direction) {
    const generation=++this.generation;
    this.controller?.abort(); this.controller=new AbortController();
    this.older.disabled=true; this.newer.disabled=true;
    this.status.textContent='Reading town records…';
    const params=new URLSearchParams({limit:'50'}); if(before !== null) params.set('beforeDay',before);
    try {
      const response=await fetch(`/api/town-statistics?${params}`,{signal:this.controller.signal});
      if(!response.ok) throw new Error('Unable to read town statistics.');
      const data=await response.json(); if(generation!==this.generation) return;
      if(direction==='older') this.previous.push(this.before);
      if(direction==='newer') this.previous.pop();
      this.before=before; this.nextBefore=data.nextBeforeDay;
      const t=data.time;
      this.status.textContent=`As of Day ${t.day} · ${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')} · Refresh for current values`;
      document.getElementById('town-stats-population').textContent=data.population;
      document.getElementById('town-stats-buildings').textContent=data.buildings;
      document.getElementById('town-stats-events').textContent=data.historyCount;
      const categories=document.getElementById('town-stats-categories');
      const entries=Object.entries(data.eventCounts).sort((a,b)=>a[0].localeCompare(b[0]));
      categories.replaceChildren(...entries.map(([name,count])=>{const item=document.createElement('li');item.textContent=`${name.replace(/_/g,' ')}: ${count}`;return item;}));
      if(!entries.length){const item=document.createElement('li');item.textContent='No historical events recorded yet.';categories.append(item);}
      this.renderChart(data.observations);
    } catch(err) {
      if(generation===this.generation && err.name!=='AbortError') this.status.textContent='Unable to read town statistics. Try Refresh.';
    } finally {
      if(generation===this.generation){this.older.disabled=this.nextBefore == null;this.newer.disabled=!this.previous.length;}
    }
  }
  renderChart(observations) {
    this.chart.replaceChildren();
    this.chart.hidden=!observations.length; this.empty.hidden=!!observations.length;
    const list=document.getElementById('town-stats-observations');
    list.replaceChildren(...observations.map(row=>{const li=document.createElement('li');li.textContent=`Day ${row.day}: ${row.population} residents`;return li;}));
    if(!observations.length) return;
    const ns='http://www.w3.org/2000/svg';
    const add=(name,attrs,text)=>{const el=document.createElementNS(ns,name); for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,String(value)); if(text!==undefined) el.textContent=text; this.chart.append(el);return el;};
    const first=observations[0].day, last=observations.at(-1).day;
    const low=Math.min(...observations.map(o=>o.population)), high=Math.max(...observations.map(o=>o.population));
    add('line',{x1:42,y1:160,x2:625,y2:160,class:'stats-axis'});
    add('line',{x1:42,y1:20,x2:42,y2:160,class:'stats-axis'});
    add('text',{x:43,y:184,class:'stats-label'},`Day ${first}`);
    if(last!==first) add('text',{x:625,y:184,'text-anchor':'end',class:'stats-label'},`Day ${last}`);
    add('text',{x:35,y:24,'text-anchor':'end',class:'stats-label'},String(high));
    if(low!==high) add('text',{x:35,y:160,'text-anchor':'end',class:'stats-label'},String(low));
    for(const row of observations){
      const x=first===last ? 333 : 42+(row.day-first)/(last-first)*583;
      const y=low===high ? 90 : 155-(row.population-low)/(high-low)*130;
      const circle=add('circle',{cx:x,cy:y,r:4,class:'stats-dot'});
      const title=document.createElementNS(ns,'title'); title.textContent=`Day ${row.day}: ${row.population} residents`; circle.append(title);
    }
  }
}
