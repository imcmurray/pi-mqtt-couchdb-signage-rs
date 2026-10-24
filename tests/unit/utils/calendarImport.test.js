const { normalizeCalendar, parseDate, parseTime, sampleCalendar, courthouseToday } = require('../../../src/utils/calendarImport');

describe('calendarImport', () => {
  describe('parseTime', () => {
    it.each([
      ['9:00 AM', '09:00'],
      ['9am', '09:00'],
      ['12:15 pm', '12:15'],
      ['12:00 AM', '00:00'],
      ['1:30 P.M.', '13:30'],
      ['14:30', '14:30'],
      ['14:30:00', '14:30']
    ])('reads %s as %s', (input, expected) => {
      expect(parseTime(input)).toBe(expected);
    });

    it('rejects nonsense', () => {
      expect(parseTime('soon')).toBe('');
      expect(parseTime('25:00')).toBe('');
    });
  });

  describe('parseDate', () => {
    it('keeps local wall-clock time from ISO strings', () => {
      expect(parseDate('2026-10-23T09:00:00')).toEqual({ date: '2026-10-23', time: '09:00' });
      expect(parseDate('2026-10-23T09:00:00-06:00')).toEqual({ date: '2026-10-23', time: '09:00' });
    });

    it('reads US dates with an optional time', () => {
      expect(parseDate('10/23/2026')).toEqual({ date: '2026-10-23', time: '' });
      expect(parseDate('10/23/2026 1:30 PM')).toEqual({ date: '2026-10-23', time: '13:30' });
    });

    it('rejects unreadable dates', () => {
      expect(parseDate('next Tuesday')).toBeNull();
      expect(parseDate('2026-13-01')).toBeNull();
    });
  });

  describe('courthouseToday', () => {
    it("uses the courthouse's date, not the server's UTC date", () => {
      // 6:38 PM in Salt Lake City is already the next day in UTC
      const evening = new Date('2026-10-24T00:38:00Z');
      expect(courthouseToday('America/Denver', evening)).toBe('2026-10-23');
      expect(courthouseToday('UTC', evening)).toBe('2026-10-24');
    });
  });

  describe('normalizeCalendar', () => {
    it('maps loosely named fields and sorts by date, time, courtroom', () => {
      const { rows, errors } = normalizeCalendar({
        hearings: [
          { 'Courtroom Name': 'Courtroom 369', 'Hearing Date': '2026-10-23', Time: '2:00 PM', 'Case Number': '24-1', 'Case Title': 'B', 'Reason for Hearing': 'Status', Movant: 'Plaintiff' },
          { court_room: 'Courtroom 341', scheduled_time: '2026-10-23T09:00:00', case_no: '26-2', title: 'A', hearing_matter: 'Motion', hearing_moving_party: 'Beutler, Derek' }
        ]
      });

      expect(errors).toEqual([]);
      expect(rows).toEqual([
        { courtroom: 'Courtroom 341', date: '2026-10-23', time: '09:00', case_number: '26-2', case_title: 'A', reason: 'Motion', movant: 'Beutler, Derek' },
        { courtroom: 'Courtroom 369', date: '2026-10-23', time: '14:00', case_number: '24-1', case_title: 'B', reason: 'Status', movant: 'Plaintiff' }
      ]);
    });

    it('skips rows without a usable date and reports them', () => {
      const { rows, errors } = normalizeCalendar([{ case_number: '1' }, { date: '2026-10-23', case_number: '2' }]);
      expect(rows.map(r => r.case_number)).toEqual(['2']);
      expect(errors).toEqual(['Row 1: missing or unreadable hearing date']);
    });

    it('rejects input that is not a list of hearings', () => {
      expect(normalizeCalendar('hello').errors[0]).toMatch(/Expected a JSON array/);
    });

    it('accepts its own sample file', () => {
      const { rows, errors } = normalizeCalendar(sampleCalendar('2026-10-23'));
      expect(errors).toEqual([]);
      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({ date: '2026-10-23', time: '09:00' });
    });
  });
});
