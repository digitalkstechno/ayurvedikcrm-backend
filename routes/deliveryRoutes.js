const express = require('express');
const router = express.Router();
const {
  getDeliveries,
  getDeliveryById,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  exportDeliveries
} = require('../controllers/deliveryController');
const { protect } = require('../middlewares/authMiddleware');

router.get('/export', protect, exportDeliveries);
router.route('/')
  .get(protect, getDeliveries)
  .post(protect, createDelivery);

router.route('/:id')
  .get(protect, getDeliveryById)
  .put(protect, updateDelivery)
  .delete(protect, deleteDelivery);

module.exports = router;
