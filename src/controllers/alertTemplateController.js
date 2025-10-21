const templateService = require('../services/templateService');
const alertService = require('../services/alertService');
const Joi = require('joi');

const createTemplateSchema = Joi.object({
  name: Joi.string().required().max(100),
  category: Joi.string().valid('emergency', 'court', 'maintenance', 'weather', 'general').required(),
  title_template: Joi.string().required().max(200),
  message_template: Joi.string().required().max(1000),
  alert_type: Joi.string().valid('CRITICAL', 'URGENT', 'INFO').required(),
  description: Joi.string().max(500).optional().allow(''),
  created_by: Joi.string().default('admin')
});

const updateTemplateSchema = Joi.object({
  name: Joi.string().max(100).optional(),
  category: Joi.string().valid('emergency', 'court', 'maintenance', 'weather', 'general').optional(),
  title_template: Joi.string().max(200).optional(),
  message_template: Joi.string().max(1000).optional(),
  alert_type: Joi.string().valid('CRITICAL', 'URGENT', 'INFO').optional(),
  description: Joi.string().max(500).optional().allow('')
});

const sendFromTemplateSchema = Joi.object({
  variables: Joi.object().required(),
  target_type: Joi.string().valid('all', 'specific', 'location').default('all'),
  target_ids: Joi.array().items(Joi.string()).when('target_type', {
    is: 'specific',
    then: Joi.required()
  }),
  target_location: Joi.string().when('target_type', {
    is: 'location',
    then: Joi.required()
  }),
  created_by: Joi.string().default('admin')
});

class AlertTemplateController {
  /**
   * @openapi
   * /api/alerts/templates:
   *   get:
   *     summary: Get all alert templates
   *     description: Returns all available alert templates (built-in and custom)
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: query
   *         name: category
   *         schema:
   *           type: string
   *           enum: [emergency, court, maintenance, weather, general]
   *         description: Filter by category
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [builtin, custom]
   *         description: Filter by template type
   *     responses:
   *       200:
   *         description: List of templates
   */
  async getAllTemplates(req, res) {
    const { category, type } = req.query;

    let templates;

    if (category) {
      templates = await templateService.getTemplatesByCategory(category);
    } else if (type === 'builtin') {
      templates = await templateService.getBuiltinTemplates();
    } else if (type === 'custom') {
      templates = await templateService.getCustomTemplates();
    } else {
      templates = await templateService.getAllTemplates();
    }

    res.json({
      success: true,
      data: templates.map(t => ({
        template_id: t.template_id,
        name: t.name,
        category: t.category,
        alert_type: t.alert_type,
        variables: t.variables,
        is_builtin: t.is_builtin,
        description: t.description,
        created_at: t.created_at
      }))
    });
  }

  /**
   * @openapi
   * /api/alerts/templates/{templateId}:
   *   get:
   *     summary: Get template by ID
   *     description: Returns detailed information about a specific template
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: path
   *         name: templateId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Template found
   *       404:
   *         description: Template not found
   */
  async getTemplateById(req, res) {
    const { templateId } = req.params;

    try {
      const template = await templateService.getTemplate(templateId);

      res.json({
        success: true,
        data: template
      });
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/templates:
   *   post:
   *     summary: Create custom template
   *     description: Creates a new custom alert template
   *     tags:
   *       - Alert Templates
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - category
   *               - title_template
   *               - message_template
   *               - alert_type
   *     responses:
   *       201:
   *         description: Template created
   *       400:
   *         description: Validation error
   */
  async createTemplate(req, res) {
    const { error, value } = createTemplateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    try {
      const template = await templateService.createTemplate(value);

      res.status(201).json({
        success: true,
        data: template
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/templates/{templateId}:
   *   put:
   *     summary: Update template
   *     description: Updates a custom template (built-in templates cannot be updated)
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: path
   *         name: templateId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Template updated
   *       400:
   *         description: Validation error or attempt to update built-in template
   *       404:
   *         description: Template not found
   */
  async updateTemplate(req, res) {
    const { templateId } = req.params;
    const { error, value } = updateTemplateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    try {
      const template = await templateService.updateTemplate(templateId, value);

      res.json({
        success: true,
        data: template
      });
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/templates/{templateId}:
   *   delete:
   *     summary: Delete template
   *     description: Deletes a custom template (built-in templates cannot be deleted)
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: path
   *         name: templateId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Template deleted
   *       400:
   *         description: Attempt to delete built-in template
   *       404:
   *         description: Template not found
   */
  async deleteTemplate(req, res) {
    const { templateId } = req.params;

    try {
      await templateService.deleteTemplate(templateId);

      res.json({
        success: true,
        message: 'Template deleted successfully'
      });
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/templates/{templateId}/send:
   *   post:
   *     summary: Send alert from template
   *     description: Renders template with variables and broadcasts as alert
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: path
   *         name: templateId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - variables
   *             properties:
   *               variables:
   *                 type: object
   *                 description: Variable values for template
   *                 example: { "building": "Main Hall", "exit_route": "south exit", "reason": "Fire drill" }
   *               target_type:
   *                 type: string
   *                 enum: [all, specific, location]
   *                 default: all
   *               target_ids:
   *                 type: array
   *                 items:
   *                   type: string
   *               target_location:
   *                 type: string
   *     responses:
   *       201:
   *         description: Alert broadcast successfully
   *       400:
   *         description: Validation error or missing variables
   *       404:
   *         description: Template not found
   */
  async sendFromTemplate(req, res) {
    const { templateId } = req.params;
    const { error, value } = sendFromTemplateSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message
      });
    }

    try {
      const alertData = await templateService.sendFromTemplate(
        templateId,
        value.variables,
        {
          target_type: value.target_type,
          target_ids: value.target_ids,
          target_location: value.target_location,
          created_by: value.created_by
        }
      );

      const result = await alertService.broadcastAlert(alertData);

      res.status(201).json({
        success: true,
        data: {
          alert: {
            alert_id: result.alert.alert_id,
            title: result.alert.title,
            message: result.alert.message,
            type: result.alert.type,
            template_id: templateId
          },
          delivered_count: result.delivered_count,
          target_count: result.target_count
        }
      });
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/templates/{templateId}/preview:
   *   post:
   *     summary: Preview template rendering
   *     description: Previews how template will look with given variables without broadcasting
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: path
   *         name: templateId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - variables
   *             properties:
   *               variables:
   *                 type: object
   *     responses:
   *       200:
   *         description: Preview generated
   *       400:
   *         description: Missing required variables
   */
  async previewTemplate(req, res) {
    const { templateId } = req.params;
    const { variables } = req.body;

    if (!variables || typeof variables !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Variables object is required'
      });
    }

    try {
      const preview = await templateService.previewTemplate(templateId, variables);

      res.json(preview);
    } catch (err) {
      return res.status(404).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/templates/stats:
   *   get:
   *     summary: Get template statistics
   *     description: Returns aggregated statistics about available templates
   *     tags:
   *       - Alert Templates
   *     responses:
   *       200:
   *         description: Template statistics
   */
  async getTemplateStats(req, res) {
    const stats = await templateService.getTemplateStats();

    res.json({
      success: true,
      data: stats
    });
  }

  /**
   * @openapi
   * /api/alerts/templates/{templateId}/duplicate:
   *   post:
   *     summary: Duplicate template
   *     description: Creates a copy of an existing template as a custom template
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: path
   *         name: templateId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 description: Name for the duplicated template
   *     responses:
   *       201:
   *         description: Template duplicated
   */
  async duplicateTemplate(req, res) {
    const { templateId } = req.params;
    const { name } = req.body;

    try {
      const duplicated = await templateService.duplicateTemplate(templateId, name);

      res.status(201).json({
        success: true,
        data: duplicated
      });
    } catch (err) {
      return res.status(404).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * @openapi
   * /api/alerts/templates/search:
   *   get:
   *     summary: Search templates
   *     description: Search templates by name, description, or content
   *     tags:
   *       - Alert Templates
   *     parameters:
   *       - in: query
   *         name: q
   *         required: true
   *         schema:
   *           type: string
   *         description: Search query
   *     responses:
   *       200:
   *         description: Search results
   */
  async searchTemplates(req, res) {
    const { q } = req.query;

    if (!q || q.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const results = await templateService.searchTemplates(q);

    res.json({
      success: true,
      data: results.map(t => ({
        template_id: t.template_id,
        name: t.name,
        category: t.category,
        alert_type: t.alert_type,
        variables: t.variables,
        is_builtin: t.is_builtin,
        description: t.description
      }))
    });
  }
}

module.exports = new AlertTemplateController();
