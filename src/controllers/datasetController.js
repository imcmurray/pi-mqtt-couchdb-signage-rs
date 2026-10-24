const datasetService = require('../services/datasetService');
const { normalizeCalendar, sampleCalendar } = require('../utils/calendarImport');

const CALENDAR_ID = 'court_calendar';

class DatasetController {
  // GET /api/datasets - summaries (no rows)
  async listDatasets(req, res) {
    res.json(await datasetService.list());
  }

  // GET /api/datasets/:id
  async getDataset(req, res) {
    const dataset = await datasetService.get(req.params.id);
    if (!dataset) {
      return res.status(404).json({ error: 'Data set not found' });
    }
    res.json(dataset);
  }

  // PUT /api/datasets/court_calendar - body is the uploaded calendar JSON
  async uploadCalendar(req, res) {
    const { rows, errors } = normalizeCalendar(req.body);
    if (rows.length === 0) {
      return res.status(400).json({ error: errors[0] || 'No hearings found in the file', errors });
    }

    await datasetService.save(CALENDAR_ID, {
      name: 'Court Calendar',
      source: req.query.filename ? String(req.query.filename).slice(0, 200) : 'upload',
      row_count: rows.length,
      rows
    });

    res.json({
      imported: rows.length,
      skipped: errors.length,
      errors: errors.slice(0, 20),
      message: `Loaded ${rows.length} hearing(s)${errors.length ? `, skipped ${errors.length}` : ''}`
    });
  }

  // GET /api/datasets/court_calendar/sample - example upload file, dated today
  async getCalendarSample(req, res) {
    res.set('Content-Disposition', 'attachment; filename="court-calendar-sample.json"');
    res.json(sampleCalendar());
  }
}

module.exports = new DatasetController();
