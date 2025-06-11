# Layering System Development Roadmap

## Overview
Developing a comprehensive layering system for the Digital Signage Management System with zone-based presets, orientation support, and emergency overlay capabilities.

## Development Phases

### Phase 1: Foundation - Orientation Support ✅
**Status**: COMPLETED  
**Goal**: Get portrait TVs working with current slideshow system  
**Branch**: `feature/orientation-support`

**Tasks:**
- [x] Detect framebuffer orientation (portrait vs landscape) in pi-slideshow-rs
- [x] Update image scaling/positioning logic for orientation awareness
- [x] Add orientation setting to TV configuration in management UI
- [x] Update TV model and form handling for orientation support
- [x] Implement automatic orientation detection and scaling
- [x] Complete orientation support implementation

**Technical Details:**
- Portrait resolution: 1080x1920
- Landscape resolution: 1920x1080
- Portrait-specific image libraries (separate from landscape)
- No complex transformations - native orientation rendering

**Deliverable**: Portrait TVs can display portrait images properly with existing slideshow functionality

**Definition of Done:**
- Portrait TVs render images without distortion
- Management UI can configure TV orientation
- Both orientations work with all existing transition effects
- Performance is acceptable on portrait displays

---

### Phase 2: Basic Layer Infrastructure ⏳
**Status**: Not Started  
**Goal**: Add simple layer compositing to existing system  
**Branch**: `feature/basic-layering`

**Tasks:**
- [ ] Extract and generalize existing transition blending code
- [ ] Create Layer and LayerManager structures
- [ ] Implement basic 2-layer compositing (background + overlay)
- [ ] Add layer configuration to TV settings
- [ ] Test simple logo overlay on slideshow

**Technical Details:**
- Reuse existing `blend_images_simple()` infrastructure
- Support PNG overlays with alpha channels
- Configurable overlay positions and opacity
- Layer priority system foundation

**Deliverable**: Can show static logo overlay on slideshow background

**Definition of Done:**
- Logo overlays display correctly on both orientations
- Overlay positioning is configurable
- Performance impact is minimal
- Alpha blending works properly

---

### Phase 3: Zone System & Presets ⏳
**Status**: Not Started  
**Goal**: Replace manual layer config with zone-based presets  
**Branch**: `feature/zone-presets`

**Tasks:**
- [ ] Define preset structure and zone types
- [ ] Create built-in preset templates
- [ ] Implement preset selection in management UI
- [ ] Convert Phase 2 manual configs to preset system
- [ ] Add preset validation and error handling

**Technical Details:**
Zone types:
- `slideshow`: Transitioning image background
- `static_overlay`: Fixed images (logos, seals)
- `dynamic_text`: Real-time text (date/time)
- `emergency_overlay`: High-priority conditional overlays

Built-in presets:
- "Basic Courtroom" (landscape/portrait)
- "Lobby Display" (landscape/portrait)  
- "Emergency Station" (landscape/portrait)
- "Information Kiosk" (landscape)

**Deliverable**: Users can select preset templates like "Courtroom" or "Lobby"

**Definition of Done:**
- Built-in presets work on both orientations
- Preset selection is intuitive in management UI
- Zone positioning is accurate
- Presets can be applied to multiple TVs easily

---

### Phase 4: Advanced Layer Types ⏳
**Status**: Not Started  
**Goal**: Add dynamic content and emergency overlays  
**Branch**: `feature/advanced-layers`

**Tasks:**
- [ ] Implement dynamic text rendering (date/time)
- [ ] Create emergency overlay system with priorities
- [ ] Add conditional layer visibility
- [ ] Implement priority-based layer ordering
- [ ] Add performance optimizations for portrait TVs
- [ ] Create emergency message management interface

**Technical Details:**
- Priority system: 0-255 (higher = on top)
- Emergency zones: priority 200+
- Conditional visibility triggers
- Performance modes for lower-end hardware

**Deliverable**: Full layering system with emergency capabilities

**Definition of Done:**
- Date/time displays update in real-time
- Emergency messages can overlay any content
- Layer priorities work correctly
- Performance is acceptable on all hardware
- Emergency messages can be triggered from management UI

---

### Phase 5: Management Interface Polish ⏳
**Status**: Not Started  
**Goal**: Make preset management user-friendly  
**Branch**: `feature/preset-editor`

**Tasks:**
- [ ] Create visual preset editor interface
- [ ] Implement custom preset creation/editing
- [ ] Add live preview system
- [ ] Create preset import/export functionality
- [ ] Add preset sharing between TVs
- [ ] Comprehensive testing and bug fixes

**Technical Details:**
- Drag-and-drop zone positioning
- Real-time preview of changes
- Preset templates as starting points
- JSON-based preset storage

**Deliverable**: Complete, polished layering system with visual editor

**Definition of Done:**
- Users can create custom presets visually
- Live preview shows changes immediately
- Presets can be shared across TV installations
- System is stable and well-documented

---

## Future Enhancements (Post-Launch)

### Dynamic Content Integration
- RSS feed support
- Court hearing schedule display
- Weather widgets
- Building announcements

### Advanced Features
- Animation effects for layers
- Video layer support
- Interactive content
- Scheduling system for layer visibility

---

## Progress Tracking

**Current Phase**: Phase 2 - Basic Layer Infrastructure  
**Overall Progress**: 20% (1/5 phases complete)

**Phase Completion Log:**
- Phase 1: COMPLETED ✅
- Phase 2: Not started
- Phase 3: Not started
- Phase 4: Not started
- Phase 5: Not started

---

## Technical Notes

**Key Design Decisions:**
1. Portrait TVs use portrait-specific image libraries
2. Emergency messages always overlay (never replace)
3. Higher priority zones render on top
4. Built-in templates with customization support
5. Zone-based approach for maximum flexibility

**Architecture Principles:**
- Leverage existing transition blending infrastructure
- Maintain performance on lower-end hardware
- Keep user interface simple despite powerful capabilities
- Ensure backward compatibility with existing TV configurations

**Testing Strategy:**
- Test each phase on both landscape and portrait orientations
- Validate performance on Raspberry Pi 4 hardware
- Ensure emergency overlays work reliably
- Test preset sharing across multiple TV installations