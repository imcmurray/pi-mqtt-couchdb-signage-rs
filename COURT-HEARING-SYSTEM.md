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
- ✅ **JSON Import**: Flexible import from court APIs with field mapping
- ✅ **Bankruptcy Court Support**: Specialized fields for Chapter 7/11/13 cases
- ✅ **Smart Text Abbreviation**: Intelligent truncation of long legal descriptions
- ✅ **Web Admin UI**: Comprehensive interface for managing hearings

### Display Features
- Auto-stacking layout (50px rows, max 20 hearings)
- Responsive positioning starting at y=100
- Flexible display format: Case Number + Debtor Names + Abbreviated Matter
- Smart abbreviation of long hearing descriptions (150+ chars → ~80 chars)
- Support for both traditional litigation (plaintiff v. defendant) and bankruptcy cases
- Organized by court room, then time within each room
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
   - Bankruptcy-specific fields (case_title, hearing_matter, case_chapter, hearing_moving_party, docket_entry)
   - Query methods (by date, room, status)
   - CSV and JSON import capability
   - Layer conversion logic with smart abbreviation

2. **Hearing Import Service** (`src/services/hearingImportService.js`)
   - JSON/XML data parsing with flexible field mapping
   - Court calendar date format parsing ("Wednesday, October 29, 2025 - 09:30")
   - Bulk import with error handling and reporting
   - Support for multiple field naming conventions

3. **Legal Abbreviations Utility** (`src/utils/legalAbbreviations.js`)
   - Dictionary of common legal term abbreviations
   - Intelligent truncation algorithm for long hearing matters
   - Debtor name abbreviation for multiple parties
   - Format-preserving abbreviation (preserves first/last names)

4. **Court Hearing Controller** (`src/controllers/courtHearingController.js`)
   - REST API endpoints
   - Joi validation schemas
   - CRUD operations
   - Status management

5. **Court Display Service** (`src/services/courtDisplayService.js`)
   - Layer generation from hearings
   - Multi-TV refresh orchestration
   - MQTT publishing
   - Cleanup of old schedules

6. **Layer Automation** (`src/services/layerAutomation.js`)
   - 5-minute refresh cron job
   - 8 AM morning update
   - 2 AM nightly cleanup
   - Integration with court display service

#### Frontend
1. **Admin UI** (`public/court-schedule.html`)
   - Hearing management interface
   - Bankruptcy-specific fields (debtor names, hearing matter, chapter, moving party, docket entry)
   - CSV import form
   - JSON paste/import interface
   - Status update buttons
   - Live display preview with smart abbreviation

2. **JavaScript Manager** (`public/js/court-schedule.js`)
   - API communication
   - WebSocket real-time updates
   - CSV parsing
   - JSON import with validation
   - Display preview rendering with bankruptcy field support

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
POST   /api/hearings/import/json     # Import from JSON
```

## Usage

### Creating a Hearing

**Via Web UI:**
1. Visit `http://localhost:3000/court-schedule.html`
2. Fill out the "Add New Hearing" form
3. Click "Add Hearing"
4. Display automatically refreshes

**Via API (Traditional Case):**
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

**Via API (Bankruptcy Case):**
```bash
curl -X POST http://localhost:3000/api/hearings \
  -H "Content-Type: application/json" \
  -d '{
    "case_number": "25-00001-TLM",
    "court_room": "1",
    "scheduled_time": "2025-10-29T09:30:00Z",
    "case_title": "Savanna G Smith",
    "hearing_matter": "Motion to Redeem Property of the Estate (Chapter 7, TM Powers) re: 2024 Kia Sportage",
    "case_chapter": "7",
    "hearing_moving_party": "Beutler, Derek",
    "judge": "Hon. Terry L. Myers",
    "docket_entry": "1720973"
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

### Importing from JSON

The JSON import feature supports flexible field mapping and handles multiple date formats commonly used by court systems.

**Via Web UI:**
1. Visit `http://localhost:3000/court-schedule.html`
2. Scroll to "Import from JSON" section
3. Paste JSON array or single object into the text area
4. Click "Import JSON"
5. System automatically maps fields and creates hearings

**Via API:**
```bash
curl -X POST http://localhost:3000/api/hearings/import/json \
  -H "Content-Type: application/json" \
  -d '[
    {
      "Case Number": "25-00001-TLM",
      "Hearing Date & Time": "Wednesday, October 29, 2025 - 09:30",
      "Court Room": "1",
      "Case Title": "Savanna G Smith",
      "Hearing Matter": "Motion to Redeem Property of the Estate",
      "Case Chapter": "7",
      "Hearing Moving Party": "Beutler, Derek",
      "Hearing Judge": "Terry L. Myers",
      "Docket Entry": "1720973"
    }
  ]'
```

**Supported Field Names (flexible mapping):**
- `"Case Number"` or `"case_number"`
- `"Hearing Date & Time"` or `"scheduled_time"`
- `"Court Room"` or `"court_room"` or `"courtRoom"`
- `"Case Title"` or `"case_title"` or `"caseTitle"`
- `"Hearing Matter"` or `"hearing_matter"` or `"hearingMatter"`
- `"Case Chapter"` or `"case_chapter"` or `"caseChapter"`
- `"Hearing Moving Party"` or `"hearing_moving_party"` or `"movingParty"`
- `"Hearing Judge"` or `"judge"`
- `"Docket Entry"` or `"docket_entry"` or `"docketEntry"`

**Supported Date Formats:**
- ISO 8601: `"2025-10-29T09:30:00Z"`
- Court Calendar: `"Wednesday, October 29, 2025 - 09:30"`
- Any standard JavaScript parseable date string

**Demo File:**
See `tests/demo-bankruptcy-hearings.json` for complete example data with three bankruptcy hearing cases.

**Response Format:**
```json
{
  "success": true,
  "imported": 3,
  "failed": 0,
  "errors": [],
  "message": "Successfully imported 3 hearings"
}
```

If some hearings fail validation:
```json
{
  "success": true,
  "imported": 2,
  "failed": 1,
  "errors": [
    {
      "case_number": "25-00002-TLM",
      "error": "Invalid date format: Not a valid date"
    }
  ],
  "message": "Successfully imported 2 hearings, 1 failed"
}
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

**Traditional Litigation Case:**
```javascript
{
  tv_id: "tv_001",
  layer_type: "DataRow",
  name: "Court Hearing: CV-2025-12345",
  group: "court_schedule_2025-10-18",
  content: {
    text: "9:00 AM - Rm 101 - CV-2025-12345 - Smith v. Johnson - Trial",
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

**Bankruptcy Case (with smart abbreviation):**
```javascript
{
  tv_id: "tv_001",
  layer_type: "DataRow",
  name: "Court Hearing: 25-00001-TLM",
  group: "court_schedule_2025-10-29",
  content: {
    text: "9:30 AM - Rm 1 - 25-00001-TLM - Savanna G Smith - Mot. to Redeem Prop. of the Estate (Ch 7, TM Powers) re: 2024 Kia...",
    backgroundColor: "rgba(30, 58, 138, 200)",
    textColor: "rgba(255, 255, 255, 255)",
    fontSize: 24,
    alignment: "left"
  },
  position: {
    x: 0,
    y: 100,
    width: 1920,
    height: 50
  },
  priority: 15,
  visible: true,
  opacity: 1.0,
  metadata: {
    hearing_id: "hearing_xyz789",
    case_number: "25-00001-TLM",
    court_room: "1",
    scheduled_time: "2025-10-29T09:30:00Z",
    status: "scheduled"
  }
}
```

**Display Format:**
- `{time} - Rm {room} - {case_number} - {debtor_names or parties} - {abbreviated_matter}`
- Hearings are automatically sorted by court room, then by time within each room
- Long hearing matters are intelligently abbreviated using legal term dictionary
- Format adapts to available data (traditional vs. bankruptcy cases)

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
3. Required fields: `case_number`, `court_room`, `scheduled_time`
4. Either `parties` (plaintiff/defendant) OR `case_title` must be provided
5. Check server logs for validation errors

### JSON import failing

1. Verify JSON is valid (use JSON validator)
2. Check field names match supported formats (see "Supported Field Names" above)
3. Verify date format is supported:
   - ISO 8601: `"2025-10-29T09:30:00Z"`
   - Court calendar: `"Wednesday, October 29, 2025 - 09:30"`
4. Review error details in the response:
   ```json
   {
     "errors": [
       {"case_number": "25-00001", "error": "Invalid date format: xyz"}
     ]
   }
   ```
5. Test with `tests/demo-bankruptcy-hearings.json` to verify system is working

## Future Enhancements

### Completed
- [x] JSON import for court APIs
- [x] Bankruptcy court support (Chapter 7/11/13)
- [x] Smart abbreviation for long legal text
- [x] Room-based sorting

### Planned
- [ ] Multi-location filtering (show different hearings on different TV locations)
- [ ] Judge photo integration
- [ ] QR codes for case information
- [ ] Direct integration with court management systems (Tyler Technologies, Odyssey, etc.)
- [ ] XML import support
- [ ] Calendar view in admin UI
- [ ] Email notifications for hearing updates
- [ ] Audio announcements for upcoming hearings
- [ ] Mobile app for judges/clerks
- [ ] Accessibility features (text-to-speech, high contrast)
- [ ] Multi-judge hearing support
- [ ] Hearing room availability tracking
- [ ] Export hearing reports (PDF, Excel)

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
