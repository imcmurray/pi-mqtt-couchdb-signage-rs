const Joi = require('joi');

// One renderable layer: a Layer Control overlay on a TV, or an element of a scene.
// Both are drawn by the same TV compositor, so they validate the same way.
const layerFields = {
  layer_id: Joi.string(),
  name: Joi.string().required(),
  layer_type: Joi.string().valid('DataRow', 'StaticOverlay', 'DynamicText', 'Emergency').default('DataRow'),
  content: Joi.object({
    text: Joi.string().allow('').default(''),
    // Image Library image drawn instead of the text (PNG transparency is kept)
    image_id: Joi.string().max(100).allow(null),
    backgroundColor: Joi.string().pattern(/^rgba?\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/).default('rgba(0, 0, 0, 0.8)'),
    textColor: Joi.string().pattern(/^rgba?\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/).default('rgba(255, 255, 255, 1)'),
    fontSize: Joi.number().min(10).max(300).default(24), // big enough for full-screen titles and clocks
    // Fonts installed on the TVs (see FONT_FILES in pi-slideshow-rs layer_manager.rs);
    // other names, like the old 'Arial' default, render as DejaVu Sans
    fontFamily: Joi.string().max(50).default('DejaVu Sans'),
    fontWeight: Joi.string().valid('normal', 'bold').default('normal'),
    padding: Joi.number().min(0).max(50).default(10),
    alignment: Joi.string().valid('left', 'center', 'right').default('left'),
    verticalAlignment: Joi.string().valid('top', 'middle', 'bottom').default('middle'),
    // Table drawn from a data set (e.g. the court calendar); see builtinPresets
    table: Joi.object({
      dataset: Joi.string().max(50).required(),
      columns: Joi.array().items(Joi.object({
        field: Joi.string().max(50).required(),
        label: Joi.string().allow('').max(50).required(),
        width: Joi.number().min(20).max(1920).required()
      })).min(1).max(12).required()
    }).unknown(true)
  }).required(), // no text and no image = a plain colour block
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
  }).default() // no-arg default fills in the child defaults (default({}) would not)
};

const layerSchema = Joi.object({ tv_id: Joi.string().required(), ...layerFields });
const elementSchema = Joi.object(layerFields);

module.exports = { layerSchema, elementSchema };
