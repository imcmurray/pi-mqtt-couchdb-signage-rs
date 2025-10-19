const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Digital Signage Management API',
      version: '0.2.0',
      description: `
# Digital Signage Management System API

Comprehensive REST API for managing digital signage displays with multi-layer compositing,
court hearing schedules, emergency alerts, and real-time control via MQTT.

## Features
- Multi-layer display compositing with animations
- Court hearing schedule integration
- Emergency alert broadcasting
- Zone preset templates for quick configuration
- Bulk operations for multi-TV management
- Real-time MQTT communication
- Image management with CouchDB attachments

## Architecture
- **Database**: CouchDB for persistent storage
- **Messaging**: MQTT for real-time communication
- **Frontend**: Web-based management UI
- **Display Client**: Rust-based slideshow renderer
      `.trim(),
      contact: {
        name: 'API Support'
      },
      license: {
        name: 'ISC'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      },
      {
        url: 'http://localhost:3001',
        description: 'Test server'
      }
    ],
    tags: [
      {
        name: 'TVs',
        description: 'TV display management endpoints'
      },
      {
        name: 'Images',
        description: 'Image upload and assignment management'
      },
      {
        name: 'Layers',
        description: 'Multi-layer compositing and animation control'
      },
      {
        name: 'Presets',
        description: 'Zone preset templates for quick layer configuration'
      },
      {
        name: 'Alerts',
        description: 'Emergency alert broadcasting system'
      },
      {
        name: 'Court Hearings',
        description: 'Court hearing schedule management'
      },
      {
        name: 'Bulk Operations',
        description: 'Multi-TV and batch operations'
      },
      {
        name: 'Dashboard',
        description: 'System overview and statistics'
      },
      {
        name: 'Health',
        description: 'System health and version information'
      }
    ],
    components: {
      securitySchemes: {
        AdminAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Admin-Token',
          description: 'Administrator authentication token'
        },
        TVToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-TV-Token',
          description: 'TV device registration token'
        }
      },
      schemas: {
        // TV Schemas
        TV: {
          type: 'object',
          required: ['tv_id', 'name', 'location'],
          properties: {
            _id: {
              type: 'string',
              description: 'Database document ID'
            },
            _rev: {
              type: 'string',
              description: 'Database document revision'
            },
            tv_id: {
              type: 'string',
              description: 'Unique TV identifier',
              example: 'lobby-tv-1'
            },
            name: {
              type: 'string',
              description: 'Human-readable TV name',
              example: 'Lobby Display'
            },
            location: {
              type: 'string',
              description: 'Physical location of the TV',
              example: 'Main Lobby'
            },
            ip_address: {
              type: 'string',
              format: 'ipv4',
              description: 'IP address of the TV',
              example: '192.168.1.100'
            },
            status: {
              type: 'string',
              enum: ['online', 'offline', 'error'],
              description: 'Current TV status'
            },
            last_seen: {
              type: 'string',
              format: 'date-time',
              description: 'Last heartbeat timestamp'
            },
            config: {
              type: 'object',
              description: 'TV configuration settings',
              properties: {
                transition_effect: {
                  type: 'string',
                  enum: ['fade', 'slide', 'none'],
                  default: 'fade'
                },
                display_duration: {
                  type: 'integer',
                  minimum: 1000,
                  maximum: 60000,
                  default: 5000,
                  description: 'Duration to display each image (ms)'
                },
                resolution: {
                  type: 'string',
                  enum: ['1920x1080', '1280x720', '3840x2160'],
                  default: '1920x1080'
                },
                orientation: {
                  type: 'string',
                  enum: ['landscape', 'portrait'],
                  default: 'landscape'
                },
                layer_settings: {
                  type: 'object',
                  description: 'Multi-layer configuration',
                  properties: {
                    max_layers: {
                      type: 'integer',
                      minimum: 1,
                      maximum: 20,
                      default: 10
                    },
                    compositing_timeout_ms: {
                      type: 'integer',
                      default: 5000
                    },
                    cache_composites: {
                      type: 'boolean',
                      default: true
                    }
                  }
                }
              }
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            updated_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },

        // Image Schemas
        Image: {
          type: 'object',
          required: ['original_filename'],
          properties: {
            _id: {
              type: 'string'
            },
            _rev: {
              type: 'string'
            },
            original_filename: {
              type: 'string',
              example: 'logo.png'
            },
            title: {
              type: 'string',
              example: 'Company Logo'
            },
            description: {
              type: 'string'
            },
            tags: {
              type: 'array',
              items: {
                type: 'string'
              },
              example: ['logo', 'branding']
            },
            tv_assignments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tv_id: {
                    type: 'string'
                  },
                  order: {
                    type: 'integer'
                  }
                }
              }
            },
            file_size: {
              type: 'integer',
              description: 'File size in bytes'
            },
            dimensions: {
              type: 'object',
              properties: {
                width: {
                  type: 'integer'
                },
                height: {
                  type: 'integer'
                }
              }
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },

        // Layer Schemas
        Layer: {
          type: 'object',
          required: ['tv_id', 'layer_id', 'layer_type', 'position'],
          properties: {
            _id: {
              type: 'string'
            },
            _rev: {
              type: 'string'
            },
            tv_id: {
              type: 'string',
              description: 'TV this layer belongs to'
            },
            layer_id: {
              type: 'string',
              description: 'Unique layer identifier',
              example: 'layer_1234567890_abc123'
            },
            name: {
              type: 'string',
              description: 'Human-readable layer name',
              example: 'Court Schedule Display'
            },
            layer_type: {
              type: 'string',
              enum: ['DataRow', 'StaticOverlay', 'DynamicText', 'Emergency'],
              description: 'Type of layer content'
            },
            content: {
              type: 'object',
              description: 'Layer content configuration',
              properties: {
                text: {
                  type: 'string'
                },
                backgroundColor: {
                  type: 'string',
                  pattern: '^rgba?\\(',
                  example: 'rgba(0, 0, 0, 0.8)'
                },
                textColor: {
                  type: 'string',
                  pattern: '^rgba?\\(',
                  example: 'rgba(255, 255, 255, 1)'
                },
                fontSize: {
                  type: 'integer',
                  minimum: 8,
                  maximum: 200,
                  default: 24
                },
                fontFamily: {
                  type: 'string',
                  default: 'Arial'
                },
                padding: {
                  type: 'integer',
                  default: 10
                },
                alignment: {
                  type: 'string',
                  enum: ['left', 'center', 'right'],
                  default: 'left'
                },
                image_url: {
                  type: 'string',
                  description: 'URL for StaticOverlay images'
                }
              }
            },
            position: {
              type: 'object',
              required: ['x', 'y', 'width', 'height'],
              properties: {
                x: {
                  type: 'integer',
                  minimum: 0,
                  description: 'X coordinate in pixels'
                },
                y: {
                  type: 'integer',
                  minimum: 0,
                  description: 'Y coordinate in pixels'
                },
                width: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Width in pixels'
                },
                height: {
                  type: 'integer',
                  minimum: 1,
                  description: 'Height in pixels'
                }
              }
            },
            visible: {
              type: 'boolean',
              default: true
            },
            opacity: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              default: 1.0
            },
            priority: {
              type: 'integer',
              minimum: 0,
              default: 10,
              description: 'Higher priority layers render on top'
            },
            animation_state: {
              type: 'object',
              properties: {
                active: {
                  type: 'boolean'
                },
                type: {
                  type: 'string',
                  enum: ['slide_up', 'slide_down', 'slide_left', 'slide_right', 'fade_in', 'fade_out', null]
                },
                duration: {
                  type: 'integer',
                  default: 500
                },
                easing: {
                  type: 'string',
                  default: 'ease-in-out'
                }
              }
            },
            schedule: {
              type: 'object',
              properties: {
                enabled: {
                  type: 'boolean',
                  default: false
                },
                show_at: {
                  type: 'string',
                  format: 'date-time',
                  nullable: true
                },
                hide_at: {
                  type: 'string',
                  format: 'date-time',
                  nullable: true
                },
                auto_hide_after_ms: {
                  type: 'integer',
                  nullable: true,
                  description: 'Auto-hide after this duration'
                }
              }
            },
            tags: {
              type: 'array',
              items: {
                type: 'string'
              },
              example: ['court-schedule', 'from-preset']
            },
            group: {
              type: 'string',
              nullable: true,
              description: 'Group identifier for batch operations'
            },
            metadata: {
              type: 'object',
              description: 'Additional metadata',
              additionalProperties: true
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            updated_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },

        // Preset Schemas
        Preset: {
          type: 'object',
          required: ['preset_id', 'name', 'layers'],
          properties: {
            _id: {
              type: 'string'
            },
            _rev: {
              type: 'string'
            },
            preset_id: {
              type: 'string',
              example: 'court-schedule-left'
            },
            name: {
              type: 'string',
              example: 'Court Schedule (Left)'
            },
            description: {
              type: 'string'
            },
            is_builtin: {
              type: 'boolean',
              default: false,
              description: 'Whether this is a system preset'
            },
            category: {
              type: 'string',
              enum: ['court', 'emergency', 'info', 'layout', 'custom'],
              default: 'custom'
            },
            layers: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                description: 'Layer configuration template'
              }
            },
            preview: {
              type: 'object',
              properties: {
                thumbnail_url: {
                  type: 'string',
                  nullable: true
                },
                screenshot_url: {
                  type: 'string',
                  nullable: true
                },
                layout_diagram: {
                  type: 'string',
                  description: 'ASCII layout diagram'
                }
              }
            },
            usage_count: {
              type: 'integer',
              default: 0,
              description: 'Number of times preset has been applied'
            },
            last_used: {
              type: 'string',
              format: 'date-time',
              nullable: true
            },
            created_by: {
              type: 'string',
              default: 'system'
            },
            tags: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },

        // Alert Schemas
        Alert: {
          type: 'object',
          required: ['title', 'message', 'type'],
          properties: {
            alert_id: {
              type: 'string'
            },
            title: {
              type: 'string',
              maxLength: 100,
              example: 'Building Evacuation'
            },
            message: {
              type: 'string',
              maxLength: 500,
              example: 'Evacuate immediately via nearest exit'
            },
            type: {
              type: 'string',
              enum: ['CRITICAL', 'URGENT', 'INFO'],
              description: 'Alert severity level'
            },
            priority: {
              type: 'integer',
              description: 'Display priority (auto-assigned based on type)',
              example: 250
            },
            background_color: {
              type: 'string',
              description: 'Background color (auto-assigned based on type)'
            },
            auto_dismiss_ms: {
              type: 'integer',
              description: 'Auto-dismiss duration in milliseconds'
            },
            target_type: {
              type: 'string',
              enum: ['all', 'specific', 'location'],
              default: 'all'
            },
            target_ids: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Target TV IDs for specific broadcast'
            },
            target_location: {
              type: 'string',
              description: 'Target location for location-based broadcast'
            },
            status: {
              type: 'string',
              enum: ['active', 'dismissed', 'expired'],
              default: 'active'
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            dismissed_at: {
              type: 'string',
              format: 'date-time',
              nullable: true
            }
          }
        },

        // Court Hearing Schemas
        CourtHearing: {
          type: 'object',
          required: ['hearing_id', 'case_number', 'scheduled_time', 'courtroom'],
          properties: {
            _id: {
              type: 'string'
            },
            hearing_id: {
              type: 'string'
            },
            case_number: {
              type: 'string',
              example: '2024-CV-12345'
            },
            case_title: {
              type: 'string',
              example: 'Smith vs. Jones'
            },
            hearing_type: {
              type: 'string',
              enum: ['civil', 'criminal', 'family', 'probate', 'traffic', 'other'],
              default: 'civil'
            },
            scheduled_time: {
              type: 'string',
              format: 'date-time',
              description: 'Scheduled hearing start time'
            },
            expected_duration_minutes: {
              type: 'integer',
              minimum: 5,
              maximum: 480,
              default: 60
            },
            courtroom: {
              type: 'string',
              example: 'Courtroom 1A'
            },
            judge: {
              type: 'string',
              example: 'Hon. Jane Smith'
            },
            parties: {
              type: 'object',
              properties: {
                plaintiff: {
                  type: 'string'
                },
                defendant: {
                  type: 'string'
                },
                attorneys: {
                  type: 'array',
                  items: {
                    type: 'string'
                  }
                }
              }
            },
            status: {
              type: 'string',
              enum: ['scheduled', 'delayed', 'in_progress', 'completed', 'cancelled'],
              default: 'scheduled'
            },
            delay_minutes: {
              type: 'integer',
              minimum: 0,
              default: 0
            },
            notes: {
              type: 'string'
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            updated_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },

        // Common Response Schemas
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            data: {
              type: 'object',
              description: 'Response payload'
            },
            message: {
              type: 'string',
              example: 'Operation completed successfully'
            }
          }
        },

        ErrorResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'Resource not found'
            },
            details: {
              type: 'object',
              description: 'Additional error details',
              additionalProperties: true
            }
          }
        },

        ValidationError: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'Validation failed'
            },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: {
                    type: 'string'
                  },
                  message: {
                    type: 'string'
                  }
                }
              }
            }
          }
        },

        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'ok'
            },
            mode: {
              type: 'string',
              example: 'multi-layer'
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            },
            databases: {
              type: 'object',
              properties: {
                tvs: {
                  type: 'string'
                },
                images: {
                  type: 'string'
                },
                layers: {
                  type: 'string'
                }
              }
            },
            mqtt_prefix: {
              type: 'string',
              example: 'signage/multi'
            }
          }
        },

        VersionResponse: {
          type: 'object',
          properties: {
            commit_hash: {
              type: 'string'
            },
            commit_short: {
              type: 'string'
            },
            branch: {
              type: 'string'
            },
            build_time: {
              type: 'string',
              format: 'date-time'
            },
            version: {
              type: 'string',
              example: 'v0.2.0-19-ga03be7e'
            },
            management_ui_version: {
              type: 'string',
              example: '0.2.0'
            },
            is_dirty: {
              type: 'boolean'
            },
            mode: {
              type: 'string'
            }
          }
        }
      }
    }
  },
  apis: [
    path.join(__dirname, '../controllers/*.js'),
    path.join(__dirname, '../server.multilayer.js')
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
