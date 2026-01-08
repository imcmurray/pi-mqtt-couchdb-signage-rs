const WebSocket = require('ws');

class WebsocketService {
  constructor() {
    this.wss = null;
  }

  initialize(wss) {
    this.wss = wss;
  }

  broadcastToClients(type, data) {
    if (!this.wss) {
      console.warn('WebSocket server not initialized');
      return;
    }
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type,
          data,
          timestamp: new Date().toISOString()
        }));
      }
    });
  }
}

const websocketService = new WebsocketService();

module.exports = {
  initialize: (wss) => websocketService.initialize(wss),
  broadcastToClients: (type, data) => websocketService.broadcastToClients(type, data)
};
