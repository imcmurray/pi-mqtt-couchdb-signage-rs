const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://192.168.1.215:1883');

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    
    // Send reload config command to the online TV
    const tvId = '51994af1-8d92-460d-b356-c2b6baaad26f';
    const topic = `signage/tv/${tvId}/command`;
    
    const commands = [
        { 
            command: 'update_config',
            payload: {
                transition_effect: 'fade',
                display_duration: 5000,
                orientation: 'portrait'
            },
            timestamp: new Date().toISOString()
        }
    ];
    
    commands.forEach((command, index) => {
        setTimeout(() => {
            console.log(`Sending command: ${JSON.stringify(command)} to ${topic}`);
            client.publish(topic, JSON.stringify(command), { qos: 1 });
        }, index * 1000);
    });
    
    // Disconnect after sending commands
    setTimeout(() => {
        client.end();
        console.log('Disconnected from MQTT broker');
    }, 5000);
});

client.on('error', (error) => {
    console.error('MQTT connection error:', error);
});