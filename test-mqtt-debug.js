#!/usr/bin/env node

const mqtt = require('mqtt');

// Connect to MQTT broker
const client = mqtt.connect('mqtt://192.168.1.215:1883');

client.on('connect', () => {
    console.log('Connected to MQTT broker');
    
    // Subscribe to all signage topics to monitor activity
    client.subscribe('signage/#', (err) => {
        if (err) {
            console.error('Subscribe error:', err);
        } else {
            console.log('Subscribed to signage/# - monitoring all TV activity');
        }
    });

    // Wait a moment then send a test config update
    setTimeout(() => {
        const tvId = process.argv[2] || 'rpi1'; // Get TV ID from command line or default
        const topic = `signage/tv/${tvId}/command`;
        const message = JSON.stringify({
            command: 'update_config',
            payload: {
                orientation: 'portrait',
                display_duration: 6000
            },
            timestamp: new Date().toISOString()
        });
        
        console.log(`\n🔄 Sending config update to ${topic}:`);
        console.log(message);
        
        client.publish(topic, message, (err) => {
            if (err) {
                console.error('Publish error:', err);
            } else {
                console.log('✅ Config update sent successfully');
            }
        });
    }, 2000);
});

client.on('message', (topic, message) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] 📨 MQTT Message:`);
    console.log(`Topic: ${topic}`);
    
    try {
        const parsed = JSON.parse(message.toString());
        console.log(`Payload: ${JSON.stringify(parsed, null, 2)}`);
    } catch (e) {
        console.log(`Payload: ${message.toString()}`);
    }
});

client.on('error', (error) => {
    console.error('MQTT error:', error);
});

client.on('offline', () => {
    console.log('MQTT client offline');
});

// Keep the script running
process.on('SIGINT', () => {
    console.log('\nDisconnecting...');
    client.end();
    process.exit(0);
});

console.log('MQTT Debug Tool - Press Ctrl+C to exit');
console.log('Usage: node test-mqtt-debug.js [tv_id]');
console.log('Example: node test-mqtt-debug.js rpi1');