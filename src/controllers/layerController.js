const Layer = require('../models/Layer');
const TVMultilayer = require('../models/tv.multilayer');
const mqttService = require('../services/multilayer.mqttService');
const Joi = require('joi');

// Validation schemas
const layerSchema = Joi.object({
  tv_id: Joi.string().required(),
  layer_id: Joi.string(),
  name: Joi.string().required(),
  layer_type: Joi.string().valid('DataRow', 'StaticOverlay', 'DynamicText', 'Emergency').default('DataRow'),
  content: Joi.object({
    text: Joi.string().required(),
    backgroundColor: Joi.string().pattern(/^rgba?\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/).default('rgba(0, 0, 0, 0.8)'),
    textColor: Joi.string().pattern(/^rgba?\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/).default('rgba(255, 255, 255, 1)'),
    fontSize: Joi.number().min(10).max(100).default(24),
    fontFamily: Joi.string().default('Arial'),
    padding: Joi.number().min(0).max(50).default(10),
    alignment: Joi.string().valid('left', 'center', 'right').default('left')
  }).required(),
  position: Joi.object({
    x: Joi.number().min(0).required(),
    y: Joi.number().min(0).required(),
    width: Joi.number().min(1).required(),
    height: Joi.number().min(1).required()
  }).required(),
  visible: Joi.boolean().default(true),
  opacity: Joi.number().min(0).max(1).default(1.0),
  priority: Joi.number().min(0).max(255).default(15),
  schedule: Joi.object({
    enabled: Joi.boolean().default(false),
    show_at: Joi.date().iso().allow(null),
    hide_at: Joi.date().iso().allow(null),
    auto_hide_after_ms: Joi.number().min(0).allow(null)
  }).default({})
});

const animationSchema = Joi.object({
  type: Joi.string().valid('slide_up', 'slide_down', 'slide_left', 'slide_right', 'fade_in', 'fade_out', 'move').required(),
  duration: Joi.number().min(100).max(5000).default(500),
  easing: Joi.string().valid('linear', 'ease-in', 'ease-out', 'ease-in-out', 'bounce', 'elastic').default('ease-in-out'),
  distance: Joi.number().min(0).max(500).when('type', {
    is: Joi.string().pattern(/^slide_/),
    then: Joi.required()
  }),
  to_x: Joi.number().min(0).when('type', {
    is: 'move',
    then: Joi.required()
  }),
  to_y: Joi.number().min(0).when('type', {
    is: 'move',
    then: Joi.required()
  })
});

const batchOperationSchema = Joi.object({
  operation: Joi.string().valid('create', 'update', 'delete', 'animate').required(),
  layers: Joi.array().items(
    Joi.when('operation', {
      is: 'create',
      then: layerSchema,
      is: 'update',
      then: Joi.object({
        layer_id: Joi.string().required(),
        updates: Joi.object()
      }),
      is: 'delete',
      then: Joi.string(),
      is: 'animate',
      then: Joi.object({
        layer_id: Joi.string().required(),
        animation: animationSchema
      })
    })
  ).required()
});

class LayerController {
  async getLayersByTv(req, res) {
    const { tv_id } = req.params;
    
    // Verify TV exists
    const tv = await TVMultilayer.findById(tv_id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }
    
    const layers = await Layer.findByTv(tv_id);
    res.json(layers);
  }

  async getLayerById(req, res) {
    const { tv_id, layer_id } = req.params;
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    res.json(layer);
  }

  async createLayer(req, res) {
    const { tv_id } = req.params;
    
    // Verify TV exists and supports layers
    const tv = await TVMultilayer.findById(tv_id);
    if (!tv) {
      return res.status(404).json({ error: 'TV not found' });
    }
    
    if (!tv.hasLayerSupport()) {
      return res.status(400).json({ error: 'TV does not support layers' });
    }
    
    // Validate layer data
    const { error, value } = layerSchema.validate({ ...req.body, tv_id });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    // Check layer limit
    const existingLayers = await Layer.findByTv(tv_id);
    if (existingLayers.length >= tv.config.layer_settings.max_layers) {
      return res.status(400).json({ 
        error: `Maximum layer limit (${tv.config.layer_settings.max_layers}) reached` 
      });
    }
    
    // Create layer
    const layer = new Layer(value);
    await layer.save();
    
    // Publish MQTT event
    if (mqttService.isConnected()) {
      await mqttService.publishLayerUpdate(tv_id, layer.layer_id, 'created', layer);
    }
    
    res.status(201).json(layer);
  }

  async updateLayer(req, res) {
    const { tv_id, layer_id } = req.params;
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    // Update layer
    await layer.update(req.body);
    
    // Publish MQTT event
    if (mqttService.isConnected()) {
      await mqttService.publishLayerUpdate(tv_id, layer_id, 'updated', layer);
    }
    
    res.json(layer);
  }

  async deleteLayer(req, res) {
    const { tv_id, layer_id } = req.params;
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    await layer.delete();
    
    // Publish MQTT event
    if (mqttService.isConnected()) {
      await mqttService.publishLayerUpdate(tv_id, layer_id, 'deleted');
    }
    
    res.json({ message: 'Layer deleted successfully' });
  }

  async animateLayer(req, res) {
    const { tv_id, layer_id } = req.params;
    
    // Validate animation
    const { error, value } = animationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    // Update animation state
    layer.animation_state = {
      active: true,
      type: value.type,
      start_time: new Date().toISOString(),
      duration: value.duration,
      easing: value.easing,
      progress: 0
    };
    
    // Set target position for move animations
    if (value.type === 'move') {
      layer.target_position = {
        x: value.to_x,
        y: value.to_y,
        width: layer.position.width,
        height: layer.position.height
      };
    }
    
    await layer.save();
    
    // Publish MQTT command
    if (mqttService.isConnected()) {
      await mqttService.publishLayerAnimation(tv_id, layer_id, value);
    }
    
    res.json({ 
      message: 'Animation started', 
      layer_id,
      animation: value 
    });
  }

  async toggleLayerVisibility(req, res) {
    const { tv_id, layer_id } = req.params;
    const { visible, transition } = req.body;
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    await layer.setVisibility(visible, transition);
    
    // Publish MQTT event
    if (mqttService.isConnected()) {
      await mqttService.publishLayerVisibility(tv_id, layer_id, visible, transition);
    }
    
    res.json({ 
      message: `Layer ${visible ? 'shown' : 'hidden'}`, 
      layer_id,
      visible 
    });
  }

  async moveLayer(req, res) {
    const { tv_id, layer_id } = req.params;
    const { x, y, animate = false, duration = 500 } = req.body;
    
    if (typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'Invalid position coordinates' });
    }
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    await layer.move(x, y, animate, duration);
    
    // Publish MQTT command
    if (mqttService.isConnected()) {
      await mqttService.publishLayerMove(tv_id, layer_id, x, y, animate, duration);
    }
    
    res.json({ 
      message: 'Layer moved', 
      layer_id,
      position: { x, y },
      animated: animate 
    });
  }

  async updateLayerContent(req, res) {
    const { tv_id, layer_id } = req.params;
    const { content, transition } = req.body;
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    await layer.updateContent(content, transition);
    
    // Publish MQTT event
    if (mqttService.isConnected()) {
      await mqttService.publishLayerContent(tv_id, layer_id, content, transition);
    }
    
    res.json({ 
      message: 'Layer content updated', 
      layer_id,
      content 
    });
  }

  async batchLayerOperation(req, res) {
    const { tv_id } = req.params;
    
    // Validate batch operation
    const { error, value } = batchOperationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const { operation, layers } = value;
    const results = [];
    
    switch (operation) {
      case 'create':
        const created = await Layer.createBatch(layers.map(l => ({ ...l, tv_id })));
        results.push(...created);
        break;
        
      case 'update':
        const updates = layers.map(l => Layer.findById(l.layer_id).then(layer => {
          if (layer && layer.tv_id === tv_id) {
            return layer.update(l.updates);
          }
          return null;
        }));
        const updated = await Promise.all(updates);
        results.push(...updated.filter(Boolean));
        break;
        
      case 'delete':
        const deleted = await Layer.deleteBatch(layers);
        results.push(...deleted);
        break;
        
      case 'animate':
        for (const { layer_id, animation } of layers) {
          const layer = await Layer.findById(layer_id);
          if (layer && layer.tv_id === tv_id) {
            // Start animation
            if (mqttService.isConnected()) {
              await mqttService.publishLayerAnimation(tv_id, layer_id, animation);
            }
            results.push({ layer_id, animation });
          }
        }
        break;
    }
    
    // Publish batch MQTT event
    if (mqttService.isConnected()) {
      await mqttService.publishLayerBatch(tv_id, operation, results);
    }
    
    res.json({ 
      message: `Batch ${operation} completed`, 
      operation,
      results,
      count: results.length 
    });
  }

  async getActiveAnimations(req, res) {
    const { tv_id } = req.params;
    
    const layers = await Layer.findByTv(tv_id);
    const animatingLayers = layers.filter(layer => layer.isAnimating());
    
    res.json({
      tv_id,
      animating_count: animatingLayers.length,
      animations: animatingLayers.map(layer => ({
        layer_id: layer.layer_id,
        animation_type: layer.animation_state.type,
        progress: layer.getAnimationProgress(),
        duration: layer.animation_state.duration
      }))
    });
  }
}

module.exports = new LayerController();