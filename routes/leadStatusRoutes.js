const express = require('express');
const router = express.Router();
const {
  getLeadStatuses,
  getLeadStatus,
  createLeadStatus,
  updateLeadStatus,
  deleteLeadStatus,
  exportLeadStatuses
} = require('../controllers/leadStatusController');

router.get('/export', exportLeadStatuses);  // must be before /:id
router.get('/', getLeadStatuses);
router.get('/:id', getLeadStatus);
router.post('/', createLeadStatus);
router.put('/:id', updateLeadStatus);
router.delete('/:id', deleteLeadStatus);

module.exports = router;
