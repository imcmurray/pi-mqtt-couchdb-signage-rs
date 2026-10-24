const Layer = require('../models/Layer');
const TV = require('../models/tv.multilayer');
const sceneService = require('./sceneService');
const sequenceService = require('./sequenceService');
const alertService = require('./alertService');
const mqttService = require('./multilayer.mqttService');
const { broadcastToClients } = require('./websocketService');

// A guided tour on one TV: every scene, an image clip, the overlays, the three
// alert levels, then normal rotation, with a caption explaining each step.
// Everything is put back afterwards (also after Stop or an error). What to put
// back is stored on the temporary demo sequence, so a server restart mid-demo
// still restores the TV (restoreLeftovers).
const DEMO_TAG = 'demo';
const SCENE_SECONDS = 12;
const SYNC_WAIT_MS = 6000; // sync debounce + the Pi loading the sequence and rendering snapshots
// Alerts reach the TV on their own topic within a moment; caption changes go through
// the layer sync and take a couple of seconds, so alert steps let the caption land first
const CAPTION_SETTLE_MS = 2500;

const captionLayer = (tvId, text) => ({
  tv_id: tvId,
  name: 'Demo caption',
  layer_type: 'DataRow',
  content: {
    text,
    backgroundColor: 'rgba(201, 162, 39, 0.96)',
    textColor: 'rgba(12, 30, 66, 1)',
    fontSize: 30,
    fontFamily: 'Liberation Sans',
    fontWeight: 'bold',
    alignment: 'center',
    verticalAlignment: 'middle'
  },
  // Two short lines: what this is, and what it shows
  position: { x: 260, y: 850, width: 1400, height: 100 },
  priority: 140, // above overlays, below alerts (150+)
  visible: true,
  opacity: 1,
  tags: [DEMO_TAG]
});

class DemoService {
  constructor() {
    this.running = new Map(); // tvId -> { step, total, label, cancelled, wake }
  }

  status() {
    return [...this.running.entries()].map(([tv_id, demo]) =>
      ({ tv_id, step: demo.step, total: demo.total, label: demo.label }));
  }

  report(tvId, demo) {
    broadcastToClients('demo_progress', demo
      ? { tv_id: tvId, running: true, step: demo.step, total: demo.total, label: demo.label }
      : { tv_id: tvId, running: false });
  }

  async start(tvId) {
    if (this.running.has(tvId)) throw Object.assign(new Error('A demo is already running on this TV'), { status: 409 });
    const tv = await TV.findById(tvId);
    if (!tv) throw Object.assign(new Error('TV not found'), { status: 404 });
    if (mqttService.applyLiveState(tv).status !== 'online') {
      throw Object.assign(new Error(`${tv.name} is offline`), { status: 409 });
    }

    const scenes = await sceneService.list();
    const original = await sequenceService.findForTv(tvId);
    const imageRefs = (original?.clips || []).filter(c => c.kind === 'image' && c.enabled).map(c => c.ref).slice(0, 1);
    if (!scenes.length && !imageRefs.length) {
      throw Object.assign(new Error('Nothing to show: create a scene or a sequence with images first'), { status: 409 });
    }

    const demo = { step: 0, total: 0, label: 'Starting…', cancelled: false, wake: null };
    this.running.set(tvId, demo);
    this.report(tvId, demo);
    this.run(tvId, tv, scenes, original, imageRefs, demo)
      .catch(error => console.error(`Demo on ${tvId} failed:`, error))
      .finally(() => {
        this.running.delete(tvId);
        this.report(tvId, null);
      });
    return { message: `Demo started on ${tv.name}` };
  }

  stop(tvId) {
    const demo = this.running.get(tvId);
    if (!demo) return false;
    demo.cancelled = true;
    demo.wake?.();
    return true;
  }

  // Sleep that ends early on Stop
  wait(demo, ms) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      demo.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async run(tvId, tv, scenes, original, imageRefs, demo) {
    // Remember what to restore before changing anything
    const overlays = (await Layer.findByTv(tvId)).filter(l => !Layer.isAlertLayer(l) && !(l.tags || []).includes(DEMO_TAG));
    const originallyVisible = new Map(overlays.map(l => [l.layer_id, l.visible]));
    const sequence = await sequenceService.create({
      name: `Demo Tour (${tv.name}, temporary)`,
      description: 'Created by the demo; removed automatically when it ends',
      clips: [
        ...scenes.map(scene => ({ kind: 'scene', ref: scene.scene_id, duration_ms: SCENE_SECONDS * 1000, enabled: true, schedule: null })),
        ...imageRefs.map(ref => ({ kind: 'image', ref, duration_ms: 8000, enabled: true, schedule: null }))
      ]
    });
    await sequenceService.update(sequence._id, {
      demo: {
        tv_id: tvId,
        original_sequence_id: original?.sequence_id || null,
        overlay_visibility: Object.fromEntries(originallyVisible)
      }
    });

    const demoLayers = [];
    const alerts = [];
    let caption = null;

    const setCaption = async text => {
      if (!caption) {
        caption = new Layer(captionLayer(tvId, text));
        await caption.save();
        demoLayers.push(caption);
      } else {
        await caption.updateContent({ text });
      }
      mqttService.syncLayers(tvId);
    };
    const setOverlays = async visible => {
      for (const layer of overlays) await layer.setVisibility(visible && originallyVisible.get(layer.layer_id));
      mqttService.syncLayers(tvId);
    };
    const hold = clip => mqttService.showClip(tvId, clip.clip_id, true);
    const alert = async (type, title, message) => {
      const result = await alertService.broadcastAlert({
        title: `[DEMO] ${title}`, message, type,
        target_type: 'specific', target_ids: [tvId],
        auto_dismiss_ms: 20000, // backstop if the demo is interrupted
        created_by: 'demo'
      });
      alerts.push(result.alert.alert_id);
      return result.alert.alert_id;
    };
    const dismiss = async alertId => {
      await alertService.dismissAlert(alertId, 'demo').catch(() => {});
    };

    const sceneClips = sequence.clips.filter(c => c.kind === 'scene');
    const imageClip = sequence.clips.find(c => c.kind === 'image');
    const steps = [
      ...sceneClips.map((clip, i) => {
        const scene = scenes.find(s => s.scene_id === clip.ref);
        return {
          label: `Scene: ${scene.name}`,
          seconds: SCENE_SECONDS,
          run: async () => {
            // Caption first: the TV applies changes in order, so it lands with the scene
            await setCaption(`🎬 Scene ${i + 1} of ${sceneClips.length} · ${scene.name}\nDesigned on the Scenes page; live values update on the TV`);
            if (i === 0) await setOverlays(false);
            await hold(clip);
          }
        };
      }),
      ...(imageClip ? [{
        label: 'Image clip',
        seconds: 8,
        run: async () => {
          await setCaption('🖼️ Image clip\nPhotos from the Image Library play between scenes');
          await hold(imageClip);
        }
      }] : []),
      {
        label: 'Overlays',
        seconds: 10,
        run: async () => {
          await setCaption('🧱 Overlays (Layer Control)\nSeals, logos and notices sit on top of every clip');
          if (sceneClips[0]) await hold(sceneClips[0]);
          await setOverlays(true);
          const ticker = new Layer({
            tv_id: tvId,
            name: 'Demo overlay: notice',
            layer_type: 'DataRow',
            content: {
              text: '⏱️ Overlay notice: Courtroom 205 is running about 30 minutes late',
              backgroundColor: 'rgba(0, 0, 0, 0.85)', textColor: 'rgba(255, 255, 255, 1)',
              fontSize: 32, fontFamily: 'Liberation Sans', alignment: 'center', verticalAlignment: 'middle'
            },
            position: { x: 0, y: 980, width: 1920, height: 100 },
            priority: 120, visible: true, opacity: 1, tags: [DEMO_TAG]
          });
          await ticker.save();
          demoLayers.push(ticker);
          mqttService.syncLayers(tvId);
        }
      },
      {
        label: 'Alert: INFO',
        seconds: 8,
        run: async () => {
          await setCaption('🔔 Alerts sit above everything\nINFO: a blue announcement banner');
          await this.wait(demo, CAPTION_SETTLE_MS);
          await alert('INFO', 'Announcement', '☕ The cafeteria closes at 2:00 PM today');
        }
      },
      {
        label: 'Alert: URGENT',
        seconds: 8,
        run: async () => {
          await setCaption('🔔 Alerts sit above everything\nURGENT: an orange warning banner');
          await this.wait(demo, CAPTION_SETTLE_MS);
          await dismiss(alerts[alerts.length - 1]);
          await alert('URGENT', 'Weather Advisory', '❄️ Winter storm warning in effect this afternoon');
        }
      },
      {
        label: 'Alert: CRITICAL',
        seconds: 8,
        run: async () => {
          await setCaption('🔔 Alerts sit above everything\nCRITICAL: takes over the whole screen');
          await this.wait(demo, CAPTION_SETTLE_MS);
          await dismiss(alerts[alerts.length - 1]);
          await alert('CRITICAL', 'Emergency', 'This is only a demonstration: CRITICAL alerts take over the whole screen');
        }
      },
      {
        label: 'Rotation',
        seconds: 14,
        run: async () => {
          await setCaption('🔁 Sequence rotation\nClips play in a loop with transitions. End of the demo');
          await this.wait(demo, CAPTION_SETTLE_MS);
          await dismiss(alerts[alerts.length - 1]);
          await mqttService.resume(tvId);
        }
      }
    ];
    demo.total = steps.length;

    try {
      await sequenceService.assignTvs(sequence._id, [tvId]);
      broadcastToClients('sequences_updated', { sequence_id: sequence._id });
      mqttService.syncLayers(tvId);
      demo.label = 'Preparing the TV…';
      this.report(tvId, demo);
      await this.wait(demo, SYNC_WAIT_MS);

      for (const [index, step] of steps.entries()) {
        if (demo.cancelled) break;
        demo.step = index + 1;
        demo.label = step.label;
        this.report(tvId, demo);
        await step.run();
        await this.wait(demo, step.seconds * 1000);
      }
    } finally {
      for (const alertId of alerts) await dismiss(alertId);
      for (const layer of demoLayers) await layer.delete().catch(() => {});
      await this.restore(await sequenceService.get(sequence._id));
    }
  }

  // Put the TV back from what the demo sequence recorded, then remove it
  async restore(sequence) {
    if (!sequence?.demo) return;
    const { tv_id: tvId, original_sequence_id: originalId, overlay_visibility: visibility } = sequence.demo;

    for (const [layerId, visible] of Object.entries(visibility || {})) {
      const layer = await Layer.findById(layerId);
      if (layer && layer.visible !== visible) await layer.setVisibility(visible);
    }
    for (const layer of await Layer.findByTv(tvId)) {
      if ((layer.tags || []).includes(DEMO_TAG)) await layer.delete().catch(() => {});
    }

    const original = originalId && await sequenceService.get(originalId);
    if (original) {
      await sequenceService.assignTvs(originalId, [...new Set([...(original.tv_ids || []), tvId])]);
    }
    await sequenceService.remove(sequence._id);
    broadcastToClients('sequences_updated', { sequence_id: sequence._id });
    await mqttService.resume(tvId);
    mqttService.syncLayers(tvId);
    console.log(`🎬 Demo finished; ${tvId} restored`);
  }

  // After a restart: finish restoring any TV whose demo was interrupted
  async restoreLeftovers() {
    for (const sequence of await sequenceService.all()) {
      if (sequence.demo) {
        console.log(`🎬 Restoring ${sequence.demo.tv_id} after an interrupted demo`);
        await this.restore(sequence);
      }
    }
  }
}

module.exports = new DemoService();
