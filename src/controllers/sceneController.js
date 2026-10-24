const Joi = require('joi');
const sceneService = require('../services/sceneService');
const { elementSchema } = require('../utils/layerSchema');
const { broadcastToClients } = require('../services/websocketService');

const sceneSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().allow('').max(500).default(''),
  from_preset: Joi.string().max(100)
});

const sceneUpdateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100),
  description: Joi.string().allow('').max(500)
}).min(1);

// Element fields the editor can change (same shape as a Layer Control layer)
const EDITABLE = ['name', 'layer_type', 'content', 'position', 'visible', 'opacity', 'priority'];

const notFound = (res, what = 'Scene') => res.status(404).json({ error: `${what} not found` });

class SceneController {
  async listScenes(req, res) {
    res.json(await sceneService.list());
  }

  async listStarters(req, res) {
    res.json(sceneService.starters());
  }

  async getScene(req, res) {
    const scene = await sceneService.get(req.params.sceneId);
    return scene ? res.json(scene) : notFound(res);
  }

  async createScene(req, res) {
    const { error, value } = sceneSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    try {
      const scene = await sceneService.create(value);
      broadcastToClients('scenes_updated', { scene_id: scene.scene_id });
      res.status(201).json(scene);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  }

  async updateScene(req, res) {
    const { error, value } = sceneUpdateSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const scene = await sceneService.update(req.params.sceneId, value);
    if (!scene) return notFound(res);
    broadcastToClients('scenes_updated', { scene_id: scene.scene_id });
    res.json(scene);
  }

  async duplicateScene(req, res) {
    const scene = await sceneService.duplicate(req.params.sceneId, req.body?.name);
    if (!scene) return notFound(res);
    broadcastToClients('scenes_updated', { scene_id: scene.scene_id });
    res.status(201).json(scene);
  }

  async deleteScene(req, res) {
    if (!await sceneService.remove(req.params.sceneId)) return notFound(res);
    broadcastToClients('scenes_updated', { scene_id: req.params.sceneId });
    res.json({ message: 'Scene deleted' });
  }

  // --- Elements: same API shape as /api/layers/tvs/:tv_id/layers ---

  async listElements(req, res) {
    const scene = await sceneService.get(req.params.sceneId);
    return scene ? res.json(scene.elements) : notFound(res);
  }

  async createElement(req, res) {
    const { error, value } = elementSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    try {
      const element = await sceneService.addElement(req.params.sceneId, value);
      if (!element) return notFound(res);
      this.changed(req);
      res.status(201).json(element);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  }

  async updateElement(req, res) {
    let validationError;
    const element = await sceneService.updateElement(req.params.sceneId, req.params.elementId, current => {
      const merged = Object.fromEntries(EDITABLE.map(key => [key, current[key]]).filter(([, v]) => v !== undefined));
      const { error, value } = elementSchema.validate({ ...merged, ...req.body });
      if (error) {
        validationError = error;
        return current;
      }
      return { ...current, ...value };
    });
    if (validationError) return res.status(400).json({ error: validationError.details[0].message });
    if (!element) return notFound(res, 'Element');
    this.changed(req);
    res.json(element);
  }

  async moveElement(req, res) {
    const { x, y } = req.body;
    if (typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'Invalid position coordinates' });
    }
    const element = await sceneService.updateElement(req.params.sceneId, req.params.elementId,
      current => ({ ...current, position: { ...current.position, x, y } }));
    if (!element) return notFound(res, 'Element');
    this.changed(req);
    res.json({ message: 'Element moved', layer_id: element.layer_id, position: element.position });
  }

  async setElementVisibility(req, res) {
    const { visible } = req.body;
    if (typeof visible !== 'boolean') return res.status(400).json({ error: 'visible must be true or false' });
    const element = await sceneService.updateElement(req.params.sceneId, req.params.elementId,
      current => ({ ...current, visible }));
    if (!element) return notFound(res, 'Element');
    this.changed(req);
    res.json({ message: `Element ${visible ? 'shown' : 'hidden'}`, layer_id: element.layer_id, visible });
  }

  async deleteElement(req, res) {
    if (!await sceneService.removeElement(req.params.sceneId, req.params.elementId)) return notFound(res, 'Element');
    this.changed(req);
    res.json({ message: 'Element deleted' });
  }

  changed(req) {
    broadcastToClients('scene_elements_updated', { scene_id: req.params.sceneId });
  }
}

const controller = new SceneController();
// Route handlers are passed unbound; bind so `this.changed` works
for (const name of Object.getOwnPropertyNames(SceneController.prototype)) {
  if (name !== 'constructor') controller[name] = controller[name].bind(controller);
}
module.exports = controller;
