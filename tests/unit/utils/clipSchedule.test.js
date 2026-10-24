const { isScheduleActive } = require('../../../src/utils/clipSchedule');

// Friday 2026-10-23 14:05 in Salt Lake City (MDT, UTC-6)
const friday2pm = new Date('2026-10-23T20:05:00Z');
const tz = 'America/Denver';

describe('isScheduleActive', () => {
  it('is open without a schedule', () => {
    expect(isScheduleActive(null, friday2pm, tz)).toBe(true);
    expect(isScheduleActive({ days_of_week: [] }, friday2pm, tz)).toBe(true);
  });

  it('uses courthouse local time for daily windows', () => {
    expect(isScheduleActive({ daily_start: '07:30', daily_end: '17:00' }, friday2pm, tz)).toBe(true);
    expect(isScheduleActive({ daily_start: '03:00', daily_end: '04:00' }, friday2pm, tz)).toBe(false);
    // 20:05 UTC would be inside 20:00-21:00 if the server's UTC clock were used
    expect(isScheduleActive({ daily_start: '20:00', daily_end: '21:00' }, friday2pm, tz)).toBe(false);
  });

  it('handles windows that wrap midnight', () => {
    expect(isScheduleActive({ daily_start: '22:00', daily_end: '06:00' }, new Date('2026-10-24T05:30:00Z'), tz)).toBe(true); // 11:30 PM
    expect(isScheduleActive({ daily_start: '22:00', daily_end: '06:00' }, friday2pm, tz)).toBe(false);
  });

  it('checks weekdays (0 = Sunday) and date bounds', () => {
    expect(isScheduleActive({ days_of_week: [1, 2, 3, 4, 5] }, friday2pm, tz)).toBe(true);
    expect(isScheduleActive({ days_of_week: [0, 6] }, friday2pm, tz)).toBe(false);
    expect(isScheduleActive({ end_time: '2026-10-23T20:00:00Z' }, friday2pm, tz)).toBe(false);
    expect(isScheduleActive({ start_time: '2026-10-23T21:00:00Z' }, friday2pm, tz)).toBe(false);
  });
});
