#!/usr/bin/env node

// Multi-Layer System Demo
// Demonstrates creating and animating multiple data row layers

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// Demo configuration
const DEMO_CONFIG = {
  tv_id: null, // Will be set to first available TV
  layers: [
    {
      name: 'Court Schedule Header',
      text: 'TODAY\'S COURT SCHEDULE',
      y: 50,
      height: 60,
      backgroundColor: 'rgba(0, 0, 128, 0.9)',
      textColor: 'rgba(255, 255, 255, 1)',
      fontSize: 32
    },
    {
      name: 'Court Room 1',
      text: '9:00 AM - Room 101 - Smith vs. Johnson',
      y: 150,
      height: 50,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      textColor: 'rgba(255, 255, 255, 1)',
      fontSize: 24
    },
    {
      name: 'Court Room 2',
      text: '10:30 AM - Room 205 - State vs. Williams',
      y: 210,
      height: 50,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      textColor: 'rgba(255, 255, 255, 1)',
      fontSize: 24
    },
    {
      name: 'Court Room 3',
      text: '2:00 PM - Room 301 - Davis vs. Miller',
      y: 270,
      height: 50,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      textColor: 'rgba(255, 255, 255, 1)',
      fontSize: 24
    },
    {
      name: 'Alert Message',
      text: '⚠️ Court Room 205 Delayed by 30 minutes',
      y: 900,
      height: 60,
      backgroundColor: 'rgba(255, 0, 0, 0.9)',
      textColor: 'rgba(255, 255, 255, 1)',
      fontSize: 28
    }
  ]
};

class MultiLayerDemo {
  constructor() {
    this.createdLayers = [];
    this.client = axios.create({
      baseURL: API_BASE,
      timeout: 10000
    });
  }

  async log(message, data = null) {
    console.log(`🎨 ${message}`);
    if (data) {
      console.log(`   📊 ${JSON.stringify(data, null, 2)}`);
    }
  }

  async error(message, error) {
    console.error(`❌ ${message}`);
    if (error?.response?.data) {
      console.error(`   📊 ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error?.message) {
      console.error(`   📊 ${error.message}`);
    }
  }

  async findOrCreateTV() {
    try {
      // Get all TVs
      const response = await this.client.get('/tvs');
      const tvs = response.data;
      
      if (tvs.length > 0) {
        // Use first TV
        this.targetTvId = tvs[0]._id;
        await this.log(`Using existing TV: ${tvs[0].name}`, { id: this.targetTvId });
      } else {
        // Create a demo TV
        const tvData = {
          name: 'Multi-Layer Demo TV',
          location: 'Demo Room',
          ip_address: '192.168.1.100',
          config: {
            resolution: '1920x1080',
            orientation: 'landscape',
            layer_settings: {
              max_layers: 50,
              enable_animations: true
            }
          }
        };
        
        const createResponse = await this.client.post('/tvs', tvData);
        this.targetTvId = createResponse.data._id;
        await this.log('Created demo TV', { id: this.targetTvId });
      }
      
      DEMO_CONFIG.tv_id = this.targetTvId;
    } catch (error) {
      await this.error('Failed to find/create TV', error);
      throw error;
    }
  }

  async createDataRowLayer(layerConfig) {
    try {
      const layerData = {
        name: layerConfig.name,
        layer_type: 'DataRow',
        content: {
          text: layerConfig.text,
          backgroundColor: layerConfig.backgroundColor,
          textColor: layerConfig.textColor,
          fontSize: layerConfig.fontSize,
          alignment: 'left'
        },
        position: {
          x: 0,
          y: layerConfig.y,
          width: 1920,
          height: layerConfig.height
        },
        visible: true,
        opacity: 1.0,
        priority: 15
      };
      
      const response = await this.client.post(`/tvs/${this.targetTvId}/layers`, layerData);
      await this.log(`Created layer: ${layerConfig.name}`, { id: response.data.layer_id });
      return response.data;
    } catch (error) {
      await this.error(`Failed to create layer: ${layerConfig.name}`, error);
      throw error;
    }
  }

  async animateLayer(layerId, animationType, options = {}) {
    try {
      const animationData = {
        type: animationType,
        duration: options.duration || 500,
        easing: options.easing || 'ease-in-out',
        ...options
      };
      
      const response = await this.client.post(
        `/tvs/${this.targetTvId}/layers/${layerId}/animate`,
        animationData
      );
      
      await this.log(`Started ${animationType} animation`, { layerId });
      return response.data;
    } catch (error) {
      await this.error(`Failed to animate layer ${layerId}`, error);
      throw error;
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async runDemo() {
    await this.log('Starting Multi-Layer Demo...');
    
    try {
      // Step 1: Find or create TV
      await this.findOrCreateTV();
      
      // Step 2: Create all data row layers
      await this.log('Creating data row layers...');
      for (const layerConfig of DEMO_CONFIG.layers) {
        const layer = await this.createDataRowLayer(layerConfig);
        this.createdLayers.push(layer);
        await this.sleep(200); // Small delay for visual effect
      }
      
      await this.log(`Created ${this.createdLayers.length} layers`);
      await this.sleep(2000);
      
      // Step 3: Demonstrate slide animations
      await this.log('Demo 1: Sliding court schedule entries');
      
      // Slide in court entries from left
      for (let i = 1; i <= 3; i++) {
        await this.animateLayer(this.createdLayers[i].layer_id, 'slide_right', {
          distance: 200,
          duration: 800
        });
        await this.sleep(300);
      }
      
      await this.sleep(2000);
      
      // Step 4: Show alert sliding from bottom
      await this.log('Demo 2: Emergency alert sliding up');
      await this.animateLayer(this.createdLayers[4].layer_id, 'slide_up', {
        distance: 200,
        duration: 1000
      });
      
      await this.sleep(3000);
      
      // Step 5: Fade out and update content
      await this.log('Demo 3: Updating court room status');
      const updateLayer = this.createdLayers[1];
      
      // Fade out
      await this.animateLayer(updateLayer.layer_id, 'fade_out', {
        duration: 500
      });
      await this.sleep(600);
      
      // Update content
      await this.client.put(`/tvs/${this.targetTvId}/layers/${updateLayer.layer_id}/content`, {
        content: {
          text: '9:00 AM - Room 101 - COMPLETED ✓',
          backgroundColor: 'rgba(0, 128, 0, 0.8)'
        }
      });
      
      // Fade back in
      await this.animateLayer(updateLayer.layer_id, 'fade_in', {
        duration: 500
      });
      
      await this.sleep(2000);
      
      // Step 6: Demonstrate position movement
      await this.log('Demo 4: Moving layers');
      await this.client.post(`/tvs/${this.targetTvId}/layers/${this.createdLayers[4].layer_id}/move`, {
        x: 0,
        y: 500,
        animate: true,
        duration: 1500
      });
      
      await this.sleep(2000);
      
      // Step 7: Batch hide operation
      await this.log('Demo 5: Batch hide animation');
      const batchHide = {
        operation: 'animate',
        layers: this.createdLayers.slice(1, 4).map(layer => ({
          layer_id: layer.layer_id,
          animation: {
            type: 'slide_left',
            distance: 200,
            duration: 800
          }
        }))
      };
      
      await this.client.post(`/tvs/${this.targetTvId}/layers/batch`, batchHide);
      
      await this.sleep(2000);
      
      // Step 8: Show all layers again
      await this.log('Demo 6: Show all layers');
      for (const layer of this.createdLayers) {
        await this.client.post(`/tvs/${this.targetTvId}/layers/${layer.layer_id}/visibility`, {
          visible: true,
          transition: {
            duration: 500
          }
        });
        await this.sleep(200);
      }
      
      await this.log('Multi-Layer Demo Complete! 🎉');
      await this.log('Layers remain active for further testing');
      
    } catch (error) {
      await this.error('Demo failed', error);
    }
  }

  async cleanup() {
    if (this.createdLayers.length > 0 && this.targetTvId) {
      await this.log('Cleaning up demo layers...');
      
      try {
        const batchDelete = {
          operation: 'delete',
          layers: this.createdLayers.map(l => l.layer_id)
        };
        
        await this.client.post(`/tvs/${this.targetTvId}/layers/batch`, batchDelete);
        await this.log('Cleanup complete');
      } catch (error) {
        await this.error('Cleanup failed', error);
      }
    }
  }
}

// Run the demo
async function main() {
  const demo = new MultiLayerDemo();
  
  try {
    await demo.runDemo();
    
    // Wait for user input before cleanup
    console.log('\nPress Ctrl+C to exit and clean up demo layers...');
    
    process.on('SIGINT', async () => {
      console.log('\nCleaning up...');
      await demo.cleanup();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Demo error:', error);
    await demo.cleanup();
    process.exit(1);
  }
}

// Check if server is running
axios.get(`${BASE_URL}/health`)
  .then(() => {
    console.log('✅ Server is running');
    main();
  })
  .catch(() => {
    console.error('❌ Server is not running. Please start the multi-layer server first:');
    console.error('   npm run dev:multilayer');
    process.exit(1);
  });