const { layerSchema } = require('../../../src/utils/layerSchema');

describe('layerSchema', () => {
  const layer = content => ({ tv_id: 'tv_1', name: 'Court Seal', content, position: { x: 16, y: 968, width: 110, height: 110 } });

  it('keeps an overlay\'s countdown ring', () => {
    const { error, value } = layerSchema.validate(layer({ image_id: 'image_1', countdownRing: { enabled: true, color: 'rgba(201, 162, 39, 1)' } }));
    expect(error).toBeUndefined();
    expect(value.content.countdownRing).toEqual({ enabled: true, color: 'rgba(201, 162, 39, 1)' });
  });

  it('allows a negative ring gap, within limits', () => {
    const ring = gap => layerSchema.validate(layer({ countdownRing: { enabled: true, gap } })).error;
    expect(ring(-5)).toBeUndefined();
    expect(ring(-21).message).toMatch(/countdownRing.gap/);
  });

  it('refuses a ring colour the TV cannot read', () => {
    const { error } = layerSchema.validate(layer({ countdownRing: { enabled: true, color: 'gold' } }));
    expect(error.message).toMatch(/countdownRing.color/);
  });
});
