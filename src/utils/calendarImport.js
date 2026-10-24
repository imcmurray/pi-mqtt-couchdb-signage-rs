// Normalizes an uploaded court calendar (JSON) into the rows the TVs draw in a
// table layer: { courtroom, date: 'YYYY-MM-DD', time: 'HH:MM' | '', case_number,
// case_title, reason, movant }. Field names are matched loosely so exports from
// different systems load without editing.

const FIELD_ALIASES = {
  courtroom: ['courtroom', 'courtroomname', 'courtroomnumber', 'room', 'courtroomlocation', 'location'],
  date: ['date', 'hearingdate', 'scheduleddate', 'datetime', 'hearingdatetime', 'scheduledtime', 'start', 'starttime'],
  time: ['time', 'hearingtime'],
  case_number: ['casenumber', 'caseno', 'case', 'docketnumber'],
  case_title: ['casetitle', 'title', 'casename', 'debtor', 'debtorname', 'parties'],
  reason: ['reason', 'reasonforhearing', 'hearingreason', 'hearingmatter', 'matter', 'hearingtype', 'description'],
  movant: ['movant', 'movingparty', 'hearingmovingparty', 'attorney']
};

const normalizeKey = key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

// Accepts an array of hearings, or an object wrapping one (e.g. { hearings: [...] })
function extractRecords(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const list = Object.values(json).find(Array.isArray);
    if (list) return list;
  }
  return null;
}

function pickField(record, field) {
  const aliases = FIELD_ALIASES[field];
  for (const [key, value] of Object.entries(record)) {
    if (aliases.includes(normalizeKey(key)) && value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

// "9:00 AM", "9am", "09:00", "14:30" -> "HH:MM" (24h); '' when unparseable
function parseTime(value) {
  const match = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])\.?m?\.?$/i)
    || String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// "2026-10-23", "2026-10-23T09:00:00", "10/23/2026", "10/23/2026 9:00 AM" -> { date, time }
// Times are kept as written (courthouse local time), never shifted through UTC.
function parseDate(value) {
  const text = String(value).trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](.+))?$/);
  let date;
  let rest;
  if (match) {
    date = [match[1], match[2], match[3]];
    rest = match[4];
  } else if ((match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.+))?$/))) {
    date = [match[3], match[1], match[2]];
    rest = match[4];
  } else {
    return null;
  }
  const [year, month, day] = date.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = rest ? parseTime(rest.replace(/(Z|[+-]\d{2}:?\d{2})$/, '')) : '';
  return { date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, time };
}

function normalizeCalendar(json) {
  const records = extractRecords(json);
  if (!records) {
    return { rows: [], errors: ['Expected a JSON array of hearings, or an object containing one'] };
  }

  const rows = [];
  const errors = [];
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object') {
      errors.push(`Row ${index + 1}: not an object`);
      return;
    }
    const when = parseDate(pickField(record, 'date'));
    if (!when) {
      errors.push(`Row ${index + 1}: missing or unreadable hearing date`);
      return;
    }
    const time = parseTime(pickField(record, 'time')) || when.time;
    rows.push({
      courtroom: pickField(record, 'courtroom'),
      date: when.date,
      time,
      case_number: pickField(record, 'case_number'),
      case_title: pickField(record, 'case_title'),
      reason: pickField(record, 'reason'),
      movant: pickField(record, 'movant')
    });
  });

  rows.sort((a, b) =>
    a.date.localeCompare(b.date)
    || (a.time || '99:99').localeCompare(b.time || '99:99')
    || a.courtroom.localeCompare(b.courtroom, undefined, { numeric: true }));

  return { rows, errors };
}

// Today's date (YYYY-MM-DD) where the courthouse is; the server itself may run on UTC
function courthouseToday(timeZone = process.env.COURT_TIME_ZONE || 'America/Denver', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// A small example file for the upload screen, dated today so it shows straight away
function sampleCalendar(date = courthouseToday()) {
  return [
    { courtroom: 'Courtroom 341', date, time: '9:00 AM', case_number: '26-21345', case_title: 'In re Savanna G. Smith', reason: 'Motion for Relief from Stay', movant: 'First Utah Credit Union' },
    { courtroom: 'Courtroom 341', date, time: '9:30 AM', case_number: '26-20877', case_title: 'In re Andie Arave and McKenzie Atterton', reason: 'Confirmation Hearing (Chapter 13)', movant: 'Chapter 13 Trustee' },
    { courtroom: 'Courtroom 369', date, time: '10:00 AM', case_number: '25-24410', case_title: 'In re Wasatch Front Logistics, LLC', reason: 'Motion to Use Cash Collateral', movant: 'Debtor' },
    { courtroom: 'Courtroom 376', date, time: '1:30 PM', case_number: '26-20112', case_title: 'In re Jordan T. Reyes', reason: 'Motion to Redeem Property of the Estate', movant: 'Beutler, Derek' },
    { courtroom: 'Courtroom 369', date, time: '2:00 PM', case_number: '24-25901', case_title: 'Smith v. Granite Peak Lending', reason: 'Status Conference', movant: 'Plaintiff' }
  ];
}

module.exports = { normalizeCalendar, sampleCalendar, courthouseToday, parseDate, parseTime };
