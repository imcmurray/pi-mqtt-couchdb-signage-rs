const Alert = require('../../../src/models/Alert');

describe('Alert Model', () => {
  describe('constructor', () => {
    it('should create alert with CRITICAL priority', () => {
      const alert = new Alert({
        title: 'Building Evacuation',
        message: 'Evacuate immediately via nearest exit',
        type: 'CRITICAL'
      });

      expect(alert.title).toBe('Building Evacuation');
      expect(alert.message).toBe('Evacuate immediately via nearest exit');
      expect(alert.type).toBe('CRITICAL');
      expect(alert.priority).toBe(250);
      expect(alert.auto_dismiss_ms).toBe(600000); // 10 minutes
      expect(alert.background_color).toBe('rgba(220, 38, 38, 0.95)');
    });

    it('should create alert with URGENT priority', () => {
      const alert = new Alert({
        title: 'Weather Alert',
        message: 'Severe thunderstorm warning in effect',
        type: 'URGENT'
      });

      expect(alert.type).toBe('URGENT');
      expect(alert.priority).toBe(200);
      expect(alert.auto_dismiss_ms).toBe(300000); // 5 minutes
      expect(alert.background_color).toBe('rgba(217, 119, 6, 0.9)');
    });

    it('should create alert with INFO priority', () => {
      const alert = new Alert({
        title: 'General Announcement',
        message: 'Cafeteria closes at 2 PM today',
        type: 'INFO'
      });

      expect(alert.type).toBe('INFO');
      expect(alert.priority).toBe(150);
      expect(alert.auto_dismiss_ms).toBe(120000); // 2 minutes
      expect(alert.background_color).toBe('rgba(37, 99, 235, 0.85)');
    });

    it('should default to INFO if type not specified', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test message'
      });

      expect(alert.type).toBe('INFO');
      expect(alert.priority).toBe(150);
    });

    it('should generate unique alert ID', () => {
      const alert1 = new Alert({ title: 'Test 1', message: 'Message 1' });
      const alert2 = new Alert({ title: 'Test 2', message: 'Message 2' });

      expect(alert1.alert_id).toBeTruthy();
      expect(alert2.alert_id).toBeTruthy();
      expect(alert1.alert_id).not.toBe(alert2.alert_id);
    });

    it('should set created_at timestamp', () => {
      const alert = new Alert({ title: 'Test', message: 'Test' });
      const now = new Date();
      const createdAt = new Date(alert.created_at);

      expect(createdAt.getTime()).toBeCloseTo(now.getTime(), -3); // Within a few seconds
    });
  });

  describe('validation', () => {
    it('should require title', () => {
      const alert = new Alert({ message: 'Test message', type: 'INFO' });

      expect(() => alert.validate()).toThrow('Title is required');
    });

    it('should require message', () => {
      const alert = new Alert({ title: 'Test Title', type: 'INFO' });

      expect(() => alert.validate()).toThrow('Message is required');
    });

    it('should validate title length', () => {
      const longTitle = 'A'.repeat(101);
      const alert = new Alert({ title: longTitle, message: 'Test', type: 'INFO' });

      expect(() => alert.validate()).toThrow('Title must be 100 characters or less');
    });

    it('should validate message length', () => {
      const longMessage = 'A'.repeat(501);
      const alert = new Alert({ title: 'Test', message: longMessage, type: 'INFO' });

      expect(() => alert.validate()).toThrow('Message must be 500 characters or less');
    });

    it('should validate alert type', () => {
      const alert = new Alert({ title: 'Test', message: 'Test', type: 'INVALID' });

      expect(() => alert.validate()).toThrow('Invalid alert type');
    });

    it('should pass validation with valid data', () => {
      const alert = new Alert({
        title: 'Valid Alert',
        message: 'This is a valid alert message',
        type: 'URGENT'
      });

      expect(() => alert.validate()).not.toThrow();
    });
  });

  describe('toLayer', () => {
    it('should convert CRITICAL alert to fullscreen layer', () => {
      const alert = new Alert({
        title: 'Evacuation',
        message: 'Leave building now',
        type: 'CRITICAL'
      });

      const layer = alert.toLayer('tv_123');

      expect(layer.tv_id).toBe('tv_123');
      expect(layer.layer_type).toBe('Emergency');
      expect(layer.priority).toBe(250);
      expect(layer.visible).toBe(true);
      expect(layer.position).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
      expect(layer.content.text).toContain('🚨');
      expect(layer.content.text).toContain('CRITICAL ALERT');
      expect(layer.content.text).toContain('Evacuation');
      expect(layer.content.text).toContain('Leave building now');
      expect(layer.content.backgroundColor).toBe('rgba(220, 38, 38, 0.95)');
      expect(layer.content.fontSize).toBe(48);
    });

    it('should convert URGENT alert to banner layer', () => {
      const alert = new Alert({
        title: 'Weather Alert',
        message: 'Severe weather approaching',
        type: 'URGENT'
      });

      const layer = alert.toLayer('tv_456');

      expect(layer.position).toEqual({ x: 0, y: 0, width: 1920, height: 120 });
      expect(layer.priority).toBe(200);
      expect(layer.content.text).toContain('⚠️');
      expect(layer.content.text).toContain('URGENT');
      expect(layer.content.fontSize).toBe(32);
    });

    it('should convert INFO alert to ticker layer', () => {
      const alert = new Alert({
        title: 'Announcement',
        message: 'Cafeteria menu updated',
        type: 'INFO'
      });

      const layer = alert.toLayer('tv_789');

      expect(layer.position).toEqual({ x: 0, y: 980, width: 1920, height: 100 });
      expect(layer.priority).toBe(150);
      expect(layer.content.text).toContain('ℹ️');
      expect(layer.content.fontSize).toBe(24);
    });

    it('should set auto-hide schedule', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test message',
        type: 'INFO',
        auto_dismiss_ms: 5000
      });

      const layer = alert.toLayer('tv_123');

      expect(layer.schedule.enabled).toBe(true);
      expect(layer.schedule.auto_hide_after_ms).toBe(5000);
    });
  });

  describe('getBroadcastTargets', () => {
    it('should return all when target_type is all', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test',
        target_type: 'all'
      });

      expect(alert.target_type).toBe('all');
      expect(alert.target_ids).toEqual([]);
    });

    it('should store specific TV IDs', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test',
        target_type: 'specific',
        target_ids: ['tv_1', 'tv_2', 'tv_3']
      });

      expect(alert.target_type).toBe('specific');
      expect(alert.target_ids).toEqual(['tv_1', 'tv_2', 'tv_3']);
    });

    it('should store location for location-based broadcast', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test',
        target_type: 'location',
        target_location: 'Building A'
      });

      expect(alert.target_type).toBe('location');
      expect(alert.target_location).toBe('Building A');
    });
  });

  describe('isActive', () => {
    it('should return true for new alert', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test',
        type: 'INFO'
      });

      expect(alert.isActive()).toBe(true);
    });

    it('should return false for dismissed alert', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test',
        type: 'INFO',
        status: 'dismissed'
      });

      expect(alert.isActive()).toBe(false);
    });

    it('should return false for expired alert', () => {
      const alert = new Alert({
        title: 'Test',
        message: 'Test',
        type: 'INFO',
        status: 'expired'
      });

      expect(alert.isActive()).toBe(false);
    });
  });
});
