const { weatherIcon } = require('../../../src/services/weatherService');

describe('weatherIcon', () => {
  test('maps NWS short forecasts to an emoji', () => {
    expect(weatherIcon('Sunny')).toBe('☀️');
    expect(weatherIcon('Mostly Sunny')).toBe('🌤️');
    expect(weatherIcon('Partly Cloudy')).toBe('⛅');
    expect(weatherIcon('Mostly Cloudy')).toBe('☁️');
    expect(weatherIcon('Chance Rain Showers')).toBe('🌧️');
    expect(weatherIcon('Slight Chance Light Snow')).toBe('❄️');
    expect(weatherIcon('Showers And Thunderstorms')).toBe('⛈️');
    expect(weatherIcon('Patchy Fog')).toBe('🌫️');
  });

  test('uses night icons after dark', () => {
    expect(weatherIcon('Clear', false)).toBe('🌙');
    expect(weatherIcon('Partly Cloudy', false)).toBe('☁️');
  });

  test('falls back to a thermometer', () => {
    expect(weatherIcon('')).toBe('🌡️');
    expect(weatherIcon(undefined)).toBe('🌡️');
  });
});
