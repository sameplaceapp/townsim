const SYSTEM_PROMPT = `Town life sim. For each [Q], give [A] with same number.
Format: [A<n>]ACT:<action>,<target>|SAY:<speech max 15w>|THINK:<thought max 10w>|EMO:<emotion>
ACT required. SAY,THINK,EMO optional. target optional for solo actions.
Actions: goto(<building>),chat(<person>),greet(<person>),flirt(<person>),argue(<person>),gift(<person>),confess(<person>),comfort(<person>),confront(<person>),apologize(<person>),forgive(<person>),gossip(<person>),work,eat,sleep,drink,pray,relax,shop,play,idle,think,wander,cry,laugh,dance,sing,celebrate,stormOff,craft,fish,garden,explore,stargaze,perform
EMO values: happy,sad,angry,anxious,hopeful,jealous,guilty,proud,lonely,infatuated,grateful,bitter,excited,content,fearful
Query: name,job,traits|needs(h=hunger,e=energy,s=social,f=fun)|location|near:person(rel)|phase|mem:events|sched:next|drama:context
Needs 0-10(10=critical). Rels show aff(affection),tru(trust),att(attraction). Phase:dw,mr,af,ev,nt.
CREATE DRAMA. Characters should have strong opinions, make bold choices, flirt, argue, confront, gossip, confess feelings. Avoid bland/safe choices. If someone has a crush, they should act on it. If someone is angry, they should confront. Make things interesting.
Stay in character. Consider personality, needs, relationships, time of day, drama context.`;

const PHASE_ABBR = {
  dawn: 'dw',
  morning: 'mr',
  afternoon: 'af',
  evening: 'ev',
  night: 'nt'
};

const REL_TAG_ABBR = {
  best_friend: 'bf',
  close_friend: 'cf',
  friend: 'fr',
  acquaintance: 'aq',
  tense: 'tn',
  hostile: 'hs',
  colleague: 'cl',
  supplier: 'sp',
  trade_partner: 'tp',
  neighbor: 'nb',
  crush: 'cr',
  lover: 'lv',
  flirtatious: 'fl'
};

class PromptBuilder {
  constructor() {
    this.dramaEngine = null; // Set externally
  }

  buildBatch(decisions, world) {
    const queries = decisions.map((d, i) => {
      return this.buildQuery(i + 1, d.character, world, d.reason);
    });
    return {
      system: SYSTEM_PROMPT,
      user: queries.join('\n')
    };
  }

  buildQuery(index, char, world, reason) {
    const parts = [];

    // Name, job, traits
    parts.push(`${char.name.toLowerCase()},${char.job},${char.personalityAbbr}`);

    // Needs
    parts.push(char.getNeedsCompressed());

    // Location
    parts.push(char.location || 'outdoors');

    // Nearby characters with multi-dimensional relationships
    const nearby = world.getCharactersNear(char.pos.x, char.pos.y, 3)
      .filter(c => c.id !== char.id && c.activity !== 'sleep');
    if (nearby.length > 0) {
      const nearStr = nearby.map(n => {
        const rel = char.relationships[n.id];
        if (rel) {
          const tagAbbr = REL_TAG_ABBR[rel.tag] || rel.tag.slice(0, 2);
          // Include key relationship dimensions
          const aff = Math.round(rel.affection || rel.level || 5);
          const att = Math.round(rel.attraction || 0);
          if (att > 2) {
            return `${n.name.toLowerCase()}(${tagAbbr},aff${aff},att${att})`;
          }
          return `${n.name.toLowerCase()}(${tagAbbr}${aff})`;
        }
        return n.name.toLowerCase();
      }).join(',');
      parts.push(`near:${nearStr}`);
    } else {
      parts.push('near:none');
    }

    // Time phase
    parts.push(PHASE_ABBR[world.phase] || world.phase);

    // Recent memory (last 5)
    const mem = char.recentMemory.slice(-5);
    if (mem.length > 0) {
      parts.push(`mem:${mem.join(',')}`);
    } else {
      parts.push('mem:none');
    }

    // Schedule
    const nextSched = this.getNextSchedule(char, world.time.hour);
    parts.push(`sched:${nextSched || 'free'}`);

    // Drama context from drama engine
    if (this.dramaEngine) {
      const dramaContext = this.dramaEngine.getDramaContext(char);
      if (dramaContext) {
        parts.push(`drama:${dramaContext}`);
      }
    }

    // Mood/emotion if present
    if (char.mood) {
      parts.push(`mood:${char.mood}`);
    }

    return `[Q${index}]${parts.join('|')}`;
  }

  getNextSchedule(char, currentHour) {
    const hours = Object.keys(char.schedule).map(Number).sort((a, b) => a - b);
    for (const h of hours) {
      if (h > currentHour) {
        return `${char.schedule[h]}@${h}`;
      }
    }
    return null;
  }

  getSystemPrompt() {
    return SYSTEM_PROMPT;
  }
}

module.exports = { PromptBuilder };
