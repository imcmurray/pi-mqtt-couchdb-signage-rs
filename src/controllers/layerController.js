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
  /**
   * @openapi
   * /api/layers/tv/{tv_id}:
   *   get:
   *     summary: Get all layers for a TV
   *     description: Returns all layers configured for a specific TV display
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         description: TV identifier
   *         example: tv-001
   *     responses:
   *       200:
   *         description: List of layers
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Layer'
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/layer/{layer_id}:
   *   get:
   *     summary: Get layer by ID
   *     description: Returns a specific layer configuration
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *       - in: path
   *         name: layer_id
   *         required: true
   *         schema:
   *           type: string
   *         example: layer-header-001
   *     responses:
   *       200:
   *         description: Layer found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Layer'
   *       404:
   *         description: Layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async getLayerById(req, res) {
    const { tv_id, layer_id } = req.params;
    
    const layer = await Layer.findById(layer_id);
    if (!layer || layer.tv_id !== tv_id) {
      return res.status(404).json({ error: 'Layer not found' });
    }
    
    res.json(layer);
  }

  /**
   * @openapi
   * /api/layers/tv/{tv_id}:
   *   post:
   *     summary: Create new layer
   *     description: Creates a new compositing layer on a TV display with content, position, and styling
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - content
   *               - position
   *             properties:
   *               name:
   *                 type: string
   *                 example: Top Banner
   *               layer_type:
   *                 type: string
   *                 enum: [DataRow, StaticOverlay, DynamicText, Emergency]
   *                 default: DataRow
   *               content:
   *                 type: object
   *                 required:
   *                   - text
   *                 properties:
   *                   text:
   *                     type: string
   *                     example: Court is now in session
   *                   backgroundColor:
   *                     type: string
   *                     pattern: '^rgba?\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$'
   *                     default: rgba(0, 0, 0, 0.8)
   *                   textColor:
   *                     type: string
   *                     default: rgba(255, 255, 255, 1)
   *                   fontSize:
   *                     type: integer
   *                     minimum: 10
   *                     maximum: 100
   *                     default: 24
   *                   fontFamily:
   *                     type: string
   *                     default: Arial
   *                   padding:
   *                     type: integer
   *                     default: 10
   *                   alignment:
   *                     type: string
   *                     enum: [left, center, right]
   *                     default: left
   *               position:
   *                 $ref: '#/components/schemas/Position'
   *               visible:
   *                 type: boolean
   *                 default: true
   *               opacity:
   *                 type: number
   *                 minimum: 0
   *                 maximum: 1
   *                 default: 1.0
   *               priority:
   *                 type: integer
   *                 minimum: 0
   *                 maximum: 255
   *                 default: 15
   *     responses:
   *       201:
   *         description: Layer created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Layer'
   *       400:
   *         description: Validation error or layer limit reached
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: TV not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/layer/{layer_id}:
   *   put:
   *     summary: Update layer
   *     description: Updates an existing layer's properties (content, position, styling, etc.)
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *       - in: path
   *         name: layer_id
   *         required: true
   *         schema:
   *           type: string
   *         example: layer-header-001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               content:
   *                 type: object
   *               position:
   *                 $ref: '#/components/schemas/Position'
   *               visible:
   *                 type: boolean
   *               opacity:
   *                 type: number
   *               priority:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Layer updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Layer'
   *       404:
   *         description: Layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/layer/{layer_id}:
   *   delete:
   *     summary: Delete layer
   *     description: Removes a layer from the TV display
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *       - in: path
   *         name: layer_id
   *         required: true
   *         schema:
   *           type: string
   *         example: layer-header-001
   *     responses:
   *       200:
   *         description: Layer deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Layer deleted successfully
   *       404:
   *         description: Layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/layer/{layer_id}/animate:
   *   post:
   *     summary: Animate layer
   *     description: Applies an animation effect to a layer (slide, fade, move)
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *       - in: path
   *         name: layer_id
   *         required: true
   *         schema:
   *           type: string
   *         example: layer-header-001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - type
   *             properties:
   *               type:
   *                 type: string
   *                 enum: [slide_up, slide_down, slide_left, slide_right, fade_in, fade_out, move]
   *                 example: slide_down
   *               duration:
   *                 type: integer
   *                 minimum: 100
   *                 maximum: 5000
   *                 default: 500
   *                 description: Animation duration in milliseconds
   *               easing:
   *                 type: string
   *                 enum: [linear, ease-in, ease-out, ease-in-out, bounce, elastic]
   *                 default: ease-in-out
   *               distance:
   *                 type: integer
   *                 minimum: 0
   *                 maximum: 500
   *                 description: Distance for slide animations (required for slide_* types)
   *               to_x:
   *                 type: integer
   *                 description: Target X position for move animations (required for move type)
   *               to_y:
   *                 type: integer
   *                 description: Target Y position for move animations (required for move type)
   *     responses:
   *       200:
   *         description: Animation started
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Animation started
   *                 layer_id:
   *                   type: string
   *                 animation:
   *                   type: object
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: Layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/layer/{layer_id}/visibility:
   *   post:
   *     summary: Toggle layer visibility
   *     description: Show or hide a layer with optional transition effect
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *       - in: path
   *         name: layer_id
   *         required: true
   *         schema:
   *           type: string
   *         example: layer-header-001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - visible
   *             properties:
   *               visible:
   *                 type: boolean
   *                 description: Show or hide the layer
   *                 example: true
   *               transition:
   *                 type: string
   *                 enum: [fade, slide, instant]
   *                 description: Transition effect type
   *                 example: fade
   *     responses:
   *       200:
   *         description: Visibility updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Layer shown
   *                 layer_id:
   *                   type: string
   *                 visible:
   *                   type: boolean
   *       404:
   *         description: Layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/layer/{layer_id}/move:
   *   post:
   *     summary: Move layer
   *     description: Moves a layer to a new position with optional animation
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *       - in: path
   *         name: layer_id
   *         required: true
   *         schema:
   *           type: string
   *         example: layer-header-001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - x
   *               - y
   *             properties:
   *               x:
   *                 type: integer
   *                 minimum: 0
   *                 description: New X position
   *                 example: 100
   *               y:
   *                 type: integer
   *                 minimum: 0
   *                 description: New Y position
   *                 example: 200
   *               animate:
   *                 type: boolean
   *                 default: false
   *                 description: Animate the movement
   *               duration:
   *                 type: integer
   *                 default: 500
   *                 description: Animation duration in milliseconds
   *     responses:
   *       200:
   *         description: Layer moved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Layer moved
   *                 layer_id:
   *                   type: string
   *                 position:
   *                   type: object
   *                   properties:
   *                     x:
   *                       type: integer
   *                     y:
   *                       type: integer
   *                 animated:
   *                   type: boolean
   *       400:
   *         description: Invalid coordinates
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   *       404:
   *         description: Layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/layer/{layer_id}/content:
   *   put:
   *     summary: Update layer content
   *     description: Updates the content (text, styling) of a layer with optional transition
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *       - in: path
   *         name: layer_id
   *         required: true
   *         schema:
   *           type: string
   *         example: layer-header-001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - content
   *             properties:
   *               content:
   *                 type: object
   *                 properties:
   *                   text:
   *                     type: string
   *                     example: Updated court information
   *                   backgroundColor:
   *                     type: string
   *                   textColor:
   *                     type: string
   *                   fontSize:
   *                     type: integer
   *               transition:
   *                 type: string
   *                 enum: [fade, cross-fade, instant]
   *                 description: Content transition effect
   *     responses:
   *       200:
   *         description: Content updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Layer content updated
   *                 layer_id:
   *                   type: string
   *                 content:
   *                   type: object
   *       404:
   *         description: Layer not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/batch:
   *   post:
   *     summary: Batch layer operation
   *     description: Performs create, update, delete, or animate operations on multiple layers at once
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - operation
   *               - layers
   *             properties:
   *               operation:
   *                 type: string
   *                 enum: [create, update, delete, animate]
   *                 description: Type of batch operation
   *                 example: create
   *               layers:
   *                 type: array
   *                 description: Array of layers or layer IDs depending on operation
   *                 items:
   *                   oneOf:
   *                     - $ref: '#/components/schemas/Layer'
   *                     - type: string
   *                     - type: object
   *     responses:
   *       200:
   *         description: Batch operation completed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Batch create completed
   *                 operation:
   *                   type: string
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                 count:
   *                   type: integer
   *       400:
   *         description: Validation error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ValidationError'
   */
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

  /**
   * @openapi
   * /api/layers/tv/{tv_id}/animations:
   *   get:
   *     summary: Get active animations
   *     description: Returns all currently running animations on a TV's layers
   *     tags:
   *       - Layers
   *     parameters:
   *       - in: path
   *         name: tv_id
   *         required: true
   *         schema:
   *           type: string
   *         example: tv-001
   *     responses:
   *       200:
   *         description: Active animations list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tv_id:
   *                   type: string
   *                 animating_count:
   *                   type: integer
   *                   example: 2
   *                 animations:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       layer_id:
   *                         type: string
   *                       animation_type:
   *                         type: string
   *                       progress:
   *                         type: number
   *                         minimum: 0
   *                         maximum: 1
   *                       duration:
   *                         type: integer
   */
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