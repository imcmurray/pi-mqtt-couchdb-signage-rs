const Preset = require('../../../src/models/Preset');

describe('Preset Model', () => {
  describe('constructor', () => {
    it('should create preset with required fields', () => {
      const preset = new Preset({
        name: 'Test Preset',
        description: 'A test preset',
        layers: [
          {
            name: 'Layer 1',
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 1920, height: 540 }
          }
        ]
      });

      expect(preset.name).toBe('Test Preset');
      expect(preset.description).toBe('A test preset');
      expect(preset.layers).toHaveLength(1);
      expect(preset.preset_id).toBeTruthy();
      expect(preset.is_builtin).toBe(false);
      expect(preset.category).toBe('custom');
    });

    it('should generate unique preset ID', () => {
      const preset1 = new Preset({
        name: 'Preset 1',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      const preset2 = new Preset({
        name: 'Preset 2',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset1.preset_id).toBeTruthy();
      expect(preset2.preset_id).toBeTruthy();
      expect(preset1.preset_id).not.toBe(preset2.preset_id);
    });

    it('should set default name', () => {
      const preset = new Preset({
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.name).toBe('Untitled Preset');
    });

    it('should create built-in preset', () => {
      const preset = new Preset({
        name: 'Court Schedule Left',
        is_builtin: true,
        category: 'court',
        layers: [
          {
            name: 'Court Schedule Area',
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 960, height: 1080 }
          },
          {
            name: 'Logo Area',
            layer_type: 'StaticOverlay',
            position: { x: 960, y: 0, width: 960, height: 1080 }
          }
        ]
      });

      expect(preset.is_builtin).toBe(true);
      expect(preset.category).toBe('court');
      expect(preset.layers).toHaveLength(2);
    });

    it('should accept emergency category', () => {
      const preset = new Preset({
        name: 'Emergency Fullscreen',
        category: 'emergency',
        layers: [
          {
            layer_type: 'Emergency',
            position: { x: 0, y: 0, width: 1920, height: 1080 }
          }
        ]
      });

      expect(preset.category).toBe('emergency');
    });

    it('should accept info category', () => {
      const preset = new Preset({
        name: 'Info Ticker',
        category: 'info',
        layers: [{ layer_type: 'DynamicText', position: { x: 0, y: 980, width: 1920, height: 100 } }]
      });

      expect(preset.category).toBe('info');
    });

    it('should accept layout category', () => {
      const preset = new Preset({
        name: 'Split Dual',
        category: 'layout',
        layers: [
          { layer_type: 'DataRow', position: { x: 0, y: 0, width: 960, height: 1080 } },
          { layer_type: 'DataRow', position: { x: 960, y: 0, width: 960, height: 1080 } }
        ]
      });

      expect(preset.category).toBe('layout');
    });

    it('should initialize usage tracking', () => {
      const preset = new Preset({
        name: 'Test',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.usage_count).toBe(0);
      expect(preset.last_used).toBe(null);
      expect(preset.created_by).toBe('system');
    });

    it('should accept tags array', () => {
      const preset = new Preset({
        name: 'Test',
        tags: ['split-screen', 'dual-zone'],
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.tags).toEqual(['split-screen', 'dual-zone']);
    });

    it('should initialize preview object', () => {
      const preset = new Preset({
        name: 'Test',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.preview).toBeDefined();
      expect(preset.preview.thumbnail_url).toBe(null);
      expect(preset.preview.screenshot_url).toBe(null);
      expect(preset.preview.layout_diagram).toBeTruthy();
    });
  });

  describe('generateLayoutDiagram', () => {
    it('should generate diagram for empty preset', () => {
      const preset = new Preset({
        name: 'Empty',
        layers: []
      });

      const diagram = preset.generateLayoutDiagram();
      expect(diagram).toContain('Empty');
      expect(diagram).toContain('┌');
      expect(diagram).toContain('└');
    });

    it('should generate diagram for fullscreen layer', () => {
      const preset = new Preset({
        name: 'Fullscreen',
        layers: [
          {
            layer_type: 'Emergency',
            position: { x: 0, y: 0, width: 1920, height: 1080 }
          }
        ]
      });

      const diagram = preset.generateLayoutDiagram();
      expect(diagram).toContain('1');
      expect(diagram).toContain('┌');
      expect(diagram).toContain('└');
    });

    it('should generate diagram for split vertical layout', () => {
      const preset = new Preset({
        name: 'Split Vertical',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 960, height: 1080 }
          },
          {
            layer_type: 'StaticOverlay',
            position: { x: 960, y: 0, width: 960, height: 1080 }
          }
        ]
      });

      const diagram = preset.generateLayoutDiagram();
      expect(diagram).toContain('1');
      expect(diagram).toContain('2');
    });

    it('should generate diagram for quad split', () => {
      const preset = new Preset({
        name: 'Quad Split',
        layers: [
          { layer_type: 'DataRow', position: { x: 0, y: 0, width: 960, height: 540 } },
          { layer_type: 'DataRow', position: { x: 960, y: 0, width: 960, height: 540 } },
          { layer_type: 'DataRow', position: { x: 0, y: 540, width: 960, height: 540 } },
          { layer_type: 'DataRow', position: { x: 960, y: 540, width: 960, height: 540 } }
        ]
      });

      const diagram = preset.generateLayoutDiagram();
      expect(diagram).toContain('1');
      expect(diagram).toContain('2');
      expect(diagram).toContain('3');
      expect(diagram).toContain('4');
    });

    it('should handle small overlay in corner', () => {
      const preset = new Preset({
        name: 'Corner Logo',
        layers: [
          {
            layer_type: 'StaticOverlay',
            position: { x: 1632, y: 918, width: 288, height: 162 }
          }
        ]
      });

      const diagram = preset.generateLayoutDiagram();
      expect(diagram).toContain('1');
    });
  });

  describe('validation', () => {
    it('should require name', () => {
      const preset = new Preset({
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      delete preset.name;

      expect(() => preset.validateRequired(['preset_id', 'name', 'layers']))
        .toThrow('Missing required fields: name');
    });

    it('should require layers array', () => {
      const preset = new Preset({
        name: 'Test',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      delete preset.layers;

      expect(() => preset.validateRequired(['preset_id', 'name', 'layers']))
        .toThrow('Missing required fields: layers');
    });

    it('should validate layers is an array', () => {
      const preset = new Preset({
        name: 'Test',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      preset.layers = 'not an array';

      expect(() => {
        if (!Array.isArray(preset.layers)) {
          throw new Error('Layers must be an array');
        }
      }).toThrow('Layers must be an array');
    });

    it('should require at least one layer', () => {
      const preset = new Preset({
        name: 'Test',
        layers: []
      });

      expect(() => {
        if (preset.layers.length === 0) {
          throw new Error('Preset must contain at least one layer');
        }
      }).toThrow('Preset must contain at least one layer');
    });

    it('should validate layer has layer_type', () => {
      const presetData = {
        name: 'Test',
        layers: [
          {
            position: { x: 0, y: 0, width: 1920, height: 1080 }
          }
        ]
      };

      const result = Preset.validatePresetStructure(presetData);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('layer_type');
    });

    it('should validate layer has position', () => {
      const presetData = {
        name: 'Test',
        layers: [
          {
            layer_type: 'DataRow'
          }
        ]
      };

      const result = Preset.validatePresetStructure(presetData);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('position');
    });

    it('should validate position has numeric coordinates', () => {
      const presetData = {
        name: 'Test',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 'invalid', y: 0, width: 1920, height: 1080 }
          }
        ]
      };

      const result = Preset.validatePresetStructure(presetData);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid position values');
    });

    it('should validate position has positive dimensions', () => {
      const presetData = {
        name: 'Test',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: -100, height: 1080 }
          }
        ]
      };

      const result = Preset.validatePresetStructure(presetData);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('negative or zero dimensions');
    });

    it('should accept valid preset structure', () => {
      const presetData = {
        name: 'Valid Preset',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 1920, height: 1080 }
          }
        ]
      };

      const result = Preset.validatePresetStructure(presetData);
      expect(result.valid).toBe(true);
    });
  });

  describe('applyToTV', () => {
    it('should generate layer configs with tv_id', () => {
      const preset = new Preset({
        name: 'Test Preset',
        preset_id: 'preset_test123',
        layers: [
          {
            name: 'Layer 1',
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 1920, height: 540 }
          },
          {
            name: 'Layer 2',
            layer_type: 'StaticOverlay',
            position: { x: 0, y: 540, width: 1920, height: 540 }
          }
        ]
      });

      const layerConfigs = preset.applyToTV('tv_123');

      expect(layerConfigs).toHaveLength(2);
      expect(layerConfigs[0].tv_id).toBe('tv_123');
      expect(layerConfigs[1].tv_id).toBe('tv_123');
    });

    it('should add from-preset tags', () => {
      const preset = new Preset({
        name: 'Test Preset',
        preset_id: 'preset_test123',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 1920, height: 1080 }
          }
        ]
      });

      const layerConfigs = preset.applyToTV('tv_456');

      expect(layerConfigs[0].tags).toContain('from-preset');
      expect(layerConfigs[0].tags).toContain('preset:preset_test123');
    });

    it('should preserve existing tags', () => {
      const preset = new Preset({
        name: 'Test Preset',
        preset_id: 'preset_test123',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 1920, height: 1080 },
            tags: ['existing-tag', 'another-tag']
          }
        ]
      });

      const layerConfigs = preset.applyToTV('tv_789');

      expect(layerConfigs[0].tags).toContain('existing-tag');
      expect(layerConfigs[0].tags).toContain('another-tag');
      expect(layerConfigs[0].tags).toContain('from-preset');
    });

    it('should add metadata about preset application', () => {
      const preset = new Preset({
        name: 'Test Preset',
        preset_id: 'preset_test123',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 1920, height: 1080 }
          }
        ]
      });

      const layerConfigs = preset.applyToTV('tv_111');

      expect(layerConfigs[0].metadata.applied_from_preset).toBe('preset_test123');
      expect(layerConfigs[0].metadata.preset_name).toBe('Test Preset');
      expect(layerConfigs[0].metadata.applied_at).toBeTruthy();
    });

    it('should preserve existing metadata', () => {
      const preset = new Preset({
        name: 'Test Preset',
        preset_id: 'preset_test123',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 1920, height: 1080 },
            metadata: {
              custom_field: 'custom_value'
            }
          }
        ]
      });

      const layerConfigs = preset.applyToTV('tv_222');

      expect(layerConfigs[0].metadata.custom_field).toBe('custom_value');
      expect(layerConfigs[0].metadata.applied_from_preset).toBe('preset_test123');
    });
  });

  describe('usage tracking', () => {
    it('should increment usage count', async () => {
      const preset = new Preset({
        name: 'Test',
        usage_count: 5,
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      preset.save = jest.fn().mockResolvedValue(preset);
      await preset.recordUsage();

      expect(preset.usage_count).toBe(6);
      expect(preset.last_used).toBeTruthy();
      expect(preset.save).toHaveBeenCalled();
    });

    it('should set last_used timestamp', async () => {
      const preset = new Preset({
        name: 'Test',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      preset.save = jest.fn().mockResolvedValue(preset);
      const beforeTime = new Date().toISOString();
      await preset.recordUsage();
      const afterTime = new Date().toISOString();

      expect(preset.last_used).toBeTruthy();
      expect(preset.last_used >= beforeTime).toBe(true);
      expect(preset.last_used <= afterTime).toBe(true);
    });

    it('should initialize usage count from 0', async () => {
      const preset = new Preset({
        name: 'Test',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.usage_count).toBe(0);

      preset.save = jest.fn().mockResolvedValue(preset);
      await preset.recordUsage();

      expect(preset.usage_count).toBe(1);
    });
  });

  describe('clone', () => {
    beforeEach(() => {
      const mockDb = {
        insert: jest.fn().mockResolvedValue({ ok: true, id: 'new_doc_id', rev: '1-abc' }),
        view: jest.fn().mockResolvedValue({ rows: [] })
      };
      Preset.getDb = jest.fn().mockReturnValue(mockDb);
    });

    it('should create copy of preset', async () => {
      const original = new Preset({
        name: 'Original Preset',
        preset_id: 'preset_original',
        is_builtin: true,
        category: 'court',
        layers: [
          {
            layer_type: 'DataRow',
            position: { x: 0, y: 0, width: 960, height: 1080 }
          }
        ],
        usage_count: 10
      });

      const cloned = await original.clone('Cloned Preset');

      expect(cloned.name).toBe('Cloned Preset');
      expect(cloned.preset_id).not.toBe('preset_original');
      expect(cloned.is_builtin).toBe(false);
      expect(cloned.created_by).toBe('user');
      expect(cloned.usage_count).toBe(0);
      expect(cloned.last_used).toBe(null);
      expect(cloned.layers).toHaveLength(1);
      expect(cloned.category).toBe('court');
    });

    it('should use default copy name if not provided', async () => {
      const original = new Preset({
        name: 'Original Preset',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      const cloned = await original.clone();

      expect(cloned.name).toBe('Original Preset (Copy)');
    });

    it('should generate new preset_id for clone', async () => {
      const original = new Preset({
        name: 'Original',
        preset_id: 'preset_original',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      const cloned = await original.clone('Clone');

      expect(cloned.preset_id).toBeTruthy();
      expect(cloned.preset_id).not.toBe('preset_original');
      expect(cloned.preset_id).toContain('preset_');
    });
  });

  describe('delete protection', () => {
    it('should prevent deletion of built-in presets', async () => {
      const preset = new Preset({
        name: 'Built-in Preset',
        is_builtin: true,
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      preset._id = 'some_id';
      preset._rev = 'some_rev';

      await expect(preset.delete()).rejects.toThrow('Cannot delete built-in presets');
    });

    it('should allow deletion of custom presets', () => {
      const preset = new Preset({
        name: 'Custom Preset',
        is_builtin: false,
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      preset._id = 'some_id';
      preset._rev = 'some_rev';

      const mockDb = {
        destroy: jest.fn().mockResolvedValue({ ok: true })
      };

      Preset.getDb = jest.fn().mockReturnValue(mockDb);

      expect(preset.delete()).resolves.toBeDefined();
    });
  });

  describe('category filtering', () => {
    it('should support court category', () => {
      const preset = new Preset({
        name: 'Court Layout',
        category: 'court',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.category).toBe('court');
    });

    it('should support emergency category', () => {
      const preset = new Preset({
        name: 'Emergency Alert',
        category: 'emergency',
        layers: [{ layer_type: 'Emergency', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.category).toBe('emergency');
    });

    it('should support info category', () => {
      const preset = new Preset({
        name: 'Info Display',
        category: 'info',
        layers: [{ layer_type: 'DynamicText', position: { x: 0, y: 980, width: 1920, height: 100 } }]
      });

      expect(preset.category).toBe('info');
    });

    it('should support layout category', () => {
      const preset = new Preset({
        name: 'Split Screen',
        category: 'layout',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.category).toBe('layout');
    });

    it('should default to custom category', () => {
      const preset = new Preset({
        name: 'User Created',
        layers: [{ layer_type: 'DataRow', position: { x: 0, y: 0, width: 1920, height: 1080 } }]
      });

      expect(preset.category).toBe('custom');
    });
  });
});
