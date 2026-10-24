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

  {
    preset_id: 'court-calendar',
    name: 'Court Calendar',
    description: "Today's hearings from the uploaded calendar (JSON): time, courtroom, case number, case title, reason and movant; pages automatically",
    is_builtin: true,
    category: 'court',
    tags: ['courthouse', 'calendar', 'hearings', 'data', 'scene-starter'],
    layers: [
      block('Calendar Background', { x: 0, y: 0, width: 1920, height: 1080 }, NAVY),
      text('Calendar Title', "📅 Today's Court Calendar", { x: 0, y: 0, width: 1920, height: 120 },
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
            filter: 'today',
            columns: [
              { field: 'time', label: 'Time', width: 150 },
              { field: 'courtroom', label: 'Courtroom', width: 230 },
              { field: 'case_number', label: 'Case Number', width: 220 },
              { field: 'case_title', label: 'Case Title', width: 520 },
              { field: 'reason', label: 'Reason for Hearing', width: 470 },
              { field: 'movant', label: 'Movant', width: 250 }
            ],
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
            emptyText: 'No hearings are scheduled for today.'
          }
        },
        position: { x: 40, y: 150, width: 1840, height: 850 },
        priority: 20,
        visible: true,
        opacity: 1.0,
        tags: ['calendar-table']
      },
      text('Calendar Footer', 'ℹ️ Hearing times are subject to change. Please check in with the courtroom deputy.', { x: 0, y: 1020, width: 1920, height: 60 },
        { background: BAR, size: 26, color: SOFT_WHITE })
    ]
  }
];
