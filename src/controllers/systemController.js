const Joi = require('joi');
const notifyService = require('../services/notifyService');
const monitorService = require('../services/monitorService');
const backupService = require('../services/backupService');

const notificationSchema = Joi.object({
  ntfy_url: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
  enabled: Joi.boolean()
}).min(1);

// The System page: notifications (ntfy), fleet versions, backups
class SystemController {
  // GET /api/system/notifications
  async getNotifications(req, res) {
    res.json(await notifyService.publicSettings());
  }

  // PUT /api/system/notifications { ntfy_url?, enabled? }
  async setNotifications(req, res) {
    const { error, value } = notificationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    if (value.ntfy_url !== undefined && process.env.NTFY_URL) {
      return res.status(409).json({ error: 'The topic is set by NTFY_URL in the manager\'s environment' });
    }
    res.json(await notifyService.saveSettings(value));
  }

  // POST /api/system/notifications/test
  async testNotification(req, res) {
    const sent = await notifyService.push('Signage: test notification', 'Notifications from the signage manager reach this topic.', { tags: 'bell' });
    if (!sent) return res.status(502).json({ error: 'The notification was not accepted. Check the topic URL, and that notifications are on.' });
    res.json({ message: 'Test notification sent' });
  }

  // GET /api/system/fleet
  async getFleet(req, res) {
    res.json(await monitorService.fleet());
  }

  // GET /api/system/backups
  async getBackups(req, res) {
    res.json(await backupService.status());
  }

  // POST /api/system/backups - back up now
  async runBackup(req, res) {
    try {
      res.json(await backupService.run());
    } catch (error) {
      res.status(500).json({ error: `Backup failed: ${error.message}` });
    }
  }

  // GET /api/system/backups/:file - download
  async downloadBackup(req, res) {
    const file = backupService.filePath(req.params.file);
    if (!file || !(await backupService.list()).some(b => b.file === req.params.file)) {
      return res.status(404).json({ error: 'Backup not found' });
    }
    res.download(file);
  }
}

module.exports = new SystemController();
