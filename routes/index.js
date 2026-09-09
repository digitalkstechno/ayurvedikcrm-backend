const express = require('express');
const router = express.Router();

const userRoutes = require('./userRoutes');
const productRoutes = require('./productRoutes');
const statusRoutes = require('./statusRoutes');
const returnOrderTypeRoutes = require('./returnOrderTypeRoutes');
const reasonToCallRoutes = require('./reasonToCallRoutes');
const roleRoutes = require('./roleRoutes');
const teamRoutes = require('./teamRoutes');
const authRoutes = require('./authRoutes');
const courierRoutes = require('./courierRoutes');
const uploadRoutes = require('./uploadRoutes');

// Mount routes
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/statuses', statusRoutes);
router.use('/return-order-types', returnOrderTypeRoutes);
router.use('/reason-to-calls', reasonToCallRoutes);
router.use('/roles', roleRoutes);
router.use('/teams', teamRoutes);
router.use('/auth', authRoutes);
router.use('/couriers', courierRoutes);
router.use('/upload', uploadRoutes);

const customerRoutes = require('./customerRoutes');
router.use('/customers', customerRoutes);

const leadRoutes = require('./leadRoutes');
router.use('/leads', leadRoutes);

const orderRoutes = require('./orderRoutes');
router.use('/orders', orderRoutes);

const deliveryRoutes = require('./deliveryRoutes');
router.use('/deliveries', deliveryRoutes);

const activityLogRoutes = require('./activityLogRoutes');
router.use('/activity-logs', activityLogRoutes);

const dashboardRoutes = require('./dashboardRoutes');
router.use('/dashboard', dashboardRoutes);

module.exports = router;
