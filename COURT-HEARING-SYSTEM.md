# Court Hearing Integration System

## Overview

The Court Hearing Integration System automatically generates and manages display layers for court schedules across digital signage TVs. It provides a complete solution for displaying real-time court schedules with color-coded status indicators, automated updates, and centralized management.

## Features

### Core Functionality
- ✅ **Automated Layer Generation**: Converts court hearing data into visual display layers
- ✅ **Time-Based Color Coding**: Red (<15 min), Orange (<30 min), Blue (normal), Green (in progress), Gray (cancelled)
- ✅ **Status Management**: Track hearings through scheduled → in progress → completed workflow
- ✅ **Automated Refresh**: Cron jobs update displays every 5 minutes
- ✅ **Real-Time Updates**: MQTT integration for instant display updates
- ✅ **Multi-TV Support**: Automatically updates all TVs with layer support
- ✅ **CSV Import**: Bulk import hearings from court management systems
- ✅ **Web Admin UI**: Comprehensive interface for managing hearings

### Display Features
- Auto-stacking layout (50px rows, max 20 hearings)
- Responsive positioning starting at y=100
- Party names, case numbers, room assignments
- Delay indicators when applicable
- Daily schedule grouping

## Architecture

### Data Flow
```
Court Hearing Data (CouchDB)
    ↓
Court Display Service
    ↓
Layer Generation
    ↓
Layer Storage (CouchDB) + MQTT Broadcast
    ↓
TV Endpoints (pi-slideshow-rs)
```

### Components

#### Backend
1. **CourtHearing Model** (`src/models/CourtHearing.js`)
   - Data structure and validation
   - Query methods (by date, room, status)
   - CSV import capability
   - Layer conversion logic

2. **Court Hearing Controller** (`src/controllers/courtHearingController.js`)
   - REST API endpoints
   - Joi validation schemas
   - CRUD operations
   - Status management

3. **Court Display Service** (`src/services/courtDisplayService.js`)
   - Layer generation from hearings
   - Multi-TV refresh orchestration
   - MQTT publishing
   - Cleanup of old schedules

4. **Layer Automation** (`src/services/layerAutomation.js`)
   - 5-minute refresh cron job
   - 8 AM morning update
   - 2 AM nightly cleanup
   - Integration with court display service

#### Frontend
1. **Admin UI** (`public/court-schedule.html`)
   - Hearing management interface
   - CSV import form
   - Status update buttons
   - Live display preview

2. **JavaScript Manager** (`public/js/court-schedule.js`)
   - API communication
   - WebSocket real-time updates
   - CSV parsing
   - Display preview rendering

## API Endpoints

### Hearing Management
```
POST   /api/hearings              # Create hearing
GET    /api/hearings              # Get all hearings
GET    /api/hearings/today        # Get today's hearings
GET    /api/hearings/upcoming     # Get upcoming (24h)
GET    /api/hearings/date/:date   # Get hearings by date
GET    /api/hearings/room/:room   # Get hearings by room
GET    /api/hearings/stats        # Get statistics
GET    /api/hearings/:id          # Get specific hearing
PUT    /api/hearings/:id          # Update hearing
DELETE /api/hearings/:id          # Delete hearing
```

### Status Management
```
POST   /api/hearings/:id/delay       # Mark as delayed
POST   /api/hearings/:id/in-progress # Mark as in progress
POST   /api/hearings/:id/complete    # Mark as completed
POST   /api/hearings/:id/cancel      # Cancel hearing
```

### Display Control
```
POST   /api/hearings/refresh-display # Refresh all TV displays
POST   /api/hearings/import          # Import from CSV
```

## Usage

### Creating a Hearing

**Via Web UI:**
1. Visit `http://localhost:3000/court-schedule.html`
2. Fill out the "Add New Hearing" form
3. Click "Add Hearing"
4. Display automatically refreshes

**Via API:**
```bash
curl -X POST http://localhost:3000/api/hearings \
  -H "Content-Type: application/json" \
  -d '{
    "case_number": "CV-2025-12345",
    "court_room": "101",
    "scheduled_time": "2025-10-18T09:00:00Z",
    "hearing_type": "trial",
    "parties": {
      "plaintiff": "John Doe",
      "defendant": "Jane Smith"
    },
    "judge": "Hon. Robert Martinez"
  }'
```

### Importing from CSV

**CSV Format:**
```csv
case_number,court_room,scheduled_time,plaintiff,defendant,judge,hearing_type
CV-2025-001,101,2025-10-18T09:00:00Z,Smith Corp,Johnson LLC,Hon. Martinez,trial
CV-2025-002,205,2025-10-18T10:30:00Z,State of CA,Anderson,Hon. Chen,arraignment
```

**Via Web UI:**
1. Prepare CSV file with required columns
2. Click "Choose CSV File" button
3. Select file
4. System imports and creates hearings automatically

**Via API:**
```bash
curl -X POST http://localhost:3000/api/hearings/import \
  -H "Content-Type: application/json" \
  -d '{
    "csvData": [
      {
        "case_number": "CV-2025-001",
        "court_room": "101",
        "scheduled_time": "2025-10-18T09:00:00Z",
        "plaintiff": "Smith Corp",
        "defendant": "Johnson LLC",
        "judge": "Hon. Martinez",
        "hearing_type": "trial"
      }
    ]
  }'
```

### Managing Hearing Status

**Mark as Delayed:**
```bash
curl -X POST http://localhost:3000/api/hearings/{id}/delay \
  -H "Content-Type: application/json" \
  -d '{"minutes": 15, "reason": "Judge running late"}'
```

**Mark as In Progress:**
```bash
curl -X POST http://localhost:3000/api/hearings/{id}/in-progress
```

**Mark as Completed:**
```bash
curl -X POST http://localhost:3000/api/hearings/{id}/complete
```

**Cancel Hearing:**
```bash
curl -X POST http://localhost:3000/api/hearings/{id}/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "Settlement reached"}'
```

### Refreshing Displays

**Manual Refresh:**
```bash
curl -X POST http://localhost:3000/api/hearings/refresh-display
```

**Automated Refresh:**
- Every 5 minutes (via cron)
- Every morning at 8 AM
- Automatically on hearing create/update/delete

## Testing

### Prerequisites
1. CouchDB running and accessible
2. Multi-layer server running: `node src/server.multilayer.js`
3. At least one TV with layer support configured

### Running Demo Script

The demo script creates sample hearings and demonstrates all features:

```bash
node tests/demo-court-hearings.js
```

**What the demo does:**
1. Creates 8 today's hearings across different court rooms
2. Creates 2 upcoming hearings for tomorrow
3. Displays statistics
4. Refreshes all TV displays
5. Demonstrates status workflow (delay → in progress → complete)
6. Shows final statistics

**Expected output:**
```
🏛️ Court Hearing System Demo

Creating sample hearings...

✓ Created: CV-2025-00123 - 101 - 9:00:00 AM
✓ Created: CR-2025-00456 - 205 - 9:30:00 AM
✓ Created: CV-2025-00789 - 101 - 10:30:00 AM
...

📊 Statistics:
  Today's hearings: 8
  Upcoming (24h): 10
  In progress: 0
  Completed today: 0

🔄 Refreshing displays...
✓ Display refreshed:
  TVs updated: 2
  Hearings displayed: 8
  Layers created: 16
  Layers removed: 0

🔄 Demonstrating status changes...
  ✓ Marked as delayed
  ✓ Marked as in progress
  ✓ Marked as completed

✅ Demo complete!
```

### Manual Testing

1. **Create a hearing:**
   ```bash
   curl -X POST http://localhost:3000/api/hearings \
     -H "Content-Type: application/json" \
     -d '{"case_number":"TEST-001","court_room":"101","scheduled_time":"2025-10-18T14:00:00Z","parties":{"plaintiff":"Test A","defendant":"Test B"}}'
   ```

2. **Verify it appears in today's schedule:**
   ```bash
   curl http://localhost:3000/api/hearings/today
   ```

3. **Check display preview:**
   - Visit `http://localhost:3000/court-schedule.html`
   - Verify hearing appears in preview panel with correct color

4. **Test status workflow:**
   - Click "⏰ Delay" button, enter 15 minutes
   - Verify color changes to orange
   - Click "▶️ Start" button
   - Verify color changes to green
   - Click "✓ Complete" button
   - Verify hearing disappears from display

5. **Verify MQTT messages:**
   ```bash
   mosquitto_sub -h localhost -t 'signage_dev/tv/+/layer/#' -v
   ```
   - Should see layer add/remove messages when hearings change

## Layer Structure

Hearings are converted to DataRow layers with this structure:

```javascript
{
  tv_id: "tv_001",
  layer_type: "DataRow",
  name: "Court Hearing: CV-2025-12345",
  group: "court_schedule_2025-10-18",
  content: {
    text: "9:00 AM - Room 101 - Smith v. Johnson",
    backgroundColor: "rgba(30, 58, 138, 200)", // Blue
    textColor: "rgba(255, 255, 255, 255)",
    fontSize: 24,
    alignment: "left"
  },
  position: {
    x: 0,
    y: 100,  // Auto-positioned based on order
    width: 1920,
    height: 50
  },
  priority: 15,
  visible: true,
  opacity: 1.0,
  metadata: {
    hearing_id: "hearing_abc123",
    case_number: "CV-2025-12345",
    court_room: "101",
    scheduled_time: "2025-10-18T09:00:00Z",
    status: "scheduled"
  }
}
```

## Color Coding

| Condition | Color | RGBA |
|-----------|-------|------|
| Cancelled | Gray | rgba(128, 128, 128, 200) |
| In Progress | Green | rgba(34, 197, 94, 200) |
| Delayed | Orange | rgba(217, 119, 6, 200) |
| Starting <15min | Red | rgba(239, 68, 68, 200) |
| Starting <30min | Orange | rgba(217, 119, 6, 200) |
| Normal | Blue | rgba(30, 58, 138, 200) |

## Troubleshooting

### Hearings not appearing on TVs

1. Check TV has layer support:
   ```bash
   curl http://localhost:3000/api/tvs
   ```
   Verify `features.multi_layer === true`

2. Verify layers were created:
   ```bash
   curl http://localhost:3000/api/layers
   ```
   Look for layers with `group: "court_schedule_YYYY-MM-DD"`

3. Check MQTT messages:
   ```bash
   mosquitto_sub -h localhost -t 'signage_dev/tv/+/layer/#' -v
   ```

4. Manually refresh display:
   ```bash
   curl -X POST http://localhost:3000/api/hearings/refresh-display
   ```

### Display not updating

1. Check layer automation is running:
   - Server logs should show "Running scheduled court schedule refresh..." every 5 minutes

2. Verify cron jobs are active:
   ```javascript
   // In layerAutomation.js
   console.log(layerAutomationService.scheduledTasks);
   // Should show: court_refresh, morning_update, court_cleanup
   ```

3. Check CouchDB connection:
   ```bash
   curl http://192.168.1.215:5984/layers/_all_docs
   ```

### CSV import failing

1. Verify CSV format matches expected columns
2. Check date format is ISO 8601: `YYYY-MM-DDTHH:mm:ssZ`
3. Required fields: `case_number`, `court_room`, `scheduled_time`, `plaintiff`, `defendant`
4. Check server logs for validation errors

## Future Enhancements

- [ ] Multi-location filtering (show different hearings on different TV locations)
- [ ] Judge photo integration
- [ ] QR codes for case information
- [ ] Integration with court management systems (Tyler, Odyssey)
- [ ] Calendar view in admin UI
- [ ] Email notifications for hearing updates
- [ ] Audio announcements for upcoming hearings
- [ ] Mobile app for judges/clerks
- [ ] Accessibility features (text-to-speech, high contrast)

## Architecture Decisions

### Why separate Court Display Service?

The Court Display Service (`courtDisplayService.js`) is separate from the Court Hearing Controller to:
1. Separate domain logic (hearings) from presentation logic (layers)
2. Allow reuse of display generation across different triggers
3. Enable testing of layer generation independently
4. Support future multi-display strategies

### Why use layer groups?

Layer groups (`court_schedule_YYYY-MM-DD`) enable:
1. Batch deletion of old schedules
2. Efficient querying for today's layers
3. Isolation from other layer types
4. Easy cleanup of historical data

### Why auto-refresh every 5 minutes?

Balances between:
- Real-time updates (important for court schedules)
- Server load (regenerating all layers)
- MQTT message frequency
- Database write load

Can be adjusted in `src/services/layerAutomation.js`:
```javascript
const courtRefresh = cron.schedule('*/5 * * * *', async () => {
  // Change '*/5' to desired interval in minutes
});
```

## Related Documentation

- [Multi-Layer System](MULTILAYER-README.md)
- [Emergency Alerts](src/routes/alertRoutes.js)
- [Layer Management](src/models/Layer.js)
- [MQTT Integration](src/services/multilayer.mqttService.js)
