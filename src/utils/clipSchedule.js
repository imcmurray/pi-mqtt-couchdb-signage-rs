// Whether a clip's schedule window is open, in the courthouse's time zone.
// Same rules as pi-slideshow-rs image_schedule.rs: optional start/end instants,
// allowed weekdays (0 = Sunday), and a daily HH:MM window that may wrap midnight.

function localParts(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = value => {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

function isScheduleActive(schedule, now = new Date(), timeZone = process.env.COURT_TIME_ZONE || 'America/Denver') {
  if (!schedule) return true;
  if (schedule.start_time && now < new Date(schedule.start_time)) return false;
  if (schedule.end_time && now >= new Date(schedule.end_time)) return false;

  const { weekday, minutes } = localParts(now, timeZone);
  const days = schedule.days_of_week || [];
  if (days.length && !days.includes(weekday)) return false;

  const start = toMinutes(schedule.daily_start);
  const end = toMinutes(schedule.daily_end);
  if (start !== null && end !== null) {
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }
  if (start !== null) return minutes >= start;
  if (end !== null) return minutes < end;
  return true;
}

module.exports = { isScheduleActive };
