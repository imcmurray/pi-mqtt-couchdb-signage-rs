const monitorService = require('../../../src/services/monitorService');
const mqttService = require('../../../src/services/multilayer.mqttService');
const notifyService = require('../../../src/services/notifyService');

describe('monitorService', () => {
  const minutesAgo = m => new Date(Date.now() - m * 60000).toISOString();
  const sequences = [{ tv_ids: ['tv_1'], clips: [{ duration_ms: 20000 }, { duration_ms: 15000 }, { duration_ms: 99000, enabled: false }] }];
  const tv = { _id: 'tv_1', name: 'pi21', ip_address: '10.0.0.5', status: 'online', slideshow_state: 'playing', last_heartbeat: minutesAgo(0) };

  beforeEach(() => {
    jest.spyOn(notifyService, 'report').mockResolvedValue(false);
    monitorService.versions.clear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    mqttService.liveState.delete('tv_1');
  });

  const stuckOn = minutes => mqttService.liveState.set('tv_1', { current_clip: 'c1', clip_changed_at: minutesAgo(minutes) });

  it('calls a playing TV stuck only well past its longest enabled clip (at least 5 minutes)', () => {
    stuckOn(4);
    expect(monitorService.frozenFor(tv, sequences)).toBe(0);
    stuckOn(6);
    expect(monitorService.frozenFor(tv, sequences)).toBeGreaterThan(5 * 60000);
  });

  it('does not call a paused (held) TV, a quiet TV or a one-clip sequence stuck', () => {
    stuckOn(60);
    expect(monitorService.frozenFor({ ...tv, status: 'offline' }, sequences)).toBe(0);
    expect(monitorService.frozenFor({ ...tv, slideshow_state: 'paused' }, sequences)).toBe(0);
    expect(monitorService.frozenFor(tv, [{ tv_ids: ['tv_1'], clips: [{ duration_ms: 20000 }] }])).toBe(0);
  });

  it('reports offline after 5 quiet minutes, and ignores TVs never seen', async () => {
    await monitorService.checkTv({ ...tv, last_heartbeat: minutesAgo(3) }, sequences);
    expect(notifyService.report).toHaveBeenCalledWith('tv:tv_1:online', true, expect.anything());
    notifyService.report.mockClear();
    await monitorService.checkTv({ ...tv, last_heartbeat: minutesAgo(6) }, sequences);
    expect(notifyService.report).toHaveBeenCalledTimes(1);
    expect(notifyService.report).toHaveBeenCalledWith('tv:tv_1:online', false, expect.anything());
    notifyService.report.mockClear();
    await monitorService.checkTv({ ...tv, last_heartbeat: null }, sequences);
    expect(notifyService.report).not.toHaveBeenCalled();
  });

  it('reports a TV on a different version from the manager', async () => {
    monitorService.versions.set('tv_1', { version: '0.0.1' });
    await monitorService.checkTv(tv, sequences);
    expect(notifyService.report).toHaveBeenCalledWith('tv:tv_1:version', false, expect.anything());
  });
});
