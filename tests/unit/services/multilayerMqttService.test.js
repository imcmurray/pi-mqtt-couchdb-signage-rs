// A broker restart surfaces as an 'error' (e.g. ECONNRESET) on the mqtt client.
// The service must survive it: the client reconnects on its own.
const EventEmitter = require('events');

jest.mock('mqtt', () => ({ connect: jest.fn() }));

describe('MultilayerMqttService client errors', () => {
  let mqtt, service, fakeClient;

  beforeEach(() => {
    jest.resetModules();
    mqtt = require('mqtt');
    fakeClient = new EventEmitter();
    fakeClient.subscribe = jest.fn();
    fakeClient.publish = jest.fn();
    mqtt.connect.mockReturnValue(fakeClient);
    service = require('../../../src/services/multilayer.mqttService');
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('a client error with no service listener does not throw', async () => {
    await service.connect();
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(service.listenerCount('error')).toBe(0);
    expect(() => fakeClient.emit('error', err)).not.toThrow();
    expect(console.error).toHaveBeenCalledWith('MQTT error:', err);
  });

  test('a client error is still forwarded when someone listens', async () => {
    await service.connect();
    const onError = jest.fn();
    service.on('error', onError);
    const err = new Error('boom');
    fakeClient.emit('error', err);
    expect(onError).toHaveBeenCalledWith(err);
  });
});
