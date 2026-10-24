const BUILTIN_PRESETS = require('../../../src/config/builtinPresets');
const { elementSchema } = require('../../../src/utils/layerSchema');

// Template layers become editable layers/scene elements, so they must pass the
// same validation the editor's saves go through
describe('built-in templates', () => {
  const layers = BUILTIN_PRESETS.flatMap(preset => preset.layers.map(layer => [preset.preset_id, layer]));

  it.each(layers)('%s: %s is a valid layer', (presetId, { tags, ...layer }) => {
    const { error } = elementSchema.validate(layer);
    expect(error?.message).toBeUndefined();
  });
});
