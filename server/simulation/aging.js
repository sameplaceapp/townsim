const { createHash } = require('node:crypto');

function ageOnDate(birthDate, date) {
  if (!birthDate || !Number.isSafeInteger(birthDate.year) || !Number.isSafeInteger(birthDate.dayOfYear) ||
      birthDate.dayOfYear < 1 || birthDate.dayOfYear > date.daysPerYear) throw new Error('Invalid character birth date');
  const age = date.year - birthDate.year - (date.dayOfYear < birthDate.dayOfYear ? 1 : 0);
  if (!Number.isSafeInteger(age) || age < 0) throw new Error('Character birth date is in the future or out of range');
  return age;
}

// Existing ages are converted once; assigned values are deterministic for a given ID and saved calendar.
function migrateBirthDates(characters, calendar) {
  const date = calendar.current();
  const updates = characters.map(character => {
    const digest = createHash('sha256').update(character.id).digest();
    const legacyAge = character.age;
    if (legacyAge !== undefined && (!Number.isSafeInteger(legacyAge) || legacyAge < 0)) {
      throw new Error(`Invalid existing age for character ${character.id}`);
    }
    const legacyBirthday = character.birthday;
    if (legacyBirthday !== undefined && (!Number.isSafeInteger(legacyBirthday) || legacyBirthday < 1 || legacyBirthday > date.daysPerYear)) {
      throw new Error(`Invalid existing birthday for character ${character.id}`);
    }
    let birthDate = character.birthDate;
    if (birthDate === undefined) {
      const birthday = legacyBirthday ?? Number(digest.readBigUInt64BE(0) % BigInt(date.daysPerYear)) + 1;
      const age = legacyAge ?? 23 + digest.readUInt16BE(8) % 38;
      birthDate = { year: date.year - age - (date.dayOfYear < birthday ? 1 : 0), dayOfYear: birthday };
    }
    const age = ageOnDate(birthDate, date);
    if ((legacyAge !== undefined && legacyAge !== age) ||
        (legacyBirthday !== undefined && legacyBirthday !== birthDate.dayOfYear)) {
      throw new Error(`Conflicting existing age information for character ${character.id}`);
    }
    return { character, birthDate: { year: birthDate.year, dayOfYear: birthDate.dayOfYear } };
  });
  for (const {character, birthDate} of updates) {
    character.birthDate = birthDate;
    delete character.age;
    delete character.birthday;
  }
}

function recordBirthdayMilestones(characters, integration, date) {
  for (const character of characters) {
    if (!character.birthDate || character.birthDate.dayOfYear !== date.dayOfYear) continue;
    const age = ageOnDate(character.birthDate, date);
    if (age === 0 || age % 10 !== 0) continue;
    const id = createHash('sha256').update(character.id).digest('hex');
    integration.record({id:`birthday:${id}:${age}`, type:'birthday_milestone',
      description:`Reached age ${age}`, entities:[{kind:'character',id:character.id}],
      metadata:{age, birthdayDayOfYear:date.dayOfYear}});
  }
}

module.exports = { ageOnDate, migrateBirthDates, recordBirthdayMilestones };
