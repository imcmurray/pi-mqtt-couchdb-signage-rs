const templateService = require('../../../src/services/templateService');
const AlertTemplate = require('../../../src/models/AlertTemplate');

jest.mock('../../../src/models/AlertTemplate');

describe('Template Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateVariables', () => {
    it('should validate when all required variables are provided', () => {
      const template = {
        variables: ['var1', 'var2']
      };

      const result = templateService.validateVariables(template, {
        var1: 'value1',
        var2: 'value2'
      });

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing variables', () => {
      const template = {
        variables: ['var1', 'var2', 'var3']
      };

      const result = templateService.validateVariables(template, {
        var1: 'value1'
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['var2', 'var3']);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Missing variables');
    });

    it('should detect extra variables', () => {
      const template = {
        variables: ['var1']
      };

      const result = templateService.validateVariables(template, {
        var1: 'value1',
        var2: 'value2',
        var3: 'value3'
      });

      expect(result.valid).toBe(true);
      expect(result.extra).toEqual(['var2', 'var3']);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Extra variables');
    });

    it('should handle empty variables array', () => {
      const template = {
        variables: []
      };

      const result = templateService.validateVariables(template, {});

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.extra).toEqual([]);
    });

    it('should handle both missing and extra variables', () => {
      const template = {
        variables: ['var1', 'var2']
      };

      const result = templateService.validateVariables(template, {
        var1: 'value1',
        var3: 'value3'
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['var2']);
      expect(result.extra).toEqual(['var3']);
      expect(result.errors.length).toBe(2);
    });
  });

  describe('previewTemplate', () => {
    it('should generate preview with valid variables', async () => {
      const mockTemplate = {
        template_id: 'test_template',
        name: 'Test Template',
        category: 'emergency',
        alert_type: 'CRITICAL',
        variables: ['building', 'exit_route'],
        render: jest.fn().mockReturnValue({
          title: 'Evacuate Building A',
          message: 'Exit via south exit',
          type: 'CRITICAL'
        })
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      const preview = await templateService.previewTemplate('test_template', {
        building: 'Building A',
        exit_route: 'south exit'
      });

      expect(preview.success).toBe(true);
      expect(preview.rendered.title).toBe('Evacuate Building A');
      expect(preview.rendered.message).toBe('Exit via south exit');
      expect(preview.template.name).toBe('Test Template');
      expect(preview.layer).toBeDefined();
    });

    it('should return error for missing variables', async () => {
      const mockTemplate = {
        template_id: 'test_template',
        name: 'Test Template',
        category: 'emergency',
        alert_type: 'CRITICAL',
        variables: ['building', 'exit_route']
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      const preview = await templateService.previewTemplate('test_template', {
        building: 'Building A'
      });

      expect(preview.success).toBe(false);
      expect(preview.errors.length).toBeGreaterThan(0);
      expect(preview.template.name).toBe('Test Template');
    });
  });

  describe('createTemplate', () => {
    it('should prevent creating templates with is_builtin=true', async () => {
      const templateData = {
        name: 'Test',
        title_template: 'Test',
        message_template: 'Test',
        is_builtin: true
      };

      await expect(templateService.createTemplate(templateData))
        .rejects
        .toThrow('Cannot create templates with is_builtin=true');
    });

    it('should create custom template successfully', async () => {
      const templateData = {
        name: 'Custom Template',
        category: 'general',
        title_template: 'Test ${var}',
        message_template: 'Test message',
        alert_type: 'INFO'
      };

      const mockTemplate = {
        ...templateData,
        template_id: 'template_123',
        save: jest.fn().mockResolvedValue(true)
      };

      AlertTemplate.mockImplementation(() => mockTemplate);

      const result = await templateService.createTemplate(templateData);

      expect(result.name).toBe('Custom Template');
      expect(mockTemplate.save).toHaveBeenCalled();
    });
  });

  describe('updateTemplate', () => {
    it('should prevent updating built-in templates', async () => {
      const mockTemplate = {
        template_id: 'builtin_evacuation',
        is_builtin: true
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      await expect(templateService.updateTemplate('builtin_evacuation', { name: 'New Name' }))
        .rejects
        .toThrow('Cannot update built-in templates');
    });

    it('should update custom template successfully', async () => {
      const mockTemplate = {
        template_id: 'custom_123',
        name: 'Old Name',
        is_builtin: false,
        save: jest.fn().mockResolvedValue(true)
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      const result = await templateService.updateTemplate('custom_123', {
        name: 'New Name'
      });

      expect(result.name).toBe('New Name');
      expect(result.is_builtin).toBe(false);
      expect(mockTemplate.save).toHaveBeenCalled();
    });

    it('should throw error if template not found', async () => {
      AlertTemplate.findById = jest.fn().mockResolvedValue(null);

      await expect(templateService.updateTemplate('nonexistent', { name: 'Test' }))
        .rejects
        .toThrow('Template not found');
    });
  });

  describe('deleteTemplate', () => {
    it('should prevent deleting built-in templates', async () => {
      const mockTemplate = {
        template_id: 'builtin_evacuation',
        is_builtin: true
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      await expect(templateService.deleteTemplate('builtin_evacuation'))
        .rejects
        .toThrow('Cannot delete built-in templates');
    });

    it('should delete custom template successfully', async () => {
      const mockTemplate = {
        template_id: 'custom_123',
        name: 'Custom Template',
        is_builtin: false,
        delete: jest.fn().mockResolvedValue(true)
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      const result = await templateService.deleteTemplate('custom_123');

      expect(result).toBe(true);
      expect(mockTemplate.delete).toHaveBeenCalled();
    });

    it('should throw error if template not found', async () => {
      AlertTemplate.findById = jest.fn().mockResolvedValue(null);

      await expect(templateService.deleteTemplate('nonexistent'))
        .rejects
        .toThrow('Template not found');
    });
  });

  describe('renderTemplate', () => {
    it('should render template with variables', async () => {
      const mockTemplate = {
        template_id: 'test_template',
        name: 'Test Template',
        render: jest.fn().mockReturnValue({
          title: 'Alert in Building A',
          message: 'Evacuate via south exit',
          type: 'CRITICAL'
        })
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      const result = await templateService.renderTemplate('test_template', {
        building: 'Building A',
        exit_route: 'south exit'
      });

      expect(result.title).toBe('Alert in Building A');
      expect(result.message).toBe('Evacuate via south exit');
      expect(mockTemplate.render).toHaveBeenCalledWith({
        building: 'Building A',
        exit_route: 'south exit'
      });
    });

    it('should throw error if rendering fails', async () => {
      const mockTemplate = {
        template_id: 'test_template',
        name: 'Test Template',
        render: jest.fn().mockImplementation(() => {
          throw new Error('Missing required variables');
        })
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      await expect(templateService.renderTemplate('test_template', {}))
        .rejects
        .toThrow('Failed to render template');
    });
  });

  describe('sendFromTemplate', () => {
    it('should prepare alert data from template', async () => {
      const mockTemplate = {
        template_id: 'test_template',
        name: 'Test Template',
        render: jest.fn().mockReturnValue({
          title: 'Weather Alert',
          message: 'Tornado warning until 3 PM',
          type: 'URGENT',
          template_name: 'Test Template'
        })
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(mockTemplate);

      const alertData = await templateService.sendFromTemplate(
        'test_template',
        { weather_type: 'Tornado', end_time: '3 PM' },
        { target_type: 'all', created_by: 'admin' }
      );

      expect(alertData.title).toBe('Weather Alert');
      expect(alertData.message).toBe('Tornado warning until 3 PM');
      expect(alertData.type).toBe('URGENT');
      expect(alertData.template_id).toBe('test_template');
      expect(alertData.target_type).toBe('all');
      expect(alertData.created_by).toBe('admin');
    });
  });

  describe('duplicateTemplate', () => {
    it('should create copy of template as custom template', async () => {
      const originalTemplate = {
        template_id: 'builtin_evacuation',
        name: 'Building Evacuation',
        category: 'emergency',
        title_template: 'Evacuate ${building}',
        message_template: 'Exit via ${exit_route}',
        alert_type: 'CRITICAL',
        description: 'Emergency evacuation',
        is_builtin: true
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(originalTemplate);

      const mockNewTemplate = {
        name: 'My Custom Evacuation',
        category: 'emergency',
        title_template: 'Evacuate ${building}',
        message_template: 'Exit via ${exit_route}',
        alert_type: 'CRITICAL',
        description: 'Emergency evacuation',
        is_builtin: false,
        save: jest.fn().mockResolvedValue(true)
      };

      AlertTemplate.mockImplementation(() => mockNewTemplate);
      jest.spyOn(templateService, 'createTemplate').mockResolvedValue(mockNewTemplate);

      const result = await templateService.duplicateTemplate('builtin_evacuation', 'My Custom Evacuation');

      expect(result.name).toBe('My Custom Evacuation');
      expect(result.is_builtin).toBe(false);
      expect(result.title_template).toBe(originalTemplate.title_template);
    });

    it('should auto-generate name if not provided', async () => {
      const originalTemplate = {
        template_id: 'test_123',
        name: 'Original Template',
        category: 'general',
        title_template: 'Test',
        message_template: 'Test',
        alert_type: 'INFO',
        description: '',
        is_builtin: false
      };

      AlertTemplate.findById = jest.fn().mockResolvedValue(originalTemplate);

      const mockNewTemplate = {
        name: 'Original Template (Copy)',
        save: jest.fn().mockResolvedValue(true)
      };

      jest.spyOn(templateService, 'createTemplate').mockResolvedValue(mockNewTemplate);

      const result = await templateService.duplicateTemplate('test_123');

      expect(result.name).toBe('Original Template (Copy)');
    });
  });

  describe('searchTemplates', () => {
    it('should find templates by name', async () => {
      const mockTemplates = [
        { template_id: '1', name: 'Building Evacuation', description: 'Emergency', category: 'emergency', title_template: 'Test', message_template: 'Test' },
        { template_id: '2', name: 'Fire Alarm', description: 'Fire emergency', category: 'emergency', title_template: 'Test', message_template: 'Test' },
        { template_id: '3', name: 'Weather Alert', description: 'Weather warnings', category: 'weather', title_template: 'Test', message_template: 'Test' }
      ];

      AlertTemplate.findAll = jest.fn().mockResolvedValue(mockTemplates);

      const results = await templateService.searchTemplates('fire');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Fire Alarm');
    });

    it('should find templates by description', async () => {
      const mockTemplates = [
        { template_id: '1', name: 'Test 1', description: 'Emergency evacuation', category: 'emergency', title_template: 'Test', message_template: 'Test' },
        { template_id: '2', name: 'Test 2', description: 'Weather warnings', category: 'weather', title_template: 'Test', message_template: 'Test' }
      ];

      AlertTemplate.findAll = jest.fn().mockResolvedValue(mockTemplates);

      const results = await templateService.searchTemplates('evacuation');

      expect(results.length).toBe(1);
      expect(results[0].description).toContain('evacuation');
    });

    it('should find templates by category', async () => {
      const mockTemplates = [
        { template_id: '1', name: 'Test 1', description: 'Test', category: 'emergency', title_template: 'Test', message_template: 'Test' },
        { template_id: '2', name: 'Test 2', description: 'Test', category: 'court', title_template: 'Test', message_template: 'Test' },
        { template_id: '3', name: 'Test 3', description: 'Test', category: 'emergency', title_template: 'Test', message_template: 'Test' }
      ];

      AlertTemplate.findAll = jest.fn().mockResolvedValue(mockTemplates);

      const results = await templateService.searchTemplates('emergency');

      expect(results.length).toBe(2);
    });

    it('should return empty array if no matches', async () => {
      const mockTemplates = [
        { template_id: '1', name: 'Test 1', description: 'Test', category: 'emergency', title_template: 'Test', message_template: 'Test' }
      ];

      AlertTemplate.findAll = jest.fn().mockResolvedValue(mockTemplates);

      const results = await templateService.searchTemplates('nonexistent');

      expect(results.length).toBe(0);
    });

    it('should be case-insensitive', async () => {
      const mockTemplates = [
        { template_id: '1', name: 'Building Evacuation', description: 'Emergency', category: 'emergency', title_template: 'Test', message_template: 'Test' }
      ];

      AlertTemplate.findAll = jest.fn().mockResolvedValue(mockTemplates);

      const results = await templateService.searchTemplates('BUILDING');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Building Evacuation');
    });
  });

  describe('getTemplateStats', () => {
    it('should calculate template statistics', async () => {
      const mockTemplates = [
        { template_id: '1', category: 'emergency', alert_type: 'CRITICAL', is_builtin: true },
        { template_id: '2', category: 'emergency', alert_type: 'URGENT', is_builtin: true },
        { template_id: '3', category: 'court', alert_type: 'URGENT', is_builtin: false },
        { template_id: '4', category: 'maintenance', alert_type: 'INFO', is_builtin: false }
      ];

      AlertTemplate.findAll = jest.fn().mockResolvedValue(mockTemplates);

      const stats = await templateService.getTemplateStats();

      expect(stats.total).toBe(4);
      expect(stats.builtin).toBe(2);
      expect(stats.custom).toBe(2);
      expect(stats.by_category.emergency).toBe(2);
      expect(stats.by_category.court).toBe(1);
      expect(stats.by_category.maintenance).toBe(1);
      expect(stats.by_type.CRITICAL).toBe(1);
      expect(stats.by_type.URGENT).toBe(2);
      expect(stats.by_type.INFO).toBe(1);
    });
  });
});
