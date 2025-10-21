const AlertTemplate = require('../../../src/models/AlertTemplate');

describe('AlertTemplate Model', () => {
  describe('constructor', () => {
    it('should create template with all required fields', () => {
      const template = new AlertTemplate({
        name: 'Test Template',
        category: 'emergency',
        title_template: 'Alert: ${title}',
        message_template: 'Message: ${message}',
        alert_type: 'CRITICAL'
      });

      expect(template.name).toBe('Test Template');
      expect(template.category).toBe('emergency');
      expect(template.title_template).toBe('Alert: ${title}');
      expect(template.message_template).toBe('Message: ${message}');
      expect(template.alert_type).toBe('CRITICAL');
      expect(template.is_builtin).toBe(false);
      expect(template.template_id).toBeDefined();
    });

    it('should default to INFO type if not specified', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: 'Test'
      });

      expect(template.alert_type).toBe('INFO');
      expect(template.category).toBe('general');
    });

    it('should set is_builtin flag correctly', () => {
      const builtin = new AlertTemplate({
        name: 'Builtin',
        title_template: 'Test',
        message_template: 'Test',
        is_builtin: true
      });

      const custom = new AlertTemplate({
        name: 'Custom',
        title_template: 'Test',
        message_template: 'Test',
        is_builtin: false
      });

      expect(builtin.is_builtin).toBe(true);
      expect(custom.is_builtin).toBe(false);
    });
  });

  describe('validation', () => {
    it('should validate required name field', () => {
      const template = new AlertTemplate({
        name: '',
        title_template: 'Test',
        message_template: 'Test'
      });

      expect(() => template.validate()).toThrow('Template name is required');
    });

    it('should validate required title_template field', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: '',
        message_template: 'Test'
      });

      expect(() => template.validate()).toThrow('Title template is required');
    });

    it('should validate required message_template field', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: ''
      });

      expect(() => template.validate()).toThrow('Message template is required');
    });

    it('should validate alert_type is valid', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: 'Test',
        alert_type: 'INVALID'
      });

      expect(() => template.validate()).toThrow('Invalid alert type');
    });

    it('should validate category is valid', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: 'Test',
        category: 'invalid'
      });

      expect(() => template.validate()).toThrow('Invalid category');
    });

    it('should pass validation with all valid fields', () => {
      const template = new AlertTemplate({
        name: 'Test',
        category: 'emergency',
        title_template: 'Test ${var}',
        message_template: 'Test message',
        alert_type: 'CRITICAL'
      });

      expect(template.validate()).toBe(true);
    });
  });

  describe('extractVariables', () => {
    it('should extract variables from title template', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Alert in ${building} on ${floor}',
        message_template: 'Please evacuate'
      });

      const variables = template.extractVariables();

      expect(variables).toContain('building');
      expect(variables).toContain('floor');
      expect(variables.length).toBe(2);
    });

    it('should extract variables from message template', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Weather Alert',
        message_template: '${weather_type} warning until ${end_time}'
      });

      const variables = template.extractVariables();

      expect(variables).toContain('weather_type');
      expect(variables).toContain('end_time');
      expect(variables.length).toBe(2);
    });

    it('should extract variables from both templates', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Room ${room_number}',
        message_template: 'Delayed by ${delay_minutes} minutes'
      });

      const variables = template.extractVariables();

      expect(variables).toContain('room_number');
      expect(variables).toContain('delay_minutes');
      expect(variables.length).toBe(2);
    });

    it('should handle templates with no variables', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Static Title',
        message_template: 'Static message'
      });

      const variables = template.extractVariables();

      expect(variables.length).toBe(0);
    });

    it('should handle duplicate variables', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: '${name} Alert',
        message_template: 'Contact ${name} immediately'
      });

      const variables = template.extractVariables();

      expect(variables).toContain('name');
      expect(variables.length).toBe(1);
    });

    it('should handle multiple occurrences of same variable', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: '${room} is ${room} ${room}'
      });

      const variables = template.extractVariables();

      expect(variables).toContain('room');
      expect(variables.length).toBe(1);
    });
  });

  describe('renderText', () => {
    it('should replace single variable', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Hello ${name}',
        message_template: 'Test'
      });

      const result = template.renderText('Hello ${name}', { name: 'World' });

      expect(result).toBe('Hello World');
    });

    it('should replace multiple variables', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: 'Test'
      });

      const result = template.renderText(
        '${building} on ${floor}',
        { building: 'Main Hall', floor: '3rd' }
      );

      expect(result).toBe('Main Hall on 3rd');
    });

    it('should replace all occurrences of variable', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: 'Test'
      });

      const result = template.renderText(
        '${name} ${name} ${name}',
        { name: 'Test' }
      );

      expect(result).toBe('Test Test Test');
    });

    it('should leave text unchanged if no variables', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test',
        message_template: 'Test'
      });

      const result = template.renderText('Static text', {});

      expect(result).toBe('Static text');
    });
  });

  describe('render', () => {
    it('should render complete alert data', () => {
      const template = new AlertTemplate({
        name: 'Evacuation',
        title_template: 'Evacuate ${building}',
        message_template: 'Exit via ${route}',
        alert_type: 'CRITICAL'
      });

      const result = template.render({
        building: 'Main Hall',
        route: 'south exit'
      });

      expect(result.title).toBe('Evacuate Main Hall');
      expect(result.message).toBe('Exit via south exit');
      expect(result.type).toBe('CRITICAL');
      expect(result.template_id).toBe(template.template_id);
      expect(result.template_name).toBe('Evacuation');
    });

    it('should throw error if missing required variable', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test ${var1}',
        message_template: 'Message ${var2}',
        variables: ['var1', 'var2']
      });

      expect(() => template.render({ var1: 'value1' })).toThrow('Missing required variables: var2');
    });

    it('should throw error if missing multiple variables', () => {
      const template = new AlertTemplate({
        name: 'Test',
        title_template: 'Test ${var1} ${var2}',
        message_template: 'Message ${var3}',
        variables: ['var1', 'var2', 'var3']
      });

      expect(() => template.render({ var1: 'value1' })).toThrow('Missing required variables: var2, var3');
    });

    it('should render successfully with all variables provided', () => {
      const template = new AlertTemplate({
        name: 'Weather',
        title_template: '${type} Alert',
        message_template: '${type} until ${end_time}. ${instructions}',
        alert_type: 'URGENT'
      });

      template.extractVariables();

      const result = template.render({
        type: 'Tornado',
        end_time: '3:00 PM',
        instructions: 'Seek shelter immediately'
      });

      expect(result.title).toBe('Tornado Alert');
      expect(result.message).toBe('Tornado until 3:00 PM. Seek shelter immediately');
      expect(result.type).toBe('URGENT');
    });
  });

  describe('Built-in Templates', () => {
    it('should have correct number of built-in templates', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();

      expect(builtinTemplates.length).toBe(10);
    });

    it('should include building evacuation template', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const evacuation = builtinTemplates.find(t => t.template_id === 'builtin_evacuation');

      expect(evacuation).toBeDefined();
      expect(evacuation.name).toBe('Building Evacuation');
      expect(evacuation.category).toBe('emergency');
      expect(evacuation.alert_type).toBe('CRITICAL');
      expect(evacuation.is_builtin).toBe(true);
      expect(evacuation.variables).toContain('building');
      expect(evacuation.variables).toContain('exit_route');
      expect(evacuation.variables).toContain('reason');
    });

    it('should include fire alarm template', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const fire = builtinTemplates.find(t => t.template_id === 'builtin_fire_alarm');

      expect(fire).toBeDefined();
      expect(fire.name).toBe('Fire Alarm');
      expect(fire.category).toBe('emergency');
      expect(fire.alert_type).toBe('CRITICAL');
      expect(fire.variables).toContain('floor');
    });

    it('should include court delay template', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const courtDelay = builtinTemplates.find(t => t.template_id === 'builtin_court_delay');

      expect(courtDelay).toBeDefined();
      expect(courtDelay.name).toBe('Court Room Delay');
      expect(courtDelay.category).toBe('court');
      expect(courtDelay.alert_type).toBe('URGENT');
      expect(courtDelay.variables).toContain('room_number');
      expect(courtDelay.variables).toContain('delay_minutes');
    });

    it('should include maintenance notice template', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const maintenance = builtinTemplates.find(t => t.template_id === 'builtin_maintenance');

      expect(maintenance).toBeDefined();
      expect(maintenance.name).toBe('Maintenance Notice');
      expect(maintenance.category).toBe('maintenance');
      expect(maintenance.alert_type).toBe('INFO');
      expect(maintenance.variables).toContain('system');
      expect(maintenance.variables).toContain('start_time');
      expect(maintenance.variables).toContain('end_time');
    });

    it('should have all built-in templates marked as builtin', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();

      builtinTemplates.forEach(template => {
        expect(template.is_builtin).toBe(true);
      });
    });

    it('should have all built-in templates with valid categories', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const validCategories = ['emergency', 'court', 'maintenance', 'weather', 'general'];

      builtinTemplates.forEach(template => {
        expect(validCategories).toContain(template.category);
      });
    });

    it('should have all built-in templates with valid alert types', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const validTypes = ['CRITICAL', 'URGENT', 'INFO'];

      builtinTemplates.forEach(template => {
        expect(validTypes).toContain(template.alert_type);
      });
    });
  });

  describe('Template Categories', () => {
    it('should have emergency templates', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const emergencyTemplates = builtinTemplates.filter(t => t.category === 'emergency');

      expect(emergencyTemplates.length).toBeGreaterThan(0);
    });

    it('should have court templates', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const courtTemplates = builtinTemplates.filter(t => t.category === 'court');

      expect(courtTemplates.length).toBeGreaterThan(0);
    });

    it('should have maintenance templates', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const maintenanceTemplates = builtinTemplates.filter(t => t.category === 'maintenance');

      expect(maintenanceTemplates.length).toBeGreaterThan(0);
    });

    it('should have weather templates', () => {
      const builtinTemplates = AlertTemplate.getBuiltinTemplates();
      const weatherTemplates = builtinTemplates.filter(t => t.category === 'weather');

      expect(weatherTemplates.length).toBeGreaterThan(0);
    });
  });
});
