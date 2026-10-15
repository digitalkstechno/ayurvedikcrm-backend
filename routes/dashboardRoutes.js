const express = require('express');
const router = express.Router();
const { 
  getDashboardStats, 
  exportDashboardLeads, 
  exportDashboardOrders 
} = require('../controllers/dashboardController');
const { protect } = require('../middlewares/authMiddleware');

router.route('/stats').get(protect, getDashboardStats);
router.route('/export/leads').get(protect, exportDashboardLeads);
router.route('/export/orders').get(protect, exportDashboardOrders);

module.exports = router;

