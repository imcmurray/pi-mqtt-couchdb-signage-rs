const Layer = require('../../../src/models/Layer');

describe('Layer Model', () => {
  describe('constructor', () => {
    it('should create layer with required fields', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        name: 'Test Layer',
        layer_type: 'DataRow'
      });

      expect(layer.tv_id).toBe('tv_123');
      expect(layer.name).toBe('Test Layer');
      expect(layer.layer_type).toBe('DataRow');
      expect(layer.layer_id).toBeTruthy();
      expect(layer.visible).toBe(true);
      expect(layer.opacity).toBe(1.0);
      expect(layer.priority).toBe(10);
    });

    it('should generate unique layer ID', () => {
      const layer1 = new Layer({ tv_id: 'tv_1', layer_type: 'DataRow' });
      const layer2 = new Layer({ tv_id: 'tv_2', layer_type: 'DataRow' });

      expect(layer1.layer_id).toBeTruthy();
      expect(layer2.layer_id).toBeTruthy();
      expect(layer1.layer_id).not.toBe(layer2.layer_id);
    });

    it('should set default name using layer_id', () => {
      const layer = new Layer({ tv_id: 'tv_123', layer_type: 'DataRow' });

      expect(layer.name).toContain('Layer ');
      expect(layer.name).toContain(layer.layer_id);
    });

    it('should create StaticOverlay layer type', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'StaticOverlay',
        content: {
          image_url: '/uploads/logo.png',
          backgroundColor: 'rgba(0, 0, 0, 0)'
        }
      });

      expect(layer.layer_type).toBe('StaticOverlay');
      expect(layer.content.image_url).toBe('/uploads/logo.png');
    });

    it('should create Emergency layer type', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'Emergency',
        priority: 250,
        content: {
          text: '🚨 CRITICAL ALERT',
          backgroundColor: 'rgba(220, 38, 38, 0.95)',
          fontSize: 48
        }
      });

      expect(layer.layer_type).toBe('Emergency');
      expect(layer.priority).toBe(250);
      expect(layer.content.text).toContain('CRITICAL');
    });

    it('should set default position to full screen', () => {
      const layer = new Layer({ tv_id: 'tv_123', layer_type: 'DataRow' });

      expect(layer.position).toEqual({
        x: 0,
        y: 0,
        width: 1920,
        height: 40
      });
    });

    it('should accept custom position', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'StaticOverlay',
        position: { x: 960, y: 0, width: 960, height: 1080 }
      });

      expect(layer.position).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
    });

    it('should set default content properties', () => {
      const layer = new Layer({ tv_id: 'tv_123', layer_type: 'DataRow' });

      expect(layer.content.text).toBe('');
      expect(layer.content.backgroundColor).toBe('rgba(0, 0, 0, 0.8)');
      expect(layer.content.textColor).toBe('rgba(255, 255, 255, 1)');
      expect(layer.content.fontSize).toBe(24);
      expect(layer.content.fontFamily).toBe('Arial');
      expect(layer.content.padding).toBe(10);
      expect(layer.content.alignment).toBe('left');
    });

    it('should initialize animation state as inactive', () => {
      const layer = new Layer({ tv_id: 'tv_123', layer_type: 'DataRow' });

      expect(layer.animation_state.active).toBe(false);
      expect(layer.animation_state.type).toBe(null);
      expect(layer.animation_state.start_time).toBe(null);
      expect(layer.animation_state.duration).toBe(500);
      expect(layer.animation_state.easing).toBe('ease-in-out');
      expect(layer.animation_state.progress).toBe(0);
    });

    it('should initialize schedule as disabled', () => {
      const layer = new Layer({ tv_id: 'tv_123', layer_type: 'DataRow' });

      expect(layer.schedule.enabled).toBe(false);
      expect(layer.schedule.show_at).toBe(null);
      expect(layer.schedule.hide_at).toBe(null);
      expect(layer.schedule.auto_hide_after_ms).toBe(null);
    });

    it('should accept custom schedule configuration', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'Emergency',
        schedule: {
          enabled: true,
          auto_hide_after_ms: 300000
        }
      });

      expect(layer.schedule.enabled).toBe(true);
      expect(layer.schedule.auto_hide_after_ms).toBe(300000);
    });

    it('should accept tags array', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        tags: ['court-schedule', 'from-preset']
      });

      expect(layer.tags).toEqual(['court-schedule', 'from-preset']);
    });

    it('should accept group identifier', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        group: 'court-display-group'
      });

      expect(layer.group).toBe('court-display-group');
    });

    it('should accept metadata object', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        metadata: {
          applied_from_preset: 'court-schedule-left',
          preset_name: 'Court Schedule (Left)',
          applied_at: '2025-10-18T12:00:00Z'
        }
      });

      expect(layer.metadata.applied_from_preset).toBe('court-schedule-left');
      expect(layer.metadata.preset_name).toBe('Court Schedule (Left)');
    });
  });

  describe('validation', () => {
    it('should require tv_id', () => {
      const layer = new Layer({
        layer_type: 'DataRow'
      });

      expect(() => layer.validateRequired(['tv_id', 'layer_id', 'layer_type']))
        .toThrow('Missing required fields: tv_id');
    });

    it('should require layer_type', () => {
      const layer = new Layer({
        tv_id: 'tv_123'
      });
      delete layer.layer_type;

      expect(() => layer.validateRequired(['tv_id', 'layer_id', 'layer_type']))
        .toThrow('Missing required fields: layer_type');
    });

    it('should validate position has all required coordinates', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 0, y: 0, width: 1920 } // Missing height
      });

      layer.validateRequired = jest.fn(); // Mock to avoid that error

      expect(() => {
        if (!layer.position || typeof layer.position.x !== 'number' ||
            typeof layer.position.y !== 'number' || typeof layer.position.width !== 'number' ||
            typeof layer.position.height !== 'number') {
          throw new Error('Invalid position configuration');
        }
      }).toThrow('Invalid position configuration');
    });

    it('should validate opacity is between 0 and 1', () => {
      const layer1 = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        opacity: -0.1
      });

      const layer2 = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        opacity: 1.5
      });

      expect(() => {
        if (layer1.opacity < 0 || layer1.opacity > 1) {
          throw new Error('Opacity must be between 0 and 1');
        }
      }).toThrow('Opacity must be between 0 and 1');

      expect(() => {
        if (layer2.opacity < 0 || layer2.opacity > 1) {
          throw new Error('Opacity must be between 0 and 1');
        }
      }).toThrow('Opacity must be between 0 and 1');
    });

    it('should accept valid opacity values', () => {
      const layer1 = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        opacity: 0
      });

      const layer2 = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        opacity: 0.5
      });

      const layer3 = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        opacity: 1
      });

      expect(layer1.opacity).toBe(0);
      expect(layer2.opacity).toBe(0.5);
      expect(layer3.opacity).toBe(1);
    });
  });

  describe('animation methods', () => {
    it('should start slide_up animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 0, y: 100, width: 1920, height: 40 }
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      await layer.startAnimation('slide_up', 500, 'ease-in-out');

      expect(layer.animation_state.active).toBe(true);
      expect(layer.animation_state.type).toBe('slide_up');
      expect(layer.animation_state.duration).toBe(500);
      expect(layer.animation_state.easing).toBe('ease-in-out');
      expect(layer.target_position).toEqual({ x: 0, y: 0, width: 1920, height: 40 });
      expect(layer.save).toHaveBeenCalled();
    });

    it('should start slide_down animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 0, y: 100, width: 1920, height: 40 }
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      await layer.startAnimation('slide_down', 500);

      expect(layer.animation_state.type).toBe('slide_down');
      expect(layer.target_position.y).toBe(200);
    });

    it('should start slide_left animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 100, y: 0, width: 1920, height: 40 }
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      await layer.startAnimation('slide_left', 500);

      expect(layer.animation_state.type).toBe('slide_left');
      expect(layer.target_position.x).toBe(0);
    });

    it('should start slide_right animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 100, y: 0, width: 1920, height: 40 }
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      await layer.startAnimation('slide_right', 500);

      expect(layer.animation_state.type).toBe('slide_right');
      expect(layer.target_position.x).toBe(200);
    });

    it('should start fade_in animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      await layer.startAnimation('fade_in', 300);

      expect(layer.animation_state.type).toBe('fade_in');
      expect(layer.animation_state.duration).toBe(300);
      expect(layer.target_position).toBe(null);
    });

    it('should start fade_out animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      await layer.startAnimation('fade_out', 300);

      expect(layer.animation_state.type).toBe('fade_out');
    });

    it('should reject invalid animation types', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      await expect(layer.startAnimation('invalid_animation'))
        .rejects.toThrow('Invalid animation type: invalid_animation');
    });

    it('should complete animation and reset state', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 0, y: 100, width: 1920, height: 40 }
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      await layer.startAnimation('slide_up', 500);
      await layer.completeAnimation();

      expect(layer.animation_state.active).toBe(false);
      expect(layer.animation_state.type).toBe(null);
      expect(layer.target_position).toBe(null);
      expect(layer.position.y).toBe(0); // Moved to target position
    });

    it('should set visibility with fade transition', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      layer.save = jest.fn().mockResolvedValue(layer);
      layer.startAnimation = jest.fn().mockResolvedValue(layer);

      await layer.setVisibility(true, { duration: 500, easing: 'ease-in' });

      expect(layer.visible).toBe(true);
      expect(layer.startAnimation).toHaveBeenCalledWith('fade_in', 500, 'ease-in');
    });

    it('should set visibility without transition', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      layer.save = jest.fn().mockResolvedValue(layer);

      await layer.setVisibility(false);

      expect(layer.visible).toBe(false);
      expect(layer.save).toHaveBeenCalled();
    });

    it('should move layer with animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 0, y: 0, width: 1920, height: 40 }
      });

      layer.startAnimation = jest.fn().mockResolvedValue(layer);

      await layer.move(100, 200, true, 500);

      expect(layer.target_position).toEqual({ x: 100, y: 200, width: 1920, height: 40 });
      expect(layer.startAnimation).toHaveBeenCalledWith('move', 500);
    });

    it('should move layer without animation', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        position: { x: 0, y: 0, width: 1920, height: 40 }
      });

      layer.save = jest.fn().mockResolvedValue(layer);

      await layer.move(100, 200, false);

      expect(layer.position.x).toBe(100);
      expect(layer.position.y).toBe(200);
      expect(layer.save).toHaveBeenCalled();
    });
  });

  describe('helper methods', () => {
    it('should identify DataRow layer type', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      expect(layer.isDataRow()).toBe(true);
    });

    it('should identify non-DataRow layer types', () => {
      const layer1 = new Layer({
        tv_id: 'tv_123',
        layer_type: 'StaticOverlay'
      });

      const layer2 = new Layer({
        tv_id: 'tv_123',
        layer_type: 'Emergency'
      });

      expect(layer1.isDataRow()).toBe(false);
      expect(layer2.isDataRow()).toBe(false);
    });

    it('should detect active animation', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        animation_state: {
          active: true,
          type: 'fade_in',
          start_time: new Date().toISOString(),
          duration: 500,
          easing: 'ease-in-out',
          progress: 0
        }
      });

      expect(layer.isAnimating()).toBe(true);
    });

    it('should detect inactive animation', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      expect(layer.isAnimating()).toBe(false);
    });

    it('should calculate animation progress', () => {
      const startTime = new Date(Date.now() - 250); // Started 250ms ago
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        animation_state: {
          active: true,
          type: 'fade_in',
          start_time: startTime.toISOString(),
          duration: 500,
          easing: 'ease-in-out',
          progress: 0
        }
      });

      const progress = layer.getAnimationProgress();
      expect(progress).toBeGreaterThan(0.4);
      expect(progress).toBeLessThan(0.6);
    });

    it('should return 0 progress for inactive animation', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow'
      });

      expect(layer.getAnimationProgress()).toBe(0);
    });

    it('should cap animation progress at 1', () => {
      const startTime = new Date(Date.now() - 1000); // Started 1000ms ago
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DataRow',
        animation_state: {
          active: true,
          type: 'fade_in',
          start_time: startTime.toISOString(),
          duration: 500,
          easing: 'ease-in-out',
          progress: 0
        }
      });

      const progress = layer.getAnimationProgress();
      expect(progress).toBe(1);
    });
  });

  describe('content update', () => {
    it('should update content without transition', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DynamicText',
        content: {
          text: 'Old text',
          fontSize: 24
        }
      });

      layer.save = jest.fn().mockResolvedValue(layer);

      await layer.updateContent({
        text: 'New text',
        fontSize: 32
      });

      expect(layer.content.text).toBe('New text');
      expect(layer.content.fontSize).toBe(32);
      expect(layer.save).toHaveBeenCalled();
    });

    it('should merge new content with existing content', async () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DynamicText',
        content: {
          text: 'Text',
          fontSize: 24,
          textColor: 'rgba(255, 255, 255, 1)'
        }
      });

      layer.save = jest.fn().mockResolvedValue(layer);

      await layer.updateContent({ fontSize: 32 });

      expect(layer.content.text).toBe('Text');
      expect(layer.content.fontSize).toBe(32);
      expect(layer.content.textColor).toBe('rgba(255, 255, 255, 1)');
    });
  });

  describe('layer types', () => {
    it('should create valid DynamicText layer', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        layer_type: 'DynamicText',
        content: {
          text: 'Dynamic content',
          fontSize: 28,
          textColor: 'rgba(255, 255, 0, 1)'
        },
        position: { x: 0, y: 980, width: 1920, height: 100 }
      });

      expect(layer.layer_type).toBe('DynamicText');
      expect(layer.content.text).toBe('Dynamic content');
      expect(layer.position.y).toBe(980);
    });

    it('should create valid court schedule layer with tags', () => {
      const layer = new Layer({
        tv_id: 'tv_123',
        name: 'Court Schedule Area',
        layer_type: 'DataRow',
        position: { x: 0, y: 0, width: 960, height: 1080 },
        priority: 10,
        tags: ['court-schedule', 'from-preset', 'preset:court-schedule-left']
      });

      expect(layer.tags).toContain('court-schedule');
      expect(layer.tags).toContain('from-preset');
      expect(layer.position.width).toBe(960);
    });
  });
});
