// Mock node-cron before requiring batchScheduler
jest.mock('node-cron');

const batchScheduler = require('../../../src/services/batchScheduler');
const cron = require('node-cron');
const Layer = require('../../../src/models/Layer');
const TV = require('../../../src/models/tv.multilayer');
const Preset = require('../../../src/models/Preset');

describe('BatchScheduler Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    batchScheduler.scheduledTasks.clear();
    batchScheduler.isRunning = false;
  });

  describe('initialization', () => {
    it('should initialize with empty task map', () => {
      expect(batchScheduler.scheduledTasks.size).toBe(0);
      expect(batchScheduler.isRunning).toBe(false);
    });
  });

  describe('start and stop', () => {
    it('should start scheduler and load tasks', async () => {
      batchScheduler.loadScheduledTasks = jest.fn();
      batchScheduler.start();

      expect(batchScheduler.isRunning).toBe(true);
      expect(batchScheduler.loadScheduledTasks).toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      batchScheduler.isRunning = true;
      batchScheduler.loadScheduledTasks = jest.fn();

      batchScheduler.start();

      expect(batchScheduler.loadScheduledTasks).not.toHaveBeenCalled();
    });

    it('should stop scheduler and clear all tasks', () => {
      const mockCronJob = {
        stop: jest.fn()
      };

      batchScheduler.scheduledTasks.set('task1', {
        name: 'task1',
        cronJob: mockCronJob
      });

      batchScheduler.scheduledTasks.set('task2', {
        name: 'task2',
        cronJob: mockCronJob
      });

      batchScheduler.isRunning = true;
      batchScheduler.stop();

      expect(batchScheduler.isRunning).toBe(false);
      expect(mockCronJob.stop).toHaveBeenCalledTimes(2);
      expect(batchScheduler.scheduledTasks.size).toBe(0);
    });
  });

  describe('addRecurringSchedule', () => {
    it('should add valid recurring schedule', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      const config = {
        name: 'test_schedule',
        cronPattern: '0 8 * * 1-5',
        action: 'set_layer_visibility',
        params: { tag: 'court-schedule', visible: true }
      };

      const result = batchScheduler.addRecurringSchedule(config);

      expect(result).toBe(true);
      expect(batchScheduler.scheduledTasks.has('test_schedule')).toBe(true);
      expect(cron.validate).toHaveBeenCalledWith('0 8 * * 1-5');
      expect(cron.schedule).toHaveBeenCalled();
    });

    it('should reject invalid cron pattern', () => {
      cron.validate.mockReturnValue(false);

      const config = {
        name: 'invalid_schedule',
        cronPattern: 'invalid pattern',
        action: 'set_layer_visibility',
        params: {}
      };

      const result = batchScheduler.addRecurringSchedule(config);

      expect(result).toBe(false);
      expect(batchScheduler.scheduledTasks.has('invalid_schedule')).toBe(false);
    });

    it('should store task configuration', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      const config = {
        name: 'enable_court',
        cronPattern: '0 8 * * 1-5',
        action: 'set_layer_visibility',
        params: { tag: 'court-schedule', visible: true }
      };

      batchScheduler.addRecurringSchedule(config);

      const task = batchScheduler.scheduledTasks.get('enable_court');
      expect(task.name).toBe('enable_court');
      expect(task.cronPattern).toBe('0 8 * * 1-5');
      expect(task.action).toBe('set_layer_visibility');
      expect(task.params).toEqual({ tag: 'court-schedule', visible: true });
      expect(task.type).toBe('recurring');
      expect(task.created_at).toBeTruthy();
    });
  });

  describe('scheduleOnce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should schedule one-time task in the future', () => {
      const futureTime = new Date(Date.now() + 3600000); // 1 hour from now

      const config = {
        name: 'one_time_task',
        executeAt: futureTime.toISOString(),
        action: 'create_layer',
        params: { layer_config: {} }
      };

      const result = batchScheduler.scheduleOnce(config);

      expect(result).toBe(true);
      expect(batchScheduler.scheduledTasks.has('one_time_task')).toBe(true);

      const task = batchScheduler.scheduledTasks.get('one_time_task');
      expect(task.type).toBe('once');
      expect(task.executeAt).toBe(futureTime.toISOString());
    });

    it('should reject task scheduled in the past', () => {
      const pastTime = new Date(Date.now() - 3600000); // 1 hour ago

      const config = {
        name: 'past_task',
        executeAt: pastTime.toISOString(),
        action: 'create_layer',
        params: {}
      };

      const result = batchScheduler.scheduleOnce(config);

      expect(result).toBe(false);
      expect(batchScheduler.scheduledTasks.has('past_task')).toBe(false);
    });

    it('should execute task at scheduled time', async () => {
      const futureTime = new Date(Date.now() + 1000); // 1 second from now

      batchScheduler.executeScheduledAction = jest.fn().mockResolvedValue(undefined);

      const config = {
        name: 'timed_task',
        executeAt: futureTime.toISOString(),
        action: 'send_command',
        params: { command: 'refresh' }
      };

      batchScheduler.scheduleOnce(config);

      expect(batchScheduler.scheduledTasks.has('timed_task')).toBe(true);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(batchScheduler.executeScheduledAction).toHaveBeenCalledWith('send_command', { command: 'refresh' });
    });

    it('should remove task after execution', async () => {
      const futureTime = new Date(Date.now() + 500);

      batchScheduler.executeScheduledAction = jest.fn().mockResolvedValue(undefined);

      const config = {
        name: 'temp_task',
        executeAt: futureTime.toISOString(),
        action: 'apply_preset',
        params: {}
      };

      batchScheduler.scheduleOnce(config);

      jest.advanceTimersByTime(500);
      await Promise.resolve();

      expect(batchScheduler.scheduledTasks.has('temp_task')).toBe(false);
    });
  });

  describe('executeScheduledAction', () => {
    beforeEach(() => {
      // Mock all dependencies to prevent actual database/MQTT calls
      Layer.findAll = jest.fn().mockResolvedValue([]);
      TV.findAll = jest.fn().mockResolvedValue([]);
      Preset.findByPresetId = jest.fn().mockResolvedValue(null);
    });

    it('should execute set_layer_visibility action without errors', async () => {
      const params = { tag: 'court-schedule', visible: true };
      await batchScheduler.executeScheduledAction('set_layer_visibility', params);
      // Should complete without throwing
    });

    it('should execute apply_preset action without errors', async () => {
      const params = { preset_id: 'court-left', location: 'Lobby' };
      await batchScheduler.executeScheduledAction('apply_preset', params);
      // Should complete without throwing
    });

    it('should execute create_layer action without errors', async () => {
      const params = {
        tv_ids: ['tv_1', 'tv_2'],
        layer_config: { layer_type: 'DataRow' }
      };
      await batchScheduler.executeScheduledAction('create_layer', params);
      // Should complete without throwing
    });

    it('should execute delete_layers action without errors', async () => {
      const params = {
        tag: 'expired-content',
        tv_ids: ['tv_1', 'tv_2']
      };
      await batchScheduler.executeScheduledAction('delete_layers', params);
      // Should complete without throwing
    });

    it('should execute send_command action without errors', async () => {
      const params = {
        tv_ids: ['tv_1'],
        command: 'refresh'
      };
      await batchScheduler.executeScheduledAction('send_command', params);
      // Should complete without throwing
    });

    it('should handle unknown action gracefully', async () => {
      await batchScheduler.executeScheduledAction('unknown_action', {});
      // Should complete without throwing
    });

    it('should handle action execution errors gracefully', async () => {
      Layer.findAll = jest.fn().mockRejectedValue(new Error('Database error'));

      await batchScheduler.executeScheduledAction('set_layer_visibility', { tag: 'test', visible: true });
      // Should complete without throwing even though Layer.findAll failed
    });
  });

  describe('setLayerVisibility', () => {
    it('should update visibility of tagged layers', async () => {
      const mockLayers = [
        {
          layer_id: 'layer_1',
          tags: ['court-schedule', 'test'],
          setVisibility: jest.fn().mockResolvedValue(undefined)
        },
        {
          layer_id: 'layer_2',
          tags: ['court-schedule'],
          setVisibility: jest.fn().mockResolvedValue(undefined)
        },
        {
          layer_id: 'layer_3',
          tags: ['other-tag'],
          setVisibility: jest.fn().mockResolvedValue(undefined)
        }
      ];

      Layer.findAll = jest.fn().mockResolvedValue(mockLayers);

      const result = await batchScheduler.setLayerVisibility('court-schedule', false);

      expect(mockLayers[0].setVisibility).toHaveBeenCalledWith(false, { duration: 500 });
      expect(mockLayers[1].setVisibility).toHaveBeenCalledWith(false, { duration: 500 });
      expect(mockLayers[2].setVisibility).not.toHaveBeenCalled();
    });

    it('should handle empty layer result', async () => {
      Layer.findAll = jest.fn().mockResolvedValue([]);

      await batchScheduler.setLayerVisibility('nonexistent-tag', true);
      // Should complete without errors
    });
  });

  describe('applyPresetToLocation', () => {
    it('should apply preset to all TVs in location', async () => {
      const mockTVs = [
        {
          _id: 'tv_doc_1',
          tv_id: 'tv_1',
          location: 'Lobby',
          hasLayerSupport: jest.fn().mockReturnValue(true)
        },
        {
          _id: 'tv_doc_2',
          tv_id: 'tv_2',
          location: 'Lobby',
          hasLayerSupport: jest.fn().mockReturnValue(true)
        },
        {
          _id: 'tv_doc_3',
          tv_id: 'tv_3',
          location: 'Courtroom',
          hasLayerSupport: jest.fn().mockReturnValue(true)
        }
      ];

      const mockPreset = {
        preset_id: 'court-left',
        applyToTV: jest.fn().mockReturnValue([
          { layer_type: 'DataRow', position: { x: 0, y: 0, width: 960, height: 1080 } }
        ])
      };

      TV.findAll = jest.fn().mockResolvedValue(mockTVs);
      Preset.findByPresetId = jest.fn().mockResolvedValue(mockPreset);

      const mockLayerSave = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(Layer.prototype, 'save').mockImplementation(mockLayerSave);

      const result = await batchScheduler.applyPresetToLocation('court-left', 'Lobby');

      expect(mockPreset.applyToTV).toHaveBeenCalledTimes(2);
      expect(mockPreset.applyToTV).toHaveBeenCalledWith('tv_doc_1');
      expect(mockPreset.applyToTV).toHaveBeenCalledWith('tv_doc_2');
      expect(mockPreset.applyToTV).not.toHaveBeenCalledWith('tv_doc_3');

      Layer.prototype.save.mockRestore();
    });

    it('should handle missing preset gracefully', async () => {
      TV.findAll = jest.fn().mockResolvedValue([]);
      Preset.findByPresetId = jest.fn().mockResolvedValue(null);

      await batchScheduler.applyPresetToLocation('nonexistent-preset', 'Lobby');
      // Should complete without errors
    });
  });

  describe('removeSchedule', () => {
    it('should remove recurring schedule', () => {
      const mockCronJob = {
        stop: jest.fn()
      };

      batchScheduler.scheduledTasks.set('test_task', {
        name: 'test_task',
        cronJob: mockCronJob
      });

      const result = batchScheduler.removeSchedule('test_task');

      expect(result).toBe(true);
      expect(mockCronJob.stop).toHaveBeenCalled();
      expect(batchScheduler.scheduledTasks.has('test_task')).toBe(false);
    });

    it('should remove one-time schedule', () => {
      jest.useFakeTimers();

      const timeoutId = setTimeout(() => {}, 10000);
      batchScheduler.scheduledTasks.set('timed_task', {
        name: 'timed_task',
        timeoutId: timeoutId
      });

      const result = batchScheduler.removeSchedule('timed_task');

      expect(result).toBe(true);
      expect(batchScheduler.scheduledTasks.has('timed_task')).toBe(false);

      jest.useRealTimers();
    });

    it('should return false for non-existent task', () => {
      const result = batchScheduler.removeSchedule('nonexistent_task');

      expect(result).toBe(false);
    });
  });

  describe('getScheduledTasks', () => {
    it('should return all scheduled tasks', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      batchScheduler.addRecurringSchedule({
        name: 'task1',
        cronPattern: '0 8 * * *',
        action: 'set_layer_visibility',
        params: {}
      });

      batchScheduler.addRecurringSchedule({
        name: 'task2',
        cronPattern: '0 17 * * *',
        action: 'apply_preset',
        params: {}
      });

      const tasks = batchScheduler.getScheduledTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].name).toBe('task1');
      expect(tasks[1].name).toBe('task2');
    });

    it('should not include cronJob in returned data', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      batchScheduler.addRecurringSchedule({
        name: 'task1',
        cronPattern: '0 8 * * *',
        action: 'set_layer_visibility',
        params: {}
      });

      const tasks = batchScheduler.getScheduledTasks();

      expect(tasks[0].cronJob).toBeUndefined();
      expect(tasks[0].timeoutId).toBeUndefined();
    });
  });

  describe('getTask', () => {
    it('should return specific task by name', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      batchScheduler.addRecurringSchedule({
        name: 'enable_court',
        cronPattern: '0 8 * * 1-5',
        action: 'set_layer_visibility',
        params: { tag: 'court-schedule', visible: true }
      });

      const task = batchScheduler.getTask('enable_court');

      expect(task).toBeDefined();
      expect(task.name).toBe('enable_court');
      expect(task.cronPattern).toBe('0 8 * * 1-5');
      expect(task.action).toBe('set_layer_visibility');
    });

    it('should return null for non-existent task', () => {
      const task = batchScheduler.getTask('nonexistent');

      expect(task).toBe(null);
    });
  });

  describe('default schedules', () => {
    it('should load court schedule enable at 8 AM', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      batchScheduler.addRecurringSchedule({
        name: 'enable_court_schedule',
        cronPattern: '0 8 * * 1-5',
        action: 'set_layer_visibility',
        params: { tag: 'court-schedule', visible: true }
      });

      const task = batchScheduler.getTask('enable_court_schedule');
      expect(task).not.toBeNull();
      expect(task.cronPattern).toBe('0 8 * * 1-5');
      expect(task.action).toBe('set_layer_visibility');
      expect(task.params.tag).toBe('court-schedule');
      expect(task.params.visible).toBe(true);
    });

    it('should load court schedule disable at 5 PM', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      batchScheduler.addRecurringSchedule({
        name: 'disable_court_schedule',
        cronPattern: '0 17 * * 1-5',
        action: 'set_layer_visibility',
        params: { tag: 'court-schedule', visible: false }
      });

      const task = batchScheduler.getTask('disable_court_schedule');
      expect(task).not.toBeNull();
      expect(task.cronPattern).toBe('0 17 * * 1-5');
      expect(task.action).toBe('set_layer_visibility');
      expect(task.params.tag).toBe('court-schedule');
      expect(task.params.visible).toBe(false);
    });

    it('should load morning preset schedule', () => {
      cron.validate.mockReturnValue(true);
      const mockCronJob = { stop: jest.fn() };
      cron.schedule.mockReturnValue(mockCronJob);

      batchScheduler.addRecurringSchedule({
        name: 'morning_preset',
        cronPattern: '30 7 * * 1-5',
        action: 'apply_preset',
        params: { preset_id: 'court-schedule-left', location: 'Lobby' }
      });

      const task = batchScheduler.getTask('morning_preset');
      expect(task).not.toBeNull();
      expect(task.cronPattern).toBe('30 7 * * 1-5');
      expect(task.action).toBe('apply_preset');
      expect(task.params.preset_id).toBe('court-schedule-left');
    });
  });
});
