/**
 * Courthouse templates: full-screen layouts built from layer collections.
 * Text may use live tokens the TV fills in itself: {time} {date} {day}
 * {short_date} {year}, and from the weather data set {weather} {temp}
 * {conditions} {location}. The calendar table reads the court_calendar data
 * set (uploaded as JSON in Layer Control).
 */

const NAVY = 'rgba(12, 30, 66, 0.94)';
const GOLD = 'rgba(201, 162, 39, 1)';
const WHITE = 'rgba(255, 255, 255, 1)';
const SOFT_WHITE = 'rgba(226, 232, 240, 1)';
const BAR = 'rgba(0, 0, 0, 0.35)';
const CLEAR = 'rgba(0, 0, 0, 0)';

function text(name, value, position, style = {}) {
  return {
    name,
    layer_type: 'DataRow',
    content: {
      text: value,
      backgroundColor: style.background || CLEAR,
      textColor: style.color || WHITE,
      fontSize: style.size || 36,
      fontFamily: style.font || 'Liberation Sans',
      fontWeight: style.weight || 'normal',
      alignment: style.align || 'center',
      verticalAlignment: style.valign || 'middle'
    },
    position,
    priority: style.priority || 20,
    visible: true,
    opacity: 1.0,
    tags: style.tags || []
  };
}

const block = (name, position, color, priority = 10) =>
  text(name, '', position, { background: color, priority, tags: ['background'] });

const card = (name, body, x, y) =>
  text(name, body, { x, y, width: 880, height: 360 }, {
    background: 'rgba(255, 255, 255, 0.08)', size: 34, align: 'left', valign: 'top', tags: ['info-card']
  });

// Calendar table columns: short fields get a fixed width, text fields share the rest
// (same rule as the table editor in public/js/multilayer.js)
const FIXED_WIDTHS = { time: 150, date: 210, courtroom: 180, case_number: 200, status: 170 };
const TEXT_WEIGHTS = { judge: 1.25, case_title: 2, reason: 1.75, movant: 1.25, trustee: 1.25 };
function tableColumns(columns, width = 1840) {
  const fixed = columns.reduce((sum, [field]) => sum + (FIXED_WIDTHS[field] || 0), 0);
  const weights = columns.reduce((sum, [field]) => sum + (FIXED_WIDTHS[field] ? 0 : TEXT_WEIGHTS[field]), 0);
  const result = columns.map(([field, label]) => ({
    field,
    label,
    width: FIXED_WIDTHS[field] || Math.round((TEXT_WEIGHTS[field] / weights) * (width - fixed))
  }));
  result[result.length - 1].width += width - result.reduce((sum, c) => sum + c.width, 0);
  return result;
}

// A full-screen calendar scene: title and clock, gold rule, hearings table, footer
function calendarScene({ preset_id, name, description, title, columns, filter = 'today', match = null, emptyText,
  footer = 'ℹ️ Hearing times are subject to change. Please check in with the courtroom deputy.', tags = [] }) {
  return {
    preset_id,
    name,
    description,
    is_builtin: true,
    category: 'court',
    tags: ['courthouse', 'calendar', 'hearings', 'data', 'scene-starter', ...tags],
    layers: [
      block('Calendar Background', { x: 0, y: 0, width: 1920, height: 1080 }, NAVY),
      text('Calendar Title', title, { x: 0, y: 0, width: 1920, height: 120 },
        { background: 'rgba(0, 0, 0, 0.25)', font: 'Liberation Serif', weight: 'bold', size: 56, align: 'left' }),
      text('Calendar Clock', '{day}, {short_date}  ·  {time}', { x: 960, y: 0, width: 960, height: 120 },
        { size: 34, align: 'right', priority: 21 }),
      block('Calendar Rule', { x: 0, y: 120, width: 1920, height: 6 }, GOLD, 21),
      {
        name: 'Hearings Table',
        layer_type: 'DataRow',
        content: {
          text: '',
          backgroundColor: CLEAR,
          textColor: WHITE,
          fontSize: 28,
          fontFamily: 'Liberation Sans',
          alignment: 'left',
          table: {
            dataset: 'court_calendar',
            filter,
            ...(match ? { match } : {}),
            columns: tableColumns(columns),
            rowHeight: 76,
            fontSize: 28,
            headerFontSize: 26,
            fontFamily: 'Liberation Sans',
            headerBackground: GOLD,
            headerTextColor: 'rgba(15, 23, 42, 1)',
            rowBackground: 'rgba(255, 255, 255, 0.05)',
            altRowBackground: 'rgba(255, 255, 255, 0.12)',
            textColor: WHITE,
            pageSeconds: 12,
            emptyText
          }
        },
        position: { x: 40, y: 150, width: 1840, height: 850 },
        priority: 20,
        visible: true,
        opacity: 1.0,
        tags: ['calendar-table']
      },
      text('Calendar Footer', footer, { x: 0, y: 1020, width: 1920, height: 60 },
        { background: BAR, size: 26, color: SOFT_WHITE })
    ]
  };
}

module.exports = [
  {
    preset_id: 'courthouse-welcome',
    name: 'Courthouse Welcome',
    description: 'Full-screen welcome: building name, courts, live clock, date and weather',
    is_builtin: true,
    category: 'court',
    tags: ['courthouse', 'welcome', 'clock', 'weather', 'scene-starter'],
    layers: [
      block('Welcome Background', { x: 0, y: 0, width: 1920, height: 1080 }, NAVY),
      text('Building Name', '🏛️  FRANK E. MOSS UNITED STATES COURTHOUSE', { x: 0, y: 70, width: 1920, height: 90 },
        { font: 'Liberation Serif', weight: 'bold', size: 46, color: GOLD }),
      text('Welcome', 'Welcome', { x: 0, y: 240, width: 1920, height: 220 },
        { font: 'Liberation Serif', weight: 'bold', size: 150 }),
      text('Courts', 'United States Bankruptcy Court  ·  District of Utah', { x: 0, y: 470, width: 1920, height: 70 },
        { size: 36, color: SOFT_WHITE }),
      block('Gold Rule', { x: 760, y: 580, width: 400, height: 6 }, GOLD, 20),
      text('Clock', '{time}', { x: 0, y: 640, width: 1920, height: 150 },
        { font: 'DejaVu Sans', weight: 'bold', size: 110 }),
      text('Date', '{date}', { x: 0, y: 790, width: 1920, height: 70 }, { size: 40, color: SOFT_WHITE }),
      text('Weather Bar', '{location}  ·  {weather_icon} {weather}', { x: 0, y: 960, width: 1920, height: 120 },
        { background: BAR, size: 36 })
    ]
  },

  {
    preset_id: 'courthouse-information',
    name: 'Courthouse Information',
    description: 'Full-screen information panels: hours, security, clerk offices, courtroom rules; live date, time and weather',
    is_builtin: true,
    category: 'info',
    tags: ['courthouse', 'information', 'clock', 'weather', 'scene-starter'],
    layers: [
      block('Information Background', { x: 0, y: 0, width: 1920, height: 1080 }, NAVY),
      text('Information Header', 'Courthouse Information', { x: 0, y: 0, width: 1920, height: 130 },
        { background: 'rgba(0, 0, 0, 0.25)', font: 'Liberation Serif', weight: 'bold', size: 64 }),
      block('Header Rule', { x: 0, y: 130, width: 1920, height: 6 }, GOLD, 21),
      card('Building Hours', '🕗 BUILDING HOURS\nMonday – Friday\n8:00 AM – 5:00 PM\nClosed on federal holidays', 60, 190),
      card('Security Screening', '🛡️ SECURITY SCREENING\nAll visitors pass through security.\nPlease have a photo ID ready.\nWeapons and sharp objects are not permitted.', 980, 190),
      card("Clerk's Offices", "📋 CLERK'S OFFICE\nBankruptcy Court Clerk's Office\nAsk a Court Security Officer for directions.", 60, 580),
      card('In the Courtroom', '⚖️ IN THE COURTROOM\n📵 Please silence all electronic devices.\nPhotography and recording are prohibited.\nProper attire is expected.', 980, 580),
      text('Information Footer', '{day}, {short_date}   ·   {time}   ·   {weather_icon} {weather}', { x: 0, y: 980, width: 1920, height: 100 },
        { background: BAR, size: 34 })
    ]
  },

  calendarScene({
    preset_id: 'court-calendar',
    name: 'Court Calendar',
    description: "Today's hearings from the court calendar (live CouchDB or uploaded JSON): time, courtroom, judge, case, matter and movant; pages automatically",
    title: "📅 Today's Court Calendar",
    columns: [['time', 'Time'], ['courtroom', 'Courtroom'], ['judge', 'Judge'], ['case_number', 'Case Number'],
      ['case_title', 'Case Title'], ['reason', 'Matter'], ['movant', 'Movant']],
    emptyText: 'No hearings are scheduled for today.'
  }),
  // One scene per way the court's _design/calendar slices the calendar
  calendarScene({
    preset_id: 'courtroom-docket',
    name: 'Courtroom Docket',
    description: "Outside a courtroom: today's hearings in one courtroom (like by_courtroom_date), with status. Set the courtroom in the table's \"Only where\"",
    title: '🚪 Courtroom North · Today',
    match: { field: 'courtroom', value: 'North' },
    columns: [['time', 'Time'], ['judge', 'Judge'], ['case_number', 'Case Number'], ['case_title', 'Case Title'],
      ['reason', 'Matter'], ['status', 'Status']],
    emptyText: 'No hearings are scheduled in this courtroom today.',
    footer: '📵 Please silence your phone before entering the courtroom.',
    tags: ['courtroom']
  }),
  calendarScene({
    preset_id: 'judge-calendar',
    name: "Judge's Calendar",
    description: "One judge's hearings from today through the next two weeks (like by_judge_date). Set the judge in the table's \"Only where\"",
    title: '⚖️ Judge Anderson · Upcoming Hearings',
    filter: 'upcoming',
    match: { field: 'judge', value: 'Judge Anderson' },
    columns: [['date', 'Date'], ['time', 'Time'], ['courtroom', 'Courtroom'], ['case_number', 'Case Number'],
      ['case_title', 'Case Title'], ['reason', 'Matter']],
    emptyText: 'No upcoming hearings for this judge.',
    tags: ['judge']
  }),
  calendarScene({
    preset_id: 'trustee-calendar',
    name: 'Trustee Calendar',
    description: "Today's hearings with a trustee (like by_trustee), e.g. the Chapter 13 confirmation calendar. Set the trustee in the table's \"Only where\"",
    title: '📋 Chapter 13 Trustee · Today',
    match: { field: 'trustee', value: 'Chapter 13 Trustee' },
    columns: [['time', 'Time'], ['courtroom', 'Courtroom'], ['judge', 'Judge'], ['case_number', 'Case Number'],
      ['case_title', 'Case Title'], ['reason', 'Matter']],
    emptyText: 'No trustee hearings are scheduled for today.',
    tags: ['trustee']
  }),
  calendarScene({
    preset_id: 'hearing-status-board',
    name: 'Hearing Status Board',
    description: "Today's hearings with their status (scheduled, heard, continued, cancelled), like by_status; updates as the calendar changes",
    title: '🔔 Hearing Status · Today',
    columns: [['time', 'Time'], ['courtroom', 'Courtroom'], ['case_number', 'Case Number'], ['case_title', 'Case Title'],
      ['reason', 'Matter'], ['status', 'Status']],
    emptyText: 'No hearings are scheduled for today.',
    footer: 'ℹ️ Continued and cancelled hearings stay listed for reference. Ask the clerk\'s office about new dates.',
    tags: ['status']
  }),
  calendarScene({
    preset_id: 'upcoming-hearings',
    name: 'Upcoming Hearings',
    description: 'Every hearing from today through the next two weeks, by date and time (like by_date_courtroom_time)',
    title: '🗓️ Upcoming Hearings',
    filter: 'upcoming',
    columns: [['date', 'Date'], ['time', 'Time'], ['courtroom', 'Courtroom'], ['judge', 'Judge'],
      ['case_number', 'Case Number'], ['case_title', 'Case Title'], ['reason', 'Matter']],
    emptyText: 'No upcoming hearings.',
    tags: ['upcoming']
  })
];
