const BaseModel = require('./BaseModel');
const multilayerDb = require('../config/multilayer.database');

class AlertTemplate extends BaseModel {
  constructor(data) {
    super(data, 'alert_template');

    this.template_id = data.template_id || this.generateTemplateId();
    this.name = data.name || '';
    this.category = data.category || 'general';
    this.title_template = data.title_template || '';
    this.message_template = data.message_template || '';
    this.alert_type = data.alert_type || 'INFO';
    this.variables = data.variables || [];
    this.is_builtin = data.is_builtin !== undefined ? data.is_builtin : false;
    this.created_by = data.created_by || 'system';
    this.description = data.description || '';
  }

  generateTemplateId() {
    return `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  validate() {
    if (!this.name || this.name.trim() === '') {
      throw new Error('Template name is required');
    }

    if (!this.title_template || this.title_template.trim() === '') {
      throw new Error('Title template is required');
    }

    if (!this.message_template || this.message_template.trim() === '') {
      throw new Error('Message template is required');
    }

    const validTypes = ['CRITICAL', 'URGENT', 'INFO'];
    if (!validTypes.includes(this.alert_type)) {
      throw new Error('Invalid alert type. Must be CRITICAL, URGENT, or INFO');
    }

    const validCategories = ['emergency', 'court', 'maintenance', 'weather', 'general'];
    if (!validCategories.includes(this.category)) {
      throw new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
    }

    return true;
  }

  extractVariables() {
    const titleVars = this.extractVariablesFromText(this.title_template);
    const messageVars = this.extractVariablesFromText(this.message_template);
    const allVars = new Set([...titleVars, ...messageVars]);
    this.variables = Array.from(allVars);
    return this.variables;
  }

  extractVariablesFromText(text) {
    const regex = /\$\{([^}]+)\}/g;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }

  render(variableValues = {}) {
    const missingVars = this.variables.filter(v => !(v in variableValues));
    if (missingVars.length > 0) {
      throw new Error(`Missing required variables: ${missingVars.join(', ')}`);
    }

    const title = this.renderText(this.title_template, variableValues);
    const message = this.renderText(this.message_template, variableValues);

    return {
      title,
      message,
      type: this.alert_type,
      template_id: this.template_id,
      template_name: this.name
    };
  }

  renderText(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
      result = result.replace(regex, value);
    }
    return result;
  }

  static getDb() {
    return multilayerDb.getDatabase('alert_templates');
  }

  static async findAll() {
    const db = this.getDb();
    try {
      const result = await db.view('alert_templates', 'all', { include_docs: true });
      return result.rows.map(row => new AlertTemplate(row.doc));
    } catch (error) {
      if (error.statusCode === 404) {
        return [];
      }
      throw error;
    }
  }

  static async findById(templateId) {
    const templates = await this.findAll();
    return templates.find(t => t.template_id === templateId) || null;
  }

  static async findByCategory(category) {
    const db = this.getDb();
    try {
      const result = await db.view('alert_templates', 'by_category', {
        key: category,
        include_docs: true
      });
      return result.rows.map(row => new AlertTemplate(row.doc));
    } catch (error) {
      if (error.statusCode === 404) {
        return [];
      }
      throw error;
    }
  }

  static async findBuiltin() {
    const templates = await this.findAll();
    return templates.filter(t => t.is_builtin);
  }

  static async findCustom() {
    const templates = await this.findAll();
    return templates.filter(t => !t.is_builtin);
  }

  async save() {
    this.validate();
    this.extractVariables();

    const db = AlertTemplate.getDb();
    const doc = this.toJSON();

    if (this._id && this._rev) {
      const result = await db.insert({ ...doc, _id: this._id, _rev: this._rev });
      this._rev = result.rev;
    } else {
      const result = await db.insert(doc);
      this._id = result.id;
      this._rev = result.rev;
    }

    return this;
  }

  async delete() {
    if (this.is_builtin) {
      throw new Error('Cannot delete built-in templates');
    }

    const db = AlertTemplate.getDb();
    if (this._rev) {
      await db.destroy(this._id, this._rev);
    }
    return true;
  }

  static getBuiltinTemplates() {
    return [
      {
        template_id: 'builtin_evacuation',
        name: 'Building Evacuation',
        category: 'emergency',
        title_template: 'Building Evacuation - ${building}',
        message_template: 'Evacuate ${building} immediately via ${exit_route}. ${reason}',
        alert_type: 'CRITICAL',
        variables: ['building', 'exit_route', 'reason'],
        is_builtin: true,
        created_by: 'system',
        description: 'Emergency building evacuation alert'
      },
      {
        template_id: 'builtin_fire_alarm',
        name: 'Fire Alarm',
        category: 'emergency',
        title_template: 'Fire Alarm',
        message_template: 'Fire detected on ${floor}. Leave building immediately via nearest exit.',
        alert_type: 'CRITICAL',
        variables: ['floor'],
        is_builtin: true,
        created_by: 'system',
        description: 'Fire emergency alert'
      },
      {
        template_id: 'builtin_weather_alert',
        name: 'Weather Alert',
        category: 'weather',
        title_template: 'Weather Alert - ${weather_type}',
        message_template: '${weather_type} warning in effect until ${end_time}. ${instructions}',
        alert_type: 'URGENT',
        variables: ['weather_type', 'end_time', 'instructions'],
        is_builtin: true,
        created_by: 'system',
        description: 'Severe weather notification'
      },
      {
        template_id: 'builtin_court_delay',
        name: 'Court Room Delay',
        category: 'court',
        title_template: 'Court Room ${room_number} Delayed',
        message_template: 'All proceedings in Room ${room_number} delayed by ${delay_minutes} minutes. ${reason}',
        alert_type: 'URGENT',
        variables: ['room_number', 'delay_minutes', 'reason'],
        is_builtin: true,
        created_by: 'system',
        description: 'Court hearing delay notification'
      },
      {
        template_id: 'builtin_court_cancelled',
        name: 'Court Hearing Cancelled',
        category: 'court',
        title_template: 'Case ${case_number} Cancelled',
        message_template: 'Case ${case_number} scheduled for ${time} has been cancelled. ${reason}',
        alert_type: 'URGENT',
        variables: ['case_number', 'time', 'reason'],
        is_builtin: true,
        created_by: 'system',
        description: 'Court hearing cancellation notice'
      },
      {
        template_id: 'builtin_maintenance',
        name: 'Maintenance Notice',
        category: 'maintenance',
        title_template: '${system} Maintenance',
        message_template: '${system} maintenance scheduled from ${start_time} to ${end_time}. ${impact}',
        alert_type: 'INFO',
        variables: ['system', 'start_time', 'end_time', 'impact'],
        is_builtin: true,
        created_by: 'system',
        description: 'Scheduled maintenance notification'
      },
      {
        template_id: 'builtin_facility_closure',
        name: 'Facility Closure',
        category: 'general',
        title_template: '${facility} Closed',
        message_template: '${facility} is closed. ${reason}. Expected to reopen ${reopen_time}',
        alert_type: 'URGENT',
        variables: ['facility', 'reason', 'reopen_time'],
        is_builtin: true,
        created_by: 'system',
        description: 'Facility closure announcement'
      },
      {
        template_id: 'builtin_general_announcement',
        name: 'General Announcement',
        category: 'general',
        title_template: '${title}',
        message_template: '${message}',
        alert_type: 'INFO',
        variables: ['title', 'message'],
        is_builtin: true,
        created_by: 'system',
        description: 'Generic announcement template'
      },
      {
        template_id: 'builtin_security_alert',
        name: 'Security Alert',
        category: 'emergency',
        title_template: 'Security Alert',
        message_template: 'Security incident in ${location}. ${instructions} Contact security at ${phone}',
        alert_type: 'CRITICAL',
        variables: ['location', 'instructions', 'phone'],
        is_builtin: true,
        created_by: 'system',
        description: 'Security incident notification'
      },
      {
        template_id: 'builtin_court_recess',
        name: 'Court in Recess',
        category: 'court',
        title_template: 'Court Room ${room_number} in Recess',
        message_template: 'Room ${room_number} in recess. Will resume at ${resume_time}',
        alert_type: 'INFO',
        variables: ['room_number', 'resume_time'],
        is_builtin: true,
        created_by: 'system',
        description: 'Court recess notification'
      }
    ];
  }

  static async initializeBuiltinTemplates() {
    const db = this.getDb();
    const builtinTemplates = this.getBuiltinTemplates();
    const existingTemplates = await this.findBuiltin();

    const existingIds = new Set(existingTemplates.map(t => t.template_id));

    for (const templateData of builtinTemplates) {
      if (!existingIds.has(templateData.template_id)) {
        const template = new AlertTemplate(templateData);
        await template.save();
        console.log(`✅ Initialized built-in template: ${template.name}`);
      }
    }

    console.log(`📋 Built-in templates ready (${builtinTemplates.length} templates)`);
  }
}

module.exports = AlertTemplate;
