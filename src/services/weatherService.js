const datasetService = require('./datasetService');

// Current conditions from the National Weather Service (no API key), stored as the
// `weather` data set whose values fill {weather}, {temp} and {conditions} in layer text.
// Defaults to the Frank E. Moss courthouse; same source as moss-dig-sig-2026.
const LATITUDE = process.env.WEATHER_LATITUDE || '40.7608';
const LONGITUDE = process.env.WEATHER_LONGITUDE || '-111.8910';
const LOCATION = process.env.WEATHER_LOCATION || 'Salt Lake City';
const REFRESH_MS = 15 * 60 * 1000;
const HEADERS = { 'User-Agent': 'pi-signage-fleet (courthouse signage)', Accept: 'application/geo+json' };

class WeatherService {
  constructor() {
    this.forecastUrl = null;
    this.timer = null;
  }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  async fetchJson(url) {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${url} -> ${response.status}`);
    return response.json();
  }

  async refresh() {
    try {
      if (!this.forecastUrl) {
        const point = await this.fetchJson(`https://api.weather.gov/points/${LATITUDE},${LONGITUDE}`);
        this.forecastUrl = point.properties.forecastHourly;
      }
      const forecast = await this.fetchJson(this.forecastUrl);
      const now = forecast.properties.periods[0];
      const values = {
        temp: `${now.temperature}°${now.temperatureUnit}`,
        conditions: now.shortForecast,
        weather: `${now.temperature}°${now.temperatureUnit} · ${now.shortForecast}`,
        location: LOCATION
      };

      // Only rewrite (and make every TV refresh) when something visible changed
      const current = await datasetService.get('weather');
      if (JSON.stringify(current?.values) !== JSON.stringify(values)) {
        await datasetService.save('weather', { name: 'Weather', source: 'api.weather.gov', values });
        console.log(`🌤️ Weather updated: ${values.weather}`);
      }
    } catch (error) {
      // Keep the last stored value; TVs keep showing it
      console.error('Weather refresh failed:', error.message);
      this.forecastUrl = null;
    }
  }
}

module.exports = new WeatherService();
