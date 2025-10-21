const CourtHearing = require('../models/CourtHearing');

class HearingImportService {
  async importFromJSON(jsonData, source = 'json_import') {
    const hearings = [];
    const errors = [];

    const dataArray = Array.isArray(jsonData) ? jsonData : [jsonData];

    for (const item of dataArray) {
      try {
        const hearingData = this.parseJSONHearing(item);
        const hearing = new CourtHearing({
          ...hearingData,
          source
        });

        await hearing.save();
        hearings.push(hearing);
      } catch (error) {
        errors.push({
          case_number: item.case_number || item['Case Number'] || 'Unknown',
          error: error.message
        });
      }
    }

    return {
      success: hearings.length,
      failed: errors.length,
      hearings,
      errors
    };
  }

  parseJSONHearing(item) {
    const caseNumber = item.case_number || item['Case Number'];
    const courtRoom = item.court_room || item['Court Room'] || item.courtRoom;
    let scheduledTime = item.scheduled_time || item['Hearing Date & Time'] || item.scheduledTime;

    scheduledTime = this.parseDateTime(scheduledTime);

    const hearingData = {
      case_number: caseNumber,
      court_room: courtRoom,
      scheduled_time: scheduledTime,
      judge: item.judge || item['Hearing Judge'] || null
    };

    if (item.case_title || item['Case Title']) {
      hearingData.case_title = item.case_title || item['Case Title'];
    }

    if (item.hearing_matter || item['Hearing Matter']) {
      hearingData.hearing_matter = item.hearing_matter || item['Hearing Matter'];
    }

    if (item.case_chapter || item['Case Chapter']) {
      hearingData.case_chapter = item.case_chapter || item['Case Chapter'];
    }

    if (item.hearing_moving_party || item['Hearing Moving Party']) {
      hearingData.hearing_moving_party = item.hearing_moving_party || item['Hearing Moving Party'];
    }

    if (item.docket_entry) {
      hearingData.docket_entry = item.docket_entry;
    }

    if (item.parties) {
      hearingData.parties = item.parties;
    } else if (item.plaintiff || item.defendant) {
      hearingData.parties = {
        plaintiff: item.plaintiff,
        defendant: item.defendant
      };
    }

    if (item.hearing_type || item.hearingType) {
      hearingData.hearing_type = item.hearing_type || item.hearingType;
    }

    return hearingData;
  }

  parseDateTime(dateTimeString) {
    if (!dateTimeString) {
      throw new Error('Missing hearing date/time');
    }

    if (dateTimeString.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      return dateTimeString;
    }

    const dayMonthDayYearPattern = /^([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s*-\s*(\d{1,2}):(\d{2})$/;
    const match = dateTimeString.match(dayMonthDayYearPattern);

    if (match) {
      const [, , month, day, year, hour, minute] = match;
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      const monthIndex = monthNames.indexOf(month);

      if (monthIndex === -1) {
        throw new Error(`Invalid month: ${month}`);
      }

      const date = new Date(year, monthIndex, day, hour, minute);
      return date.toISOString();
    }

    const dateObj = new Date(dateTimeString);
    if (isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date format: ${dateTimeString}`);
    }

    return dateObj.toISOString();
  }

  async importFromBulk(hearingsArray, source = 'bulk_import') {
    const results = {
      total: hearingsArray.length,
      successful: [],
      failed: [],
      created_count: 0,
      error_count: 0
    };

    for (const hearingData of hearingsArray) {
      try {
        const hearing = new CourtHearing({
          ...hearingData,
          source
        });

        await hearing.save();
        results.successful.push({
          case_number: hearing.case_number,
          hearing_id: hearing.hearing_id
        });
        results.created_count++;
      } catch (error) {
        results.failed.push({
          case_number: hearingData.case_number || 'Unknown',
          error: error.message,
          data: hearingData
        });
        results.error_count++;
      }
    }

    return results;
  }
}

module.exports = new HearingImportService();
