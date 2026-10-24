jest.mock('../../../src/models/Layer', () => {
  const Layer = { findById: jest.fn(), findByTv: jest.fn(), isAlertLayer: l => (l.tags || []).includes('alert') };
  return Layer;
});
jest.mock('../../../src/models/tv.multilayer', () => ({ findById: jest.fn() }));
jest.mock('../../../src/services/sceneService', () => ({ list: jest.fn() }));
jest.mock('../../../src/services/sequenceService', () => ({
  get: jest.fn(), assignTvs: jest.fn(), remove: jest.fn(), all: jest.fn(), findForTv: jest.fn()
}));
jest.mock('../../../src/services/alertService', () => ({ broadcastAlert: jest.fn(), dismissAlert: jest.fn() }));
jest.mock('../../../src/services/multilayer.mqttService', () => ({
  resume: jest.fn(), syncLayers: jest.fn(), applyLiveState: jest.fn(tv => tv)
}));
jest.mock('../../../src/services/websocketService', () => ({ broadcastToClients: jest.fn() }));

const Layer = require('../../../src/models/Layer');
const TV = require('../../../src/models/tv.multilayer');
const sequenceService = require('../../../src/services/sequenceService');
const mqttService = require('../../../src/services/multilayer.mqttService');
const demoService = require('../../../src/services/demoService');

const layer = (layer_id, visible, tags = []) => ({
  layer_id, visible, tags,
  setVisibility: jest.fn(async function setVisibility(v) { this.visible = v; }),
  delete: jest.fn().mockResolvedValue()
});

describe('demoService.restore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('puts overlays, the original sequence and playback back, and removes the demo', async () => {
    const seal = layer('seal', false);       // the demo turned it on; it was hidden
    const notice = layer('notice', true);    // still as it was
    const caption = layer('caption', true, ['demo']);
    Layer.findById.mockImplementation(async id => ({ seal, notice })[id]);
    Layer.findByTv.mockResolvedValue([seal, notice, caption]);
    seal.visible = true;
    sequenceService.get.mockResolvedValue({ sequence_id: 'seq_orig', tv_ids: ['tv_other'] });

    await demoService.restore({
      _id: 'seq_demo',
      demo: { tv_id: 'tv_1', original_sequence_id: 'seq_orig', overlay_visibility: { seal: false, notice: true } }
    });

    expect(seal.setVisibility).toHaveBeenCalledWith(false);
    expect(notice.setVisibility).not.toHaveBeenCalled();
    expect(caption.delete).toHaveBeenCalled();
    expect(sequenceService.assignTvs).toHaveBeenCalledWith('seq_orig', ['tv_other', 'tv_1']);
    expect(sequenceService.remove).toHaveBeenCalledWith('seq_demo');
    expect(mqttService.resume).toHaveBeenCalledWith('tv_1');
  });

  it('leaves the TV without a sequence if it had none', async () => {
    Layer.findByTv.mockResolvedValue([]);
    await demoService.restore({ _id: 'seq_demo', demo: { tv_id: 'tv_1', original_sequence_id: null, overlay_visibility: {} } });
    expect(sequenceService.assignTvs).not.toHaveBeenCalled();
    expect(sequenceService.remove).toHaveBeenCalledWith('seq_demo');
  });

  it('ignores sequences that are not demos', async () => {
    await demoService.restore({ _id: 'seq_real', name: 'Lobby' });
    expect(sequenceService.remove).not.toHaveBeenCalled();
  });

  it('restores leftovers from an interrupted demo after a restart', async () => {
    Layer.findByTv.mockResolvedValue([]);
    sequenceService.all.mockResolvedValue([
      { _id: 'seq_real', name: 'Lobby' },
      { _id: 'seq_demo', demo: { tv_id: 'tv_1', original_sequence_id: null, overlay_visibility: {} } }
    ]);
    await demoService.restoreLeftovers();
    expect(sequenceService.remove).toHaveBeenCalledTimes(1);
    expect(sequenceService.remove).toHaveBeenCalledWith('seq_demo');
  });
});

describe('demoService.start', () => {
  it('refuses an offline TV', async () => {
    TV.findById.mockResolvedValue({ _id: 'tv_1', name: 'Dev1', status: 'offline' });
    mqttService.applyLiveState.mockImplementation(tv => tv);
    await expect(demoService.start('tv_1')).rejects.toThrow(/offline/);
  });
});
