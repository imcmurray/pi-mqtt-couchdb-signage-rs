// Simple working test example
describe('Basic functionality', () => {
  it('should run a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should test async functionality', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });

  it('should test validation with Joi', () => {
    const Joi = require('joi');
    
    const schema = Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required()
    });

    const { error } = schema.validate({ name: 'Test' });
    expect(error).toBeDefined();
    expect(error.details[0].path[0]).toBe('email');
  });
});