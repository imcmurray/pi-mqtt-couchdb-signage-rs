// Normalizes a court calendar into the rows the TVs draw in a table layer:
// { hearing_id, date: 'YYYY-MM-DD', time: 'HH:MM' | '', courtroom, judge,
//   case_number, case_title, reason, movant, trustee, status }.
//
// Accepts the court's CouchDB hearing documents (type "hearing", start_time,
// matter, ...) in the shapes CouchDB returns them, the _design/calendar
// nested_calendar list output, and loosely named exports from other systems.

const FIELD_ALIASES = {
  courtroom: ['courtroom', 'courtroomname', 'courtroomnumber', 'room', 'courtroomlocation', 'location'],
  date: ['date', 'hearingdate', 'scheduleddate', 'datetime', 'hearingdatetime', 'scheduledtime'],
  time: ['starttime', 'time', 'hearingtime', 'start'],
  judge: ['judge', 'judgename', 'presidingjudge'],
  case_number: ['casenumber', 'caseno', 'case', 'docketnumber', 'number'],
  case_title: ['casetitle', 'title', 'casename', 'debtor', 'debtorname', 'parties'],
  reason: ['matter', 'reason', 'reasonforhearing', 'hearingreason', 'hearingmatter', 'hearingtype', 'description'],
  movant: ['movant', 'movingparty', 'hearingmovingparty', 'attorney'],
  trustee: ['trustee', 'trusteename'],
  status: ['status', 'hearingstatus']
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{1,2}:\d{2}/;

const normalizeKey = key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

// A CouchDB view row's key holds fields the value leaves out. Which ones depends
// on the view in _design/calendar; tell them apart by where the date sits and what
// the value already carries.
function viewRowToRecord(key, value) {
  const record = { ...value };
  const dateAt = key.findIndex(k => typeof k === 'string' && DATE_PATTERN.test(k));
  if (dateAt < 0) return record;
  record.date = key[dateAt];
  if (typeof key[dateAt + 1] === 'string' && TIME_PATTERN.test(key[dateAt + 1])) record.start_time = key[dateAt + 1];

  if (dateAt === 0) {
    // by_date_courtroom_time: [date, courtroom, start_time, judge, case_number]
    // (by_status: [date, status, courtroom, start_time])
    if (TIME_PATTERN.test(key[2] || '')) {
      [record.courtroom, record.start_time, record.judge, record.case_number] =
        [key[1], key[2], key[3] ?? record.judge, key[4] ?? record.case_number];
    } else {
      [record.status, record.courtroom, record.start_time] = [key[1], key[2], key[3]];
    }
  } else if (dateAt === 1) {
    // by_judge_date [judge, date, time, courtroom], by_courtroom_date [courtroom, date, time, judge],
    // by_case / by_movant / by_trustee [case_number|movant|trustee, date, time]
    if ('courtroom' in value && !('judge' in value)) {
      record.judge = key[0];
      record.courtroom = record.courtroom ?? key[3];
    } else if ('judge' in value && !('courtroom' in value)) {
      record.courtroom = key[0];
      record.judge = record.judge ?? key[3];
    } else if (!('case_number' in value)) {
      record.case_number = key[0];
    } else if (!('movant' in value)) {
      record.movant = key[0];
    } else if (!('trustee' in value)) {
      record.trustee = key[0];
    }
  }
  return record;
}

// nested_calendar list output: sessions → slots → judges → cases → matters
function flattenNested(calendar) {
  const records = [];
  for (const session of calendar.sessions || []) {
    for (const slot of session.slots || []) {
      for (const judge of slot.judges || []) {
        for (const entry of judge.cases || []) {
          for (const matter of entry.matters || []) {
            records.push({
              ...matter,
              date: calendar.date,
              courtroom: session.courtroom,
              start_time: slot.start_time,
              judge: judge.judge,
              case_number: entry.case?.number,
              case_title: entry.case?.title
            });
          }
        }
      }
    }
  }
  return records;
}

// The hearing records in whatever shape was provided
function extractRecords(json) {
  if (json && !Array.isArray(json) && Array.isArray(json.sessions)) return flattenNested(json);
  let list = Array.isArray(json) ? json : null;
  if (!list && json && typeof json === 'object') {
    list = json.docs || json.rows || Object.values(json).find(Array.isArray) || null;
  }
  if (!list) return null;
  return list.map(item => {
    if (item && typeof item === 'object') {
      if (item.doc && typeof item.doc === 'object') return item.doc;                           // _all_docs / include_docs
      if (Array.isArray(item.key) && item.value && typeof item.value === 'object') return viewRowToRecord(item.key, item.value);
    }
    return item;
  });
}

function pickField(record, field) {
  const aliases = FIELD_ALIASES[field];
  // Prefer the earliest alias (e.g. start_time over a loosely named "time")
  for (const alias of aliases) {
    for (const [key, value] of Object.entries(record)) {
      if (normalizeKey(key) === alias && value !== null && value !== undefined && typeof value !== 'object' && String(value).trim() !== '') {
        return String(value).trim();
      }
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

function compareRows(a, b) {
  return a.date.localeCompare(b.date)
    || (a.time || '99:99').localeCompare(b.time || '99:99')
    || a.courtroom.localeCompare(b.courtroom, undefined, { numeric: true })
    || a.case_number.localeCompare(b.case_number, undefined, { numeric: true });
}

// Records that are clearly not hearings (other document types in the database)
const isOtherDocument = record => record.type && record.type !== 'hearing';

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
    if (isOtherDocument(record) || String(record._id || '').startsWith('_design/')) return;
    const when = parseDate(pickField(record, 'date'));
    if (!when) {
      errors.push(`Row ${index + 1}: missing or unreadable hearing date`);
      return;
    }
    rows.push({
      hearing_id: String(record._id || record.id || ''),
      date: when.date,
      time: parseTime(pickField(record, 'time')) || when.time,
      courtroom: pickField(record, 'courtroom'),
      judge: pickField(record, 'judge'),
      case_number: pickField(record, 'case_number'),
      case_title: pickField(record, 'case_title'),
      reason: pickField(record, 'reason'),
      movant: pickField(record, 'movant'),
      trustee: pickField(record, 'trustee'),
      status: pickField(record, 'status')
    });
  });

  rows.sort(compareRows);
  return { rows, errors };
}

// Today's date (YYYY-MM-DD) where the courthouse is; the server itself may run on UTC
function courthouseToday(timeZone = process.env.COURT_TIME_ZONE || 'America/Denver', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// An example file for the upload screen, in the court's hearing document format,
// dated today so it shows straight away
function sampleCalendar(date = courthouseToday()) {
  const hearing = (courtroom, start_time, judge, case_number, case_title, matter, movant, trustee, status = 'scheduled') => ({
    _id: `hearing:h-${date.replace(/-/g, '')}-${courtroom[0].toLowerCase()}-${start_time.replace(':', '')}-${case_number.slice(-3)}`,
    type: 'hearing',
    date,
    timezone: 'America/Denver',
    courtroom,
    start_time,
    judge,
    case_number,
    case_title,
    matter,
    movant,
    trustee,
    status
  });
  return [
    hearing('North', '09:00', 'Judge Anderson', '26-21345', 'In re Savanna G. Smith', 'Motion for Relief from Stay', 'First Utah Credit Union', 'Chapter 13 Trustee'),
    hearing('North', '09:30', 'Judge Anderson', '26-20877', 'In re Andie Arave and McKenzie Atterton', 'Confirmation Hearing (Chapter 13)', null, 'Chapter 13 Trustee'),
    hearing('South', '10:00', 'Judge Parker', '25-24410', 'In re Wasatch Front Logistics, LLC', 'Motion to Use Cash Collateral', 'Debtor', null),
    hearing('South', '13:30', 'Judge Parker', '26-20112', 'In re Jordan T. Reyes', 'Motion to Redeem Property of the Estate', 'Beutler, Derek', 'Chapter 7 Trustee'),
    hearing('South', '14:00', 'Judge Thomson', '24-25901', 'Smith v. Granite Peak Lending', 'Status Conference', 'Plaintiff', null, 'continued')
  ];
}

module.exports = { normalizeCalendar, sampleCalendar, courthouseToday, parseDate, parseTime, compareRows };
