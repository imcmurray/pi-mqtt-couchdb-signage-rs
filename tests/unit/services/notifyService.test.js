const notifyService = require('../../../src/services/notifyService');
const { asciiHeader, redact } = notifyService;

describe('notifyService', () => {
  let pushes;

  beforeEach(() => {
    pushes = [];
    notifyService.state = { doc: { _id: 'state_notifications', alerts: {} } };
    notifyService.settings = { ntfy_url: 'https://ntfy.sh/secret-topic', enabled: true };
    jest.spyOn(notifyService, 'saveState').mockResolvedValue();
    global.fetch = jest.fn(async (url, options) => {
      pushes.push({ url, ...options });
      return { ok: true };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  const offline = ok => notifyService.report('tv:pi21:online', ok, {
    problem: { title: 'Signage: pi21 is offline', body: 'gone' },
    recovery: { title: 'Signage: pi21 is back online', body: 'back' }
  });

  it('stays quiet when the first sighting is healthy', async () => {
    await offline(true);
    expect(pushes).toHaveLength(0);
  });

  it('pushes a problem once, then the recovery', async () => {
    await offline(true);
    await offline(false);
    await offline(false);
    await offline(true);
    await offline(true);
    expect(pushes.map(p => p.headers.Title)).toEqual(['Signage: pi21 is offline', 'Signage: pi21 is back online']);
    expect(pushes[0].headers).toMatchObject({ Priority: 'high', Tags: 'rotating_light' });
    expect(pushes[1].headers).toMatchObject({ Priority: 'default', Tags: 'white_check_mark' });
    expect(pushes[0].url).toBe('https://ntfy.sh/secret-topic');
  });

  it('updates the label without pushing when only the label changes', async () => {
    await offline(false);
    await notifyService.report('tv:pi21:online', false, { label: 'Courtroom North online', problem: { title: 'x', body: '' }, recovery: { title: 'y', body: '' } });
    expect(pushes).toHaveLength(1);
    expect(notifyService.state.doc.alerts['tv:pi21:online'].label).toBe('Courtroom North online');
  });

  it('pushes a problem seen on the first check', async () => {
    await offline(false);
    expect(pushes).toHaveLength(1);
  });

  it('records state but sends nothing when notifications are off', async () => {
    notifyService.settings.enabled = false;
    await offline(false);
    expect(pushes).toHaveLength(0);
    expect(notifyService.state.doc.alerts['tv:pi21:online'].state).toBe('bad');
  });

  it('never throws when ntfy is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(notifyService.push('t', 'b')).resolves.toBe(false);
  });

  it('keeps titles ASCII and topics private', () => {
    expect(asciiHeader('Signage · pi21 — “stuck”')).toBe('Signage - pi21 - ?stuck?');
    expect(redact('https://ntfy.sh/abcdef123456')).toBe('https://ntfy.sh/abcd…');
  });
});
