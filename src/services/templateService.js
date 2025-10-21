const AlertTemplate = require('../models/AlertTemplate');
const Alert = require('../models/Alert');

class TemplateService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      await AlertTemplate.initializeBuiltinTemplates();
      this.initialized = true;
      console.log('✅ Template service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize template service:', error.message);
      throw error;
    }
  }

  async createTemplate(templateData) {
    if (templateData.is_builtin) {
      throw new Error('Cannot create templates with is_builtin=true. Use system initialization.');
    }

    const template = new AlertTemplate(templateData);
    await template.save();

    console.log(`✅ Created custom template: ${template.name} (${template.template_id})`);
    return template;
  }

  async updateTemplate(templateId, updates) {
    const template = await AlertTemplate.findById(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    if (template.is_builtin) {
      throw new Error('Cannot update built-in templates');
    }

    Object.assign(template, {
      ...updates,
      is_builtin: false,
      updated_at: new Date().toISOString()
    });

    await template.save();

    console.log(`✅ Updated template: ${template.name}`);
    return template;
  }

  async deleteTemplate(templateId) {
    const template = await AlertTemplate.findById(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    if (template.is_builtin) {
      throw new Error('Cannot delete built-in templates');
    }

    await template.delete();

    console.log(`✅ Deleted template: ${template.name}`);
    return true;
  }

  async getTemplate(templateId) {
    const template = await AlertTemplate.findById(templateId);

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return template;
  }

  async getAllTemplates() {
    return await AlertTemplate.findAll();
  }

  async getTemplatesByCategory(category) {
    return await AlertTemplate.findByCategory(category);
  }

  async getBuiltinTemplates() {
    return await AlertTemplate.findBuiltin();
  }

  async getCustomTemplates() {
    return await AlertTemplate.findCustom();
  }

  async renderTemplate(templateId, variableValues) {
    const template = await this.getTemplate(templateId);

    try {
      const rendered = template.render(variableValues);
      console.log(`✅ Rendered template: ${template.name}`);
      return rendered;
    } catch (error) {
      throw new Error(`Failed to render template: ${error.message}`);
    }
  }

  async sendFromTemplate(templateId, variableValues, broadcastOptions = {}) {
    const rendered = await this.renderTemplate(templateId, variableValues);

    const alertData = {
      title: rendered.title,
      message: rendered.message,
      type: rendered.type,
      template_id: templateId,
      template_variables: variableValues,
      ...broadcastOptions
    };

    console.log(`📤 Broadcasting alert from template: ${rendered.template_name}`);
    return alertData;
  }

  validateVariables(template, variableValues) {
    const missing = template.variables.filter(v => !(v in variableValues));
    const extra = Object.keys(variableValues).filter(v => !template.variables.includes(v));

    const errors = [];

    if (missing.length > 0) {
      errors.push(`Missing variables: ${missing.join(', ')}`);
    }

    if (extra.length > 0) {
      errors.push(`Extra variables (will be ignored): ${extra.join(', ')}`);
    }

    return {
      valid: missing.length === 0,
      missing,
      extra,
      errors
    };
  }

  async getTemplateStats() {
    const allTemplates = await this.getAllTemplates();
    const builtinTemplates = allTemplates.filter(t => t.is_builtin);
    const customTemplates = allTemplates.filter(t => !t.is_builtin);

    const byCategory = allTemplates.reduce((acc, template) => {
      acc[template.category] = (acc[template.category] || 0) + 1;
      return acc;
    }, {});

    const byType = allTemplates.reduce((acc, template) => {
      acc[template.alert_type] = (acc[template.alert_type] || 0) + 1;
      return acc;
    }, {});

    return {
      total: allTemplates.length,
      builtin: builtinTemplates.length,
      custom: customTemplates.length,
      by_category: byCategory,
      by_type: byType
    };
  }

  async previewTemplate(templateId, variableValues) {
    const template = await this.getTemplate(templateId);

    const validation = this.validateVariables(template, variableValues);

    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
        template: {
          name: template.name,
          category: template.category,
          type: template.alert_type
        }
      };
    }

    const rendered = template.render(variableValues);

    const alert = new Alert({
      ...rendered,
      target_type: 'all',
      created_by: 'preview'
    });

    const previewLayer = alert.toLayer('preview_tv');

    return {
      success: true,
      template: {
        name: template.name,
        category: template.category,
        type: template.alert_type,
        variables: template.variables
      },
      rendered: {
        title: rendered.title,
        message: rendered.message,
        type: rendered.type
      },
      layer: previewLayer,
      validation
    };
  }

  async duplicateTemplate(templateId, newName) {
    const originalTemplate = await this.getTemplate(templateId);

    const duplicateData = {
      name: newName || `${originalTemplate.name} (Copy)`,
      category: originalTemplate.category,
      title_template: originalTemplate.title_template,
      message_template: originalTemplate.message_template,
      alert_type: originalTemplate.alert_type,
      description: originalTemplate.description,
      is_builtin: false,
      created_by: 'user'
    };

    return await this.createTemplate(duplicateData);
  }

  async searchTemplates(query) {
    const allTemplates = await this.getAllTemplates();

    const lowerQuery = query.toLowerCase();

    return allTemplates.filter(template =>
      template.name.toLowerCase().includes(lowerQuery) ||
      template.description.toLowerCase().includes(lowerQuery) ||
      template.category.toLowerCase().includes(lowerQuery) ||
      template.title_template.toLowerCase().includes(lowerQuery) ||
      template.message_template.toLowerCase().includes(lowerQuery)
    );
  }
}

module.exports = new TemplateService();
