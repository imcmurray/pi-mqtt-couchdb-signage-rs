// Mock MQTT service for testing
class MockMqttService {
  constructor() {
    this.connected = false;
    this.subscriptions = new Map();
    this.publishedMessages = [];
    this.client = this;
  }

  connect() {
    this.connected = true;
    return Promise.resolve();
  }

  disconnect() {
    this.connected = false;
    return Promise.resolve();
  }

  subscribe(topic, callback) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
    this.subscriptions.get(topic).push(callback);
  }

  unsubscribe(topic) {
    this.subscriptions.delete(topic);
  }

  publish(topic, message) {
    this.publishedMessages.push({ topic, message, timestamp: new Date() });
    
    // Simulate message delivery to subscribers
    const topicCallbacks = this.subscriptions.get(topic) || [];
    topicCallbacks.forEach(callback => {
      setImmediate(() => callback(topic, message));
    });
  }

  // Test helpers
  getPublishedMessages(topic = null) {
    if (topic) {
      return this.publishedMessages.filter(msg => msg.topic === topic);
    }
    return this.publishedMessages;
  }

  clearPublishedMessages() {
    this.publishedMessages = [];
  }

  simulateMessage(topic, message) {
    const topicCallbacks = this.subscriptions.get(topic) || [];
    topicCallbacks.forEach(callback => {
      callback(topic, message);
    });
  }

  isConnected() {
    return this.connected;
  }

  reset() {
    this.connected = false;
    this.subscriptions.clear();
    this.publishedMessages = [];
  }
}

module.exports = MockMqttService;