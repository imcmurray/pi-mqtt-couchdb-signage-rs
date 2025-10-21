const CourtHearing = require('../models/CourtHearing');
const courtDisplayService = require('../services/courtDisplayService');
const hearingImportService = require('../services/hearingImportService');
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

  // Bankruptcy-specific fields (optional)
  case_title: Joi.string().max(500).optional().allow(null, ''),
  hearing_matter: Joi.string().max(1000).optional().allow(null, ''),
  case_chapter: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null),
  hearing_moving_party: Joi.string().max(200).optional().allow(null, ''),
  docket_entry: Joi.string().max(100).optional().allow(null, ''),

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

  /**
   * @openapi
   * /api/hearings:
   *   get:
   *     summary: Get all hearings
   *     description: Returns all court hearings in the system
   *     tags:
   *       - Court Hearings
   *     responses:
   *       200:
   *         description: List of all hearings
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CourtHearing'
   *                 count:
   *                   type: integer
   */
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

  /**
   * @openapi
   * /api/hearings/today:
   *   get:
   *     summary: Get today's schedule
   *     description: Returns all hearings scheduled for today
   *     tags:
   *       - Court Hearings
   *     responses:
   *       200:
   *         description: Today's hearing schedule
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CourtHearing'
   *                 count:
   *                   type: integer
   *                 date:
   *                   type: string
   *                   format: date
   *                   example: "2025-10-18"
   */
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

  /**
   * @openapi
   * /api/hearings/upcoming:
   *   get:
   *     summary: Get upcoming hearings
   *     description: Returns hearings scheduled within the specified timeframe
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: query
   *         name: hours
   *         schema:
   *           type: integer
   *           default: 24
   *         description: Number of hours to look ahead
   *         example: 48
   *     responses:
   *       200:
   *         description: Upcoming hearings
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CourtHearing'
   *                 count:
   *                   type: integer
   *                 timeframe_hours:
   *                   type: integer
   */
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

  /**
   * @openapi
   * /api/hearings/date/{date}:
   *   get:
   *     summary: Get hearings by date
   *     description: Returns all hearings for a specific date
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: date
   *         required: true
   *         schema:
   *           type: string
   *           format: date
   *         description: Date in YYYY-MM-DD format
   *         example: "2025-10-20"
   *     responses:
   *       200:
   *         description: Hearings for the specified date
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CourtHearing'
   *                 count:
   *                   type: integer
   *                 date:
   *                   type: string
   *                   format: date
   *       400:
   *         description: Invalid date format
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/room/{room}:
   *   get:
   *     summary: Get hearings by courtroom
   *     description: Returns all hearings for a specific courtroom
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: room
   *         required: true
   *         schema:
   *           type: string
   *         description: Courtroom identifier
   *         example: "Courtroom 1"
   *     responses:
   *       200:
   *         description: Hearings for the specified courtroom
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CourtHearing'
   *                 count:
   *                   type: integer
   *                 court_room:
   *                   type: string
   */
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

  /**
   * @openapi
   * /api/hearings/{id}:
   *   get:
   *     summary: Get hearing by ID
   *     description: Returns a specific hearing by its ID
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Hearing document ID
   *         example: "hearing-12345"
   *     responses:
   *       200:
   *         description: Hearing found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   $ref: '#/components/schemas/CourtHearing'
   *       404:
   *         description: Hearing not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/{id}:
   *   put:
   *     summary: Update hearing
   *     description: Updates an existing court hearing and refreshes display if significant changes are made
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Hearing document ID
   *         example: "hearing-12345"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               case_number:
   *                 type: string
   *                 maxLength: 100
   *               court_room:
   *                 type: string
   *                 maxLength: 50
   *               scheduled_time:
   *                 type: string
   *                 format: date-time
   *               parties:
   *                 oneOf:
   *                   - type: string
   *                   - type: object
   *               judge:
   *                 type: string
   *               hearing_type:
   *                 type: string
   *                 enum: [general, trial, motion, arraignment, sentencing]
   *               status:
   *                 type: string
   *                 enum: [scheduled, in_progress, delayed, completed, cancelled]
   *     responses:
   *       200:
   *         description: Hearing updated
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
   *       404:
   *         description: Hearing not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/{id}:
   *   delete:
   *     summary: Delete hearing
   *     description: Deletes a court hearing and refreshes display
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Hearing document ID
   *         example: "hearing-12345"
   *     responses:
   *       200:
   *         description: Hearing deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 message:
   *                   type: string
   *                   example: "Hearing deleted successfully"
   *       404:
   *         description: Hearing not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/{id}/delay:
   *   post:
   *     summary: Mark hearing delayed
   *     description: Marks a hearing as delayed with reason and duration, then refreshes display
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Hearing document ID
   *         example: "hearing-12345"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - minutes
   *               - reason
   *             properties:
   *               minutes:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 480
   *                 description: Delay duration in minutes
   *                 example: 30
   *               reason:
   *                 type: string
   *                 maxLength: 500
   *                 description: Reason for delay
   *                 example: "Judge running late"
   *     responses:
   *       200:
   *         description: Hearing marked as delayed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   $ref: '#/components/schemas/CourtHearing'
   *                 message:
   *                   type: string
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: Hearing not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/{id}/in-progress:
   *   post:
   *     summary: Mark hearing in progress
   *     description: Marks a hearing as currently in progress and refreshes display
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Hearing document ID
   *         example: "hearing-12345"
   *     responses:
   *       200:
   *         description: Hearing marked as in progress
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   $ref: '#/components/schemas/CourtHearing'
   *                 message:
   *                   type: string
   *                   example: "Hearing marked as in progress"
   *       404:
   *         description: Hearing not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/{id}/completed:
   *   post:
   *     summary: Mark hearing completed
   *     description: Marks a hearing as completed and removes it from active display
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Hearing document ID
   *         example: "hearing-12345"
   *     responses:
   *       200:
   *         description: Hearing marked as completed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   $ref: '#/components/schemas/CourtHearing'
   *                 message:
   *                   type: string
   *                   example: "Hearing marked as completed"
   *       404:
   *         description: Hearing not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/{id}/cancel:
   *   post:
   *     summary: Cancel hearing
   *     description: Cancels a hearing with a reason and refreshes display
   *     tags:
   *       - Court Hearings
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Hearing document ID
   *         example: "hearing-12345"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - reason
   *             properties:
   *               reason:
   *                 type: string
   *                 description: Cancellation reason
   *                 example: "Settlement reached"
   *     responses:
   *       200:
   *         description: Hearing cancelled
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   $ref: '#/components/schemas/CourtHearing'
   *                 message:
   *                   type: string
   *                   example: "Hearing cancelled"
   *       400:
   *         description: Missing cancellation reason
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Hearing not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/import:
   *   post:
   *     summary: Import hearings from CSV
   *     description: Bulk imports court hearings from CSV data and refreshes display
   *     tags:
   *       - Court Hearings
   *     security:
   *       - AdminAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - hearings
   *             properties:
   *               hearings:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     case_number:
   *                       type: string
   *                     court_room:
   *                       type: string
   *                     scheduled_time:
   *                       type: string
   *                       format: date-time
   *                     parties:
   *                       type: string
   *                     judge:
   *                       type: string
   *               source:
   *                 type: string
   *                 default: "csv_import"
   *                 description: Import source identifier
   *     responses:
   *       201:
   *         description: Hearings imported successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CourtHearing'
   *                 count:
   *                   type: integer
   *                 message:
   *                   type: string
   *                   example: "Successfully imported 5 hearings"
   *       400:
   *         description: Invalid CSV data
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/hearings/stats:
   *   get:
   *     summary: Get hearing statistics
   *     description: Returns aggregated statistics about court hearings
   *     tags:
   *       - Court Hearings
   *     responses:
   *       200:
   *         description: Hearing statistics
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   description: Statistical data about hearings
   *                   properties:
   *                     total_hearings:
   *                       type: integer
   *                     by_status:
   *                       type: object
   *                     by_courtroom:
   *                       type: object
   *                     today_count:
   *                       type: integer
   */
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

  /**
   * @openapi
   * /api/hearings/refresh:
   *   post:
   *     summary: Refresh court schedule display
   *     description: Manually triggers a refresh of the court schedule on all affected TVs
   *     tags:
   *       - Court Hearings
   *     security:
   *       - AdminAuth: []
   *     responses:
   *       200:
   *         description: Display refreshed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   description: Refresh operation result
   *                 message:
   *                   type: string
   *                   example: "Court schedule display refreshed"
   */
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

  async importFromJSON(req, res) {
    try {
      const jsonData = req.body;

      if (!jsonData || (Array.isArray(jsonData) && jsonData.length === 0)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON data. Expected object or array of hearing objects'
        });
      }

      const result = await hearingImportService.importFromJSON(jsonData, 'json_import');

      await courtDisplayService.refreshScheduleDisplay();

      res.status(201).json({
        success: true,
        imported: result.success,
        failed: result.failed,
        errors: result.errors,
        message: `Successfully imported ${result.success} hearings${result.failed > 0 ? `, ${result.failed} failed` : ''}`
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
