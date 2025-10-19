const CourtHearing = require('../models/CourtHearing');
const courtDisplayService = require('../services/courtDisplayService');
const Joi = require('joi');

// Validation schemas
const hearingSchema = Joi.object({
  case_number: Joi.string().required().max(100),
  court_room: Joi.string().required().max(50),
  scheduled_time: Joi.string().isoDate().required(),
  parties: Joi.alternatives().try(
    Joi.string().max(500),
    Joi.object({
      plaintiff: Joi.string().max(200),
      defendant: Joi.string().max(200),
      petitioner: Joi.string().max(200),
      respondent: Joi.string().max(200),
      state: Joi.string().max(200)
    })
  ).required(),
  judge: Joi.string().max(200).optional().allow(null, ''),
  hearing_type: Joi.string().valid('general', 'trial', 'motion', 'arraignment', 'sentencing').optional(),
  display_config: Joi.object({
    tv_locations: Joi.array().items(Joi.string()).optional(),
    priority: Joi.number().min(1).max(255).optional(),
    show_until: Joi.string().isoDate().optional().allow(null),
    color_scheme: Joi.string().valid('auto', 'urgent', 'warning', 'normal', 'success', 'gray').optional()
  }).optional(),
  created_by: Joi.string().max(100).optional()
});

const updateHearingSchema = Joi.object({
  case_number: Joi.string().max(100).optional(),
  court_room: Joi.string().max(50).optional(),
  scheduled_time: Joi.string().isoDate().optional(),
  parties: Joi.alternatives().try(
    Joi.string().max(500),
    Joi.object({
      plaintiff: Joi.string().max(200),
      defendant: Joi.string().max(200),
      petitioner: Joi.string().max(200),
      respondent: Joi.string().max(200),
      state: Joi.string().max(200)
    })
  ).optional(),
  judge: Joi.string().max(200).optional().allow(null, ''),
  hearing_type: Joi.string().valid('general', 'trial', 'motion', 'arraignment', 'sentencing').optional(),
  status: Joi.string().valid('scheduled', 'in_progress', 'delayed', 'completed', 'cancelled').optional(),
  display_config: Joi.object().optional()
});

const delaySchema = Joi.object({
  minutes: Joi.number().min(1).max(480).required(),
  reason: Joi.string().max(500).required()
});

class CourtHearingController {
  /**
   * @openapi
   * /api/hearings:
   *   post:
   *     summary: Create court hearing
   *     description: Creates a new court hearing and refreshes display
   *     tags:
   *       - Court Hearings
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CourtHearing'
   *     responses:
   *       201:
   *         description: Hearing created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   $ref: '#/components/schemas/CourtHearing'
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   */
  async createHearing(req, res) {
    const { error, value } = hearingSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    try {
      const hearing = new CourtHearing(value);
      await hearing.save();

      // Automatically refresh display for affected TVs
      await courtDisplayService.refreshScheduleDisplay();

      res.status(201).json({
        success: true,
        data: hearing
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async getAllHearings(req, res) {
    try {
      const hearings = await CourtHearing.findAll();

      res.json({
        success: true,
        data: hearings,
        count: hearings.length
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async getTodaysSchedule(req, res) {
    try {
      const hearings = await CourtHearing.findTodaysSchedule();

      res.json({
        success: true,
        data: hearings,
        count: hearings.length,
        date: new Date().toISOString().split('T')[0]
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async getUpcomingHearings(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const hearings = await CourtHearing.findUpcoming(hours);

      res.json({
        success: true,
        data: hearings,
        count: hearings.length,
        timeframe_hours: hours
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async getHearingsByDate(req, res) {
    try {
      const { date } = req.params;

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD'
        });
      }

      const hearings = await CourtHearing.findByDate(date);

      res.json({
        success: true,
        data: hearings,
        count: hearings.length,
        date
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async getHearingsByRoom(req, res) {
    try {
      const { room } = req.params;
      const hearings = await CourtHearing.findByCourtRoom(room);

      res.json({
        success: true,
        data: hearings,
        count: hearings.length,
        court_room: room
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async getHearingById(req, res) {
    try {
      const { id } = req.params;
      const hearing = await CourtHearing.findById(id);

      if (!hearing) {
        return res.status(404).json({
          success: false,
          error: 'Hearing not found'
        });
      }

      res.json({
        success: true,
        data: hearing
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async updateHearing(req, res) {
    try {
      const { id } = req.params;
      const { error, value } = updateHearingSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const hearing = await CourtHearing.findById(id);

      if (!hearing) {
        return res.status(404).json({
          success: false,
          error: 'Hearing not found'
        });
      }

      await hearing.update(value);

      // Refresh display if significant changes
      const significantFields = ['scheduled_time', 'court_room', 'status', 'parties'];
      const hasSignificantChange = Object.keys(value).some(key => significantFields.includes(key));

      if (hasSignificantChange) {
        await courtDisplayService.refreshScheduleDisplay();
      }

      res.json({
        success: true,
        data: hearing
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async deleteHearing(req, res) {
    try {
      const { id } = req.params;
      const hearing = await CourtHearing.findById(id);

      if (!hearing) {
        return res.status(404).json({
          success: false,
          error: 'Hearing not found'
        });
      }

      await hearing.delete();

      // Refresh display to remove deleted hearing
      await courtDisplayService.refreshScheduleDisplay();

      res.json({
        success: true,
        message: 'Hearing deleted successfully'
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async markDelayed(req, res) {
    try {
      const { id } = req.params;
      const { error, value } = delaySchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        });
      }

      const hearing = await CourtHearing.findById(id);

      if (!hearing) {
        return res.status(404).json({
          success: false,
          error: 'Hearing not found'
        });
      }

      await hearing.markDelayed(value.minutes, value.reason);

      // Refresh display to show delay
      await courtDisplayService.refreshScheduleDisplay();

      res.json({
        success: true,
        data: hearing,
        message: `Hearing delayed by ${value.minutes} minutes`
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async markInProgress(req, res) {
    try {
      const { id } = req.params;
      const hearing = await CourtHearing.findById(id);

      if (!hearing) {
        return res.status(404).json({
          success: false,
          error: 'Hearing not found'
        });
      }

      await hearing.markInProgress();

      // Refresh display
      await courtDisplayService.refreshScheduleDisplay();

      res.json({
        success: true,
        data: hearing,
        message: 'Hearing marked as in progress'
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async markCompleted(req, res) {
    try {
      const { id } = req.params;
      const hearing = await CourtHearing.findById(id);

      if (!hearing) {
        return res.status(404).json({
          success: false,
          error: 'Hearing not found'
        });
      }

      await hearing.markCompleted();

      // Refresh display to remove completed hearing
      await courtDisplayService.refreshScheduleDisplay();

      res.json({
        success: true,
        data: hearing,
        message: 'Hearing marked as completed'
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async cancelHearing(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Cancellation reason is required'
        });
      }

      const hearing = await CourtHearing.findById(id);

      if (!hearing) {
        return res.status(404).json({
          success: false,
          error: 'Hearing not found'
        });
      }

      await hearing.cancel(reason);

      // Refresh display
      await courtDisplayService.refreshScheduleDisplay();

      res.json({
        success: true,
        data: hearing,
        message: 'Hearing cancelled'
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async importFromCSV(req, res) {
    try {
      const { hearings, source } = req.body;

      if (!Array.isArray(hearings) || hearings.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid CSV data. Expected array of hearing objects'
        });
      }

      const imported = await CourtHearing.importFromCSV(hearings, source || 'csv_import');

      // Refresh display with new hearings
      await courtDisplayService.refreshScheduleDisplay();

      res.status(201).json({
        success: true,
        data: imported,
        count: imported.length,
        message: `Successfully imported ${imported.length} hearings`
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async getStats(req, res) {
    try {
      const stats = await CourtHearing.getStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  async refreshDisplay(req, res) {
    try {
      const result = await courtDisplayService.refreshScheduleDisplay();

      res.json({
        success: true,
        data: result,
        message: 'Court schedule display refreshed'
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }
}

module.exports = new CourtHearingController();
