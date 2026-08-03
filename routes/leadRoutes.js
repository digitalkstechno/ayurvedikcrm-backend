const express = require('express');
const router = express.Router();
const { getLeads, getLeadById, createLead, createPublicLead, updateLead, deleteLead, exportLeads, getLatestLeadByPhone } = require('../controllers/leadController');
const { protect } = require('../middlewares/authMiddleware');

router.route('/latest/:phone')
  .get(protect, getLatestLeadByPhone);

router.route('/public-create')
  .post(createPublicLead);

router.route('/')
  .get(protect, getLeads)
  .post(protect, createLead);

router.route('/export')
  .get(protect, exportLeads);

router.route('/:id')
  .get(protect, getLeadById)
  .put(protect, updateLead)
  .delete(protect, deleteLead);

module.exports = router;
