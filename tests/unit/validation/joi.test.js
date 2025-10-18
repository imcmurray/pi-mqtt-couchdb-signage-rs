const Joi = require('joi');

describe('Input Validation', () => {
  describe('TV validation schema', () => {
    const tvSchema = Joi.object({
      name: Joi.string().required(),
      location: Joi.string().required(),
      ip_address: Joi.string().ip().required(),
      config: Joi.object({
        transition_effect: Joi.string().valid('fade', 'slide', 'wipe', 'dissolve').default('fade'),
        display_duration: Joi.number().min(1000).max(60000).default(5000),
        resolution: Joi.string().default('1920x1080'),
        orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait').default('landscape')
      }).default({})
    });

    it('should validate correct TV data', () => {
      const validTV = {
        name: 'Living Room TV',
        location: 'Living Room',
        ip_address: '192.168.1.100',
        config: {
          transition_effect: 'fade',
          display_duration: 5000
        }
      };

      const { error, value } = tvSchema.validate(validTV);
      expect(error).toBeUndefined();
      expect(value.name).toBe('Living Room TV');
      expect(value.config.transition_effect).toBe('fade');
    });

    it('should apply default values', () => {
      const minimalTV = {
        name: 'Test TV',
        location: 'Test Room',
        ip_address: '192.168.1.101'
      };

      const { error, value } = tvSchema.validate(minimalTV);
      expect(error).toBeUndefined();
      expect(value.config.transition_effect).toBe('fade');
      expect(value.config.display_duration).toBe(5000);
      expect(value.config.resolution).toBe('1920x1080');
      expect(value.config.orientation).toBe('landscape');
    });

    it('should reject missing required fields', () => {
      const invalidTV = {
        name: 'Incomplete TV'
      };

      const { error } = tvSchema.validate(invalidTV);
      expect(error).toBeDefined();
      expect(error.details[0].path[0]).toBe('location');
    });

    it('should reject invalid IP address', () => {
      const invalidTV = {
        name: 'Bad IP TV',
        location: 'Room',
        ip_address: 'not-an-ip'
      };

      const { error } = tvSchema.validate(invalidTV);
      expect(error).toBeDefined();
      expect(error.details[0].path[0]).toBe('ip_address');
      expect(error.details[0].message).toContain('valid ip');
    });

    it('should reject invalid transition effect', () => {
      const invalidTV = {
        name: 'Bad Effect TV',
        location: 'Room',
        ip_address: '192.168.1.100',
        config: {
          transition_effect: 'invalid-effect'
        }
      };

      const { error } = tvSchema.validate(invalidTV);
      expect(error).toBeDefined();
      expect(error.details[0].path).toEqual(['config', 'transition_effect']);
    });

    it('should reject invalid display duration', () => {
      const invalidTV = {
        name: 'Bad Duration TV',
        location: 'Room',
        ip_address: '192.168.1.100',
        config: {
          display_duration: 500 // Too short
        }
      };

      const { error } = tvSchema.validate(invalidTV);
      expect(error).toBeDefined();
      expect(error.details[0].path).toEqual(['config', 'display_duration']);
    });
  });

  describe('Image validation schema', () => {
    const imageSchema = Joi.object({
      original_filename: Joi.string().required(),
      title: Joi.string().required(),
      description: Joi.string().allow('').default(''),
      tags: Joi.array().items(Joi.string()).default([]),
      tv_assignments: Joi.array().items(Joi.string()).default([])
    });

    it('should validate correct image data', () => {
      const validImage = {
        original_filename: 'test.jpg',
        title: 'Test Image',
        description: 'A test image',
        tags: ['test', 'sample'],
        tv_assignments: ['tv_1', 'tv_2']
      };

      const { error, value } = imageSchema.validate(validImage);
      expect(error).toBeUndefined();
      expect(value.title).toBe('Test Image');
      expect(value.tags).toEqual(['test', 'sample']);
    });

    it('should apply default values for optional fields', () => {
      const minimalImage = {
        original_filename: 'minimal.png',
        title: 'Minimal Image'
      };

      const { error, value } = imageSchema.validate(minimalImage);
      expect(error).toBeUndefined();
      expect(value.description).toBe('');
      expect(value.tags).toEqual([]);
      expect(value.tv_assignments).toEqual([]);
    });

    it('should reject missing required fields', () => {
      const invalidImage = {
        original_filename: 'no-title.jpg'
      };

      const { error } = imageSchema.validate(invalidImage);
      expect(error).toBeDefined();
      expect(error.details[0].path[0]).toBe('title');
    });
  });

  describe('Command validation schema', () => {
    const commandSchema = Joi.object({
      command: Joi.string().valid('play', 'pause', 'next', 'previous', 'stop', 'reboot').required(),
      params: Joi.object().optional()
    });

    it('should validate correct commands', () => {
      const validCommands = [
        { command: 'play' },
        { command: 'pause' },
        { command: 'next' },
        { command: 'previous' },
        { command: 'stop' },
        { command: 'reboot' }
      ];

      validCommands.forEach(cmd => {
        const { error } = commandSchema.validate(cmd);
        expect(error).toBeUndefined();
      });
    });

    it('should reject invalid commands', () => {
      const invalidCommand = { command: 'invalid-command' };

      const { error } = commandSchema.validate(invalidCommand);
      expect(error).toBeDefined();
      expect(error.details[0].path[0]).toBe('command');
    });

    it('should allow optional parameters', () => {
      const commandWithParams = {
        command: 'play',
        params: { volume: 0.8 }
      };

      const { error, value } = commandSchema.validate(commandWithParams);
      expect(error).toBeUndefined();
      expect(value.params.volume).toBe(0.8);
    });
  });
});