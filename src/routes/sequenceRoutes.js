const express = require('express');
const router = express.Router();
const sequenceController = require('../controllers/sequenceController');
const { asyncHandler } = require('../middleware/errorHandler');

// Sequences: the looping timeline of image and scene clips a TV plays
router.get('/', asyncHandler(sequenceController.listSequences));
router.post('/', asyncHandler(sequenceController.createSequence));
router.get('/:sequenceId', asyncHandler(sequenceController.getSequence));
router.put('/:sequenceId', asyncHandler(sequenceController.updateSequence));
router.delete('/:sequenceId', asyncHandler(sequenceController.deleteSequence));
router.post('/:sequenceId/duplicate', asyncHandler(sequenceController.duplicateSequence));
router.put('/:sequenceId/tvs', asyncHandler(sequenceController.assignTvs));

module.exports = router;
