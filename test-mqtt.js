const mqtt = require('mqtt');

// Connect to MQTT broker
const client = mqtt.connect('mqtt://192.168.1.215:1883');

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    
    // Publish some test messages to non-signage topics
    client.publish('test/general', 'Hello from test script!');
    client.publish('system/cpu', JSON.stringify({ usage: 45.2, timestamp: new Date() }));
    client.publish('sensors/temperature', JSON.stringify({ value: 22.5, unit: 'C' }));
    
    console.log('Published test messages to:');
    console.log('- test/general');
    console.log('- system/cpu');
    console.log('- sensors/temperature');
    
    setTimeout(() => {
        client.end();
        console.log('Disconnected');
    }, 1000);
});

client.on('error', (err) => {
    console.error('MQTT connection error:', err.message);
    process.exit(1);
});