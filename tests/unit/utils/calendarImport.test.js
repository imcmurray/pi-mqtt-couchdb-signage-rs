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
      expect(rows.map(r => [r.courtroom, r.date, r.time, r.case_number, r.case_title, r.reason, r.movant])).toEqual([
        ['Courtroom 341', '2026-10-23', '09:00', '26-2', 'A', 'Motion', 'Beutler, Derek'],
        ['Courtroom 369', '2026-10-23', '14:00', '24-1', 'B', 'Status', 'Plaintiff']
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

  // Real responses from a CouchDB with the court's _design/calendar (tests/fixtures/calendar)
  describe('court hearing documents from CouchDB', () => {
    const fixture = name => require(`../../fixtures/calendar/${name}.json`);
    const summary = rows => rows.map(r => [r.date, r.time, r.courtroom, r.judge, r.case_number, r.reason, r.movant, r.trustee, r.status]);

    const today = normalizeCalendar(fixture('by_date_courtroom_time'));

    it('reads the by_date_courtroom_time view, taking courtroom/time/judge from the key', () => {
      expect(today.errors).toEqual([]);
      expect(today.rows).toHaveLength(8);
      expect(today.rows[0]).toEqual({
        hearing_id: 'hearing:h-20261025-n-0900-3451',
        date: '2026-10-25',
        time: '09:00',
        courtroom: 'North',
        judge: 'Judge Anderson',
        case_number: '26-21345',
        case_title: 'In re Savanna G. Smith',
        reason: 'Motion for Relief from Stay',
        movant: 'First Utah Credit Union',
        trustee: 'Chapter 13 Trustee',
        status: 'heard'
      });
      // Sorted by time across courtrooms, not by courtroom like the view key
      expect(today.rows.map(r => r.time)).toEqual(['09:00', '09:00', '09:00', '09:30', '10:30', '11:00', '13:30', '14:00']);
    });

    it.each(['find', 'nested_calendar'])('reads %s output the same way', name => {
      const { rows, errors } = normalizeCalendar(fixture(name));
      expect(errors).toEqual([]);
      expect(summary(rows)).toEqual(summary(today.rows));
    });

    it('reads _all_docs?include_docs=true, skipping other document types', () => {
      const { rows, errors } = normalizeCalendar(fixture('all_docs'));
      expect(errors).toEqual([]);
      expect(summary(rows.filter(r => r.date === '2026-10-25'))).toEqual(summary(today.rows));
      expect(rows).toHaveLength(16);
    });

    it('reads the judge and courtroom views', () => {
      const judge = normalizeCalendar(fixture('by_judge_date')).rows;
      expect(judge.every(r => r.judge === 'Judge Anderson' && r.courtroom === 'North')).toBe(true);
      expect(summary(judge)).toEqual(summary(today.rows.filter(r => r.judge === 'Judge Anderson')));

      const room = normalizeCalendar(fixture('by_courtroom_date')).rows;
      expect(summary(room)).toEqual(summary(today.rows.filter(r => r.courtroom === 'South')));
    });

    it('treats a missing trustee or movant as blank', () => {
      const arave = today.rows.find(r => r.case_number === '26-20877');
      expect(arave.movant).toBe('');
      expect(arave.trustee).toBe('Chapter 13 Trustee');
    });
  });
});
