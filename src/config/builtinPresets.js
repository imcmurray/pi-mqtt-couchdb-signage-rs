/**
 * Built-in Preset Templates
 * Pre-configured zone layouts for common digital signage scenarios
 */

const BUILTIN_PRESETS = [
  {
    preset_id: 'court-schedule-left',
    name: 'Court Schedule (Left)',
    description: 'Court schedule display on left 50%, logo/branding on right 50%',
    is_builtin: true,
    category: 'court',
    tags: ['court', 'schedule', 'split-screen'],
    layers: [
      {
        name: 'Court Schedule Area',
        layer_type: 'DataRow',
        content: {
          text: 'Court schedule will appear here',
          backgroundColor: 'rgba(30, 58, 138, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 24,
          alignment: 'left'
        },
        position: {
          x: 0,
          y: 0,
          width: 960,  // Left 50%
          height: 1080
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-left', 'schedule-area']
      },
      {
        name: 'Logo/Branding Area',
        layer_type: 'StaticOverlay',
        content: {
          text: 'Logo Area',
          backgroundColor: 'rgba(255, 255, 255, 255)',
          textColor: 'rgba(0, 0, 0, 255)',
          fontSize: 32,
          alignment: 'center'
        },
        position: {
          x: 960,  // Right 50%
          y: 0,
          width: 960,
          height: 1080
        },
        priority: 5,
        visible: true,
        opacity: 1.0,
        tags: ['zone-right', 'branding']
      }
    ]
  },

  {
    preset_id: 'emergency-fullscreen',
    name: 'Emergency Alert (Fullscreen)',
    description: 'Full-screen critical alert with auto-dismiss after 10 minutes',
    is_builtin: true,
    category: 'emergency',
    tags: ['emergency', 'alert', 'fullscreen'],
    layers: [
      {
        name: 'Emergency Alert',
        layer_type: 'Emergency',
        content: {
          text: '🚨 EMERGENCY ALERT - This is a placeholder message',
          backgroundColor: 'rgba(239, 68, 68, 240)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 48,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 0,
          width: 1920,
          height: 1080
        },
        priority: 250,  // Highest priority
        visible: true,
        opacity: 1.0,
        schedule: {
          enabled: true,
          auto_hide_after_ms: 600000  // 10 minutes
        },
        tags: ['emergency', 'fullscreen', 'auto-dismiss']
      }
    ]
  },

  {
    preset_id: 'info-ticker-bottom',
    name: 'Info Ticker (Bottom)',
    description: 'Scrolling information ticker at bottom 10% of screen',
    is_builtin: true,
    category: 'info',
    tags: ['ticker', 'info', 'scrolling'],
    layers: [
      {
        name: 'Bottom Info Ticker',
        layer_type: 'DataRow',
        content: {
          text: 'Scrolling information will appear here...',
          backgroundColor: 'rgba(0, 0, 0, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 28,
          alignment: 'left'
        },
        position: {
          x: 0,
          y: 972,  // Bottom 10% (1080 - 108)
          width: 1920,
          height: 108
        },
        priority: 20,
        visible: true,
        opacity: 0.95,
        tags: ['ticker', 'bottom', 'info']
      }
    ]
  },

  {
    preset_id: 'split-dual-vertical',
    name: 'Split Screen (Vertical)',
    description: 'Two equal zones side-by-side for dual content display',
    is_builtin: true,
    category: 'layout',
    tags: ['split-screen', 'dual', 'vertical'],
    layers: [
      {
        name: 'Left Zone',
        layer_type: 'DataRow',
        content: {
          text: 'Left Content Area',
          backgroundColor: 'rgba(30, 58, 138, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 32,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 0,
          width: 960,
          height: 1080
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-left']
      },
      {
        name: 'Right Zone',
        layer_type: 'DataRow',
        content: {
          text: 'Right Content Area',
          backgroundColor: 'rgba(139, 92, 246, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 32,
          alignment: 'center'
        },
        position: {
          x: 960,
          y: 0,
          width: 960,
          height: 1080
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-right']
      }
    ]
  },

  {
    preset_id: 'split-dual-horizontal',
    name: 'Split Screen (Horizontal)',
    description: 'Two equal zones stacked top and bottom',
    is_builtin: true,
    category: 'layout',
    tags: ['split-screen', 'dual', 'horizontal'],
    layers: [
      {
        name: 'Top Zone',
        layer_type: 'DataRow',
        content: {
          text: 'Top Content Area',
          backgroundColor: 'rgba(30, 58, 138, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 32,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 0,
          width: 1920,
          height: 540
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-top']
      },
      {
        name: 'Bottom Zone',
        layer_type: 'DataRow',
        content: {
          text: 'Bottom Content Area',
          backgroundColor: 'rgba(139, 92, 246, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 32,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 540,
          width: 1920,
          height: 540
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-bottom']
      }
    ]
  },

  {
    preset_id: 'corner-logo-br',
    name: 'Corner Logo (Bottom Right)',
    description: 'Small logo watermark in bottom-right corner (15% screen)',
    is_builtin: true,
    category: 'layout',
    tags: ['logo', 'watermark', 'corner'],
    layers: [
      {
        name: 'Logo Watermark',
        layer_type: 'StaticOverlay',
        content: {
          text: 'LOGO',
          backgroundColor: 'rgba(255, 255, 255, 150)',
          textColor: 'rgba(0, 0, 0, 255)',
          fontSize: 24,
          alignment: 'center'
        },
        position: {
          x: 1632,  // Right edge - 288px (15% of 1920)
          y: 918,   // Bottom edge - 162px (15% of 1080)
          width: 288,
          height: 162
        },
        priority: 5,
        visible: true,
        opacity: 0.8,
        tags: ['logo', 'corner', 'watermark']
      }
    ]
  },

  {
    preset_id: 'triple-stack',
    name: 'Triple Stack (Header/Content/Footer)',
    description: 'Three horizontal zones - header, content, footer',
    is_builtin: true,
    category: 'layout',
    tags: ['stacked', 'header', 'footer'],
    layers: [
      {
        name: 'Header',
        layer_type: 'DataRow',
        content: {
          text: 'Header Area',
          backgroundColor: 'rgba(30, 58, 138, 230)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 36,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 0,
          width: 1920,
          height: 150
        },
        priority: 15,
        visible: true,
        opacity: 1.0,
        tags: ['zone-header']
      },
      {
        name: 'Main Content',
        layer_type: 'DataRow',
        content: {
          text: 'Main Content Area',
          backgroundColor: 'rgba(255, 255, 255, 255)',
          textColor: 'rgba(0, 0, 0, 255)',
          fontSize: 28,
          alignment: 'left'
        },
        position: {
          x: 0,
          y: 150,
          width: 1920,
          height: 840
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-content']
      },
      {
        name: 'Footer',
        layer_type: 'DataRow',
        content: {
          text: 'Footer Area - Additional Information',
          backgroundColor: 'rgba(55, 65, 81, 230)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 20,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 990,
          width: 1920,
          height: 90
        },
        priority: 15,
        visible: true,
        opacity: 1.0,
        tags: ['zone-footer']
      }
    ]
  },

  {
    preset_id: 'quad-split',
    name: 'Quad Split (Four Zones)',
    description: 'Four equal quadrants for multi-content display',
    is_builtin: true,
    category: 'layout',
    tags: ['quad', 'split', 'multi-zone'],
    layers: [
      {
        name: 'Top Left',
        layer_type: 'DataRow',
        content: {
          text: 'Zone 1',
          backgroundColor: 'rgba(239, 68, 68, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 28,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 0,
          width: 960,
          height: 540
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-tl', 'quadrant-1']
      },
      {
        name: 'Top Right',
        layer_type: 'DataRow',
        content: {
          text: 'Zone 2',
          backgroundColor: 'rgba(34, 197, 94, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 28,
          alignment: 'center'
        },
        position: {
          x: 960,
          y: 0,
          width: 960,
          height: 540
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-tr', 'quadrant-2']
      },
      {
        name: 'Bottom Left',
        layer_type: 'DataRow',
        content: {
          text: 'Zone 3',
          backgroundColor: 'rgba(59, 130, 246, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 28,
          alignment: 'center'
        },
        position: {
          x: 0,
          y: 540,
          width: 960,
          height: 540
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-bl', 'quadrant-3']
      },
      {
        name: 'Bottom Right',
        layer_type: 'DataRow',
        content: {
          text: 'Zone 4',
          backgroundColor: 'rgba(139, 92, 246, 200)',
          textColor: 'rgba(255, 255, 255, 255)',
          fontSize: 28,
          alignment: 'center'
        },
        position: {
          x: 960,
          y: 540,
          width: 960,
          height: 540
        },
        priority: 10,
        visible: true,
        opacity: 1.0,
        tags: ['zone-br', 'quadrant-4']
      }
    ]
  }
];

module.exports = BUILTIN_PRESETS;
