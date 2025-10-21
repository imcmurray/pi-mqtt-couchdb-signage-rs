# Alert Template System - API Testing Guide

## Prerequisites
- Server running at `http://localhost:3000`
- CouchDB initialized with alert_templates database
- Built-in templates loaded on server startup

## 1. Get All Templates

```bash
# Get all templates (built-in + custom)
curl http://localhost:3000/api/alerts/templates

# Filter by category
curl http://localhost:3000/api/alerts/templates?category=emergency
curl http://localhost:3000/api/alerts/templates?category=court
curl http://localhost:3000/api/alerts/templates?category=maintenance

# Filter by type (builtin or custom)
curl http://localhost:3000/api/alerts/templates?type=builtin
curl http://localhost:3000/api/alerts/templates?type=custom
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "template_id": "builtin_evacuation",
      "name": "Building Evacuation",
      "category": "emergency",
      "alert_type": "CRITICAL",
      "variables": ["building", "exit_route", "reason"],
      "is_builtin": true,
      "description": "Emergency building evacuation alert",
      "created_at": "2024-10-20T..."
    }
  ]
}
```

## 2. Get Template by ID

```bash
curl http://localhost:3000/api/alerts/templates/builtin_evacuation
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "builtin_evacuation",
    "name": "Building Evacuation",
    "category": "emergency",
    "title_template": "Building Evacuation - ${building}",
    "message_template": "Evacuate ${building} immediately via ${exit_route}. ${reason}",
    "alert_type": "CRITICAL",
    "variables": ["building", "exit_route", "reason"],
    "is_builtin": true,
    "description": "Emergency building evacuation alert"
  }
}
```

## 3. Create Custom Template

```bash
curl -X POST http://localhost:3000/api/alerts/templates \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Custom Court Delay",
    "category": "court",
    "title_template": "Case ${case_number} Update",
    "message_template": "Case ${case_number} has been delayed. New start time: ${new_time}. ${notes}",
    "alert_type": "URGENT",
    "description": "Custom template for court case delays",
    "created_by": "admin"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "template_1729425600000_abc123",
    "name": "Custom Court Delay",
    "variables": ["case_number", "new_time", "notes"],
    "is_builtin": false,
    "_id": "...",
    "_rev": "..."
  }
}
```

## 4. Update Custom Template

```bash
# Get the template_id from the create response first
curl -X PUT http://localhost:3000/api/alerts/templates/template_1729425600000_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Court Delay Template",
    "description": "Updated description for better clarity"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "template_1729425600000_abc123",
    "name": "Updated Court Delay Template",
    "description": "Updated description for better clarity",
    "updated_at": "2024-10-20T..."
  }
}
```

## 5. Preview Template Rendering

```bash
# Preview building evacuation template
curl -X POST http://localhost:3000/api/alerts/templates/builtin_evacuation/preview \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "building": "Main Hall",
      "exit_route": "south stairwell",
      "reason": "Fire drill in progress"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "template": {
    "name": "Building Evacuation",
    "category": "emergency",
    "type": "CRITICAL",
    "variables": ["building", "exit_route", "reason"]
  },
  "rendered": {
    "title": "Building Evacuation - Main Hall",
    "message": "Evacuate Main Hall immediately via south stairwell. Fire drill in progress",
    "type": "CRITICAL"
  },
  "layer": {
    "layer_type": "Emergency",
    "priority": 250,
    "position": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
    "content": {
      "text": "🚨 CRITICAL ALERT\n\nBuilding Evacuation - Main Hall\n\nEvacuate Main Hall immediately via south stairwell. Fire drill in progress",
      "backgroundColor": "rgba(220, 38, 38, 0.95)",
      "textColor": "rgba(255, 255, 255, 1)",
      "fontSize": 48
    }
  }
}
```

## 6. Preview with Missing Variables (Error Case)

```bash
curl -X POST http://localhost:3000/api/alerts/templates/builtin_evacuation/preview \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "building": "Main Hall"
    }
  }'
```

**Expected Response:**
```json
{
  "success": false,
  "errors": ["Missing variables: exit_route, reason"],
  "template": {
    "name": "Building Evacuation",
    "category": "emergency",
    "type": "CRITICAL"
  }
}
```

## 7. Quick-Send Alert from Template

```bash
# Send to all TVs
curl -X POST http://localhost:3000/api/alerts/templates/builtin_evacuation/send \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "building": "Building A",
      "exit_route": "north exit",
      "reason": "Fire detected on floor 3"
    },
    "target_type": "all",
    "created_by": "admin"
  }'

# Send to specific TVs
curl -X POST http://localhost:3000/api/alerts/templates/builtin_court_delay/send \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "room_number": "205",
      "delay_minutes": "30",
      "reason": "Judge delayed in traffic"
    },
    "target_type": "specific",
    "target_ids": ["tv_lobby", "tv_courtroom_205"],
    "created_by": "court_admin"
  }'

# Send to location
curl -X POST http://localhost:3000/api/alerts/templates/builtin_weather_alert/send \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "weather_type": "Tornado",
      "end_time": "4:30 PM",
      "instructions": "Seek shelter in basement immediately"
    },
    "target_type": "location",
    "target_location": "Building A",
    "created_by": "admin"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "alert": {
      "alert_id": "alert_1729425700000_xyz789",
      "title": "Building Evacuation - Building A",
      "message": "Evacuate Building A immediately via north exit. Fire detected on floor 3",
      "type": "CRITICAL",
      "template_id": "builtin_evacuation"
    },
    "delivered_count": 8,
    "target_count": 8
  }
}
```

## 8. Duplicate Template

```bash
# Duplicate built-in template to create custom version
curl -X POST http://localhost:3000/api/alerts/templates/builtin_evacuation/duplicate \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Custom Evacuation Alert"
  }'

# Without name (auto-generates "Original Name (Copy)")
curl -X POST http://localhost:3000/api/alerts/templates/builtin_fire_alarm/duplicate \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "template_id": "template_1729425800000_def456",
    "name": "My Custom Evacuation Alert",
    "is_builtin": false,
    "category": "emergency",
    "alert_type": "CRITICAL",
    "title_template": "Building Evacuation - ${building}",
    "message_template": "Evacuate ${building} immediately via ${exit_route}. ${reason}"
  }
}
```

## 9. Search Templates

```bash
# Search by name
curl "http://localhost:3000/api/alerts/templates/search?q=evacuation"

# Search by category
curl "http://localhost:3000/api/alerts/templates/search?q=court"

# Search by description
curl "http://localhost:3000/api/alerts/templates/search?q=fire"

# Case-insensitive
curl "http://localhost:3000/api/alerts/templates/search?q=WEATHER"
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "template_id": "builtin_evacuation",
      "name": "Building Evacuation",
      "category": "emergency",
      "alert_type": "CRITICAL",
      "variables": ["building", "exit_route", "reason"],
      "is_builtin": true,
      "description": "Emergency building evacuation alert"
    }
  ]
}
```

## 10. Get Template Statistics

```bash
curl http://localhost:3000/api/alerts/templates/stats
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "total": 12,
    "builtin": 10,
    "custom": 2,
    "by_category": {
      "emergency": 4,
      "court": 3,
      "maintenance": 1,
      "weather": 1,
      "general": 3
    },
    "by_type": {
      "CRITICAL": 4,
      "URGENT": 5,
      "INFO": 3
    }
  }
}
```

## 11. Delete Custom Template

```bash
curl -X DELETE http://localhost:3000/api/alerts/templates/template_1729425600000_abc123
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Template deleted successfully"
}
```

## 12. Attempt to Delete Built-in Template (Error Case)

```bash
curl -X DELETE http://localhost:3000/api/alerts/templates/builtin_evacuation
```

**Expected Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Cannot delete built-in templates"
}
```

## 13. Attempt to Update Built-in Template (Error Case)

```bash
curl -X PUT http://localhost:3000/api/alerts/templates/builtin_evacuation \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Modified Evacuation"
  }'
```

**Expected Response (400 Bad Request):**
```json
{
  "success": false,
  "error": "Cannot update built-in templates"
}
```

## Testing Workflow

### Complete Test Sequence:

```bash
#!/bin/bash
API_BASE="http://localhost:3000/api/alerts/templates"

echo "1. Get all templates..."
curl -s $API_BASE | jq '.data | length'

echo "\n2. Get built-in templates..."
curl -s "$API_BASE?type=builtin" | jq '.data | length'

echo "\n3. Get emergency category..."
curl -s "$API_BASE?category=emergency" | jq '.data[].name'

echo "\n4. Preview evacuation template..."
curl -s -X POST $API_BASE/builtin_evacuation/preview \
  -H "Content-Type: application/json" \
  -d '{"variables":{"building":"Test Building","exit_route":"main exit","reason":"test"}}' \
  | jq '.rendered'

echo "\n5. Create custom template..."
CUSTOM_TEMPLATE=$(curl -s -X POST $API_BASE \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Test Template",
    "category":"general",
    "title_template":"Test ${var}",
    "message_template":"Message ${var}",
    "alert_type":"INFO"
  }' | jq -r '.data.template_id')

echo "Created template: $CUSTOM_TEMPLATE"

echo "\n6. Search for template..."
curl -s "$API_BASE/search?q=test" | jq '.data[].name'

echo "\n7. Delete custom template..."
curl -s -X DELETE $API_BASE/$CUSTOM_TEMPLATE | jq '.'

echo "\n8. Verify deletion..."
curl -s "$API_BASE?type=custom" | jq '.data | length'
```

## Built-in Templates Reference

| Template ID | Name | Category | Type | Variables |
|-------------|------|----------|------|-----------|
| `builtin_evacuation` | Building Evacuation | emergency | CRITICAL | building, exit_route, reason |
| `builtin_fire_alarm` | Fire Alarm | emergency | CRITICAL | floor |
| `builtin_security_alert` | Security Alert | emergency | CRITICAL | location, instructions, phone |
| `builtin_weather_alert` | Weather Alert | weather | URGENT | weather_type, end_time, instructions |
| `builtin_court_delay` | Court Room Delay | court | URGENT | room_number, delay_minutes, reason |
| `builtin_court_cancelled` | Court Hearing Cancelled | court | URGENT | case_number, time, reason |
| `builtin_court_recess` | Court in Recess | court | INFO | room_number, resume_time |
| `builtin_facility_closure` | Facility Closure | general | URGENT | facility, reason, reopen_time |
| `builtin_maintenance` | Maintenance Notice | maintenance | INFO | system, start_time, end_time, impact |
| `builtin_general_announcement` | General Announcement | general | INFO | title, message |

## Error Codes

| Status Code | Meaning | Example |
|-------------|---------|---------|
| 200 | Success | GET, DELETE successful |
| 201 | Created | POST successful |
| 400 | Bad Request | Validation error, trying to modify built-in |
| 404 | Not Found | Template doesn't exist |
| 500 | Server Error | Database/MQTT connection issue |

## Common Validation Errors

```json
// Missing required field
{
  "success": false,
  "error": "\"name\" is required"
}

// Invalid category
{
  "success": false,
  "error": "Invalid category. Must be one of: emergency, court, maintenance, weather, general"
}

// Invalid alert type
{
  "success": false,
  "error": "Invalid alert type. Must be CRITICAL, URGENT, or INFO"
}

// Template not found
{
  "success": false,
  "error": "Template not found: invalid_id"
}
```
