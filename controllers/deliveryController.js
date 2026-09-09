const mongoose = require('mongoose');
const Delivery = require('../models/deliveryModel');
const Order = require('../models/orderModel');
const Lead = require('../models/leadModel');
const ActivityLog = require('../models/activityLogModel');
const User = require('../models/userModel');
const ReturnOrder = require('../models/returnOrderModel');

const escapeRegex = (str) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

const parseProductFilter = (val) => {
  if (!val || val === 'all' || val === '') return null;
  const items = val.split(',').map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return null;

  const objectIds = [];
  const names = [];

  items.forEach(item => {
    if (mongoose.Types.ObjectId.isValid(item)) {
      objectIds.push(new mongoose.Types.ObjectId(item));
    } else {
      names.push(item);
    }
  });

  const conditions = [];
  if (objectIds.length > 0) {
    conditions.push({ 'products.productId': { $in: objectIds } });
  }
  if (names.length > 0) {
    const escapedPattern = names.map(escapeRegex).join('|');
    conditions.push({ 'products.name': { $regex: escapedPattern, $options: 'i' } });
  }

  if (conditions.length === 1) return conditions[0];
  if (conditions.length > 1) return { $or: conditions };
  return null;
};

// Helper: Auto-sync from Order model so any converted lead/order appears in Delivery
const syncFromOrders = async () => {
  try {
    const orders = await Order.find({ isDeleted: { $ne: true } });
    if (orders.length > 0) {
      const existingDeliveries = await Delivery.find({ isDeleted: { $ne: true } }).select('orderId');
      const existingOrderIds = new Set(existingDeliveries.map(d => d.orderId ? d.orderId.toString() : ''));

      const deliveriesToInsert = [];
      orders.forEach(o => {
        const oIdStr = o._id.toString();
        if (!existingOrderIds.has(oIdStr)) {
          deliveriesToInsert.push({
            orderId: o._id,
            leadId: o.leadId,
            name: o.name,
            phone_number: o.phone_number,
            products: o.products || [],
            grandTotal: o.grandTotal,
            paymentType: o.paymentType || 'COD',
            courier: o.courier || '',
            assginTo: o.assginTo,
            transactionId: o.transactionId || '',
            delivery_no: o.delivery_no || '',
            status: o.status || 'IN TRANSIT',
            statusReason: o.statusReason || '',
            statusHistory: o.statusHistory || [],
            createdAt: o.createdAt,
            updatedAt: o.updatedAt
          });
        }
      });

      if (deliveriesToInsert.length > 0) {
        await Delivery.insertMany(deliveriesToInsert);
      }
    }
  } catch (err) {
    console.error('Error syncing orders to deliveries:', err);
  }
};

// @desc    Get all delivery orders
// @route   GET /api/deliveries
// @access  Public
const getDeliveries = async (req, res) => {
  try {
    await syncFromOrders();

    const { page = 1, limit = 100, search = '', assginTo, status, courier, product, startDate, endDate } = req.query;
    const query = {
      isDeleted: { $ne: true }
    };

    if (search) {
      const escapedSearch = escapeRegex(search);
      const flexibleSearchPattern = escapedSearch.trim().replace(/\s+/g, '[\\s,]*');

      const matchedUsers = await User.find({ name: { $regex: flexibleSearchPattern, $options: 'i' } }).select('_id');
      const userIds = matchedUsers.map(u => u._id);

      const terms = search.trim().split(/\s+/).filter(t => t.length > 0);
      const productAllQuery = terms.length > 0 ? {
        products: {
          $all: terms.map(term => ({
            $elemMatch: { name: { $regex: escapeRegex(term), $options: 'i' } }
          }))
        }
      } : null;

      query.$or = [
        { name: { $regex: flexibleSearchPattern, $options: 'i' } },
        { phone_number: { $regex: flexibleSearchPattern, $options: 'i' } },
        { transactionId: { $regex: flexibleSearchPattern, $options: 'i' } },
        { courier: { $regex: flexibleSearchPattern, $options: 'i' } },
        { paymentType: { $regex: flexibleSearchPattern, $options: 'i' } },
        { status: { $regex: flexibleSearchPattern, $options: 'i' } }
      ];

      if (productAllQuery) {
        query.$or.push(productAllQuery);
      }

      if (userIds.length > 0) {
        query.$or.push({ assginTo: { $in: userIds } });
      }
    }

    const isAdmin = req.user && (
      req.user.roles.includes('admin') || 
      req.user.roles.includes('superadmin') || 
      req.user.email === 'superadmin@gmail.com'
    );

    const parseObjectIdFilter = (val) => {
      if (!val || val === 'all' || val === '') return undefined;
      const ids = val.split(',')
        .map(id => id.trim())
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));
      return ids.length > 0 ? { $in: ids } : undefined;
    };

    if (isAdmin) {
      const assignFilter = parseObjectIdFilter(assginTo);
      if (assignFilter) query.assginTo = assignFilter;
    } else {
      query.assginTo = req.user ? req.user._id : null;
    }

    if (status && status !== 'all' && status !== '') {
      query.status = { $in: status.split(',').map(s => s.trim()) };
    }
    if (courier && courier !== 'all' && courier !== '') {
      const courierRegexes = courier.split(',').map(c => new RegExp(`^${c.trim()}$`, 'i'));
      query.courier = { $in: courierRegexes };
    }
    const productCond = parseProductFilter(product);
    if (productCond) {
      if (productCond.$or) {
        query.$and = query.$and || [];
        query.$and.push(productCond);
      } else {
        Object.assign(query, productCond);
      }
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const eod = new Date(endDate);
        eod.setHours(23, 59, 59, 999);
        query.createdAt.$lte = eod;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const deliveries = await Delivery.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('assginTo', 'name email')
      .populate('leadId', 'name phone_number')
      .populate('products.productId', 'name amount');

    const count = await Delivery.countDocuments(query);

    const statsQuery = { ...query };
    delete statsQuery.status;

    const [_deliveredCount, _rtoCount, _inTransitCount] = await Promise.all([
      Delivery.countDocuments({ ...statsQuery, status: { $regex: /^delivered$/i } }),
      Delivery.countDocuments({ ...statsQuery, status: { $regex: /^rto$/i } }),
      Delivery.countDocuments({ ...statsQuery, status: { $regex: /^(in transit|dispatched|processing|converted)$/i } })
    ]);
    // These will be overridden below when no date filter is applied (All Data → show today's counts)
    let deliveredCount = _deliveredCount;
    let rtoCount = _rtoCount;
    let inTransitCount = _inTransitCount;

    // Calculate Growth comparison tags
    let currentDelivered = deliveredCount;
    let currentRto = rtoCount;
    let prevDelivered = 0;
    let prevRto = 0;
    let tagSuffix = "(Daily)";

    const baseStatsQuery = { ...statsQuery };
    delete baseStatsQuery.createdAt;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);

    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      const diffMs = e.getTime() - s.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        tagSuffix = "(Daily)";
        const prevStart = new Date(s.getFullYear(), s.getMonth(), s.getDate() - 1, 0, 0, 0, 0);
        const prevEnd = new Date(s.getFullYear(), s.getMonth(), s.getDate() - 1, 23, 59, 59, 999);

        const [pDel, pRto] = await Promise.all([
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^delivered$/i } }),
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^rto$/i } })
        ]);
        prevDelivered = pDel;
        prevRto = pRto;
      } else if (diffDays >= 6 && diffDays <= 8) {
        tagSuffix = "(Weekly)";
        const spanMs = (diffDays + 1) * 24 * 60 * 60 * 1000;
        const prevStart = new Date(s.getTime() - spanMs);
        const prevEnd = new Date(s.getTime() - 1);

        const [pDel, pRto] = await Promise.all([
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^delivered$/i } }),
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^rto$/i } })
        ]);
        prevDelivered = pDel;
        prevRto = pRto;
      } else {
        tagSuffix = "(Daily)";
        const [cDel, cRto, pDel, pRto] = await Promise.all([
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^delivered$/i } }),
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^rto$/i } }),
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^delivered$/i } }),
          Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^rto$/i } })
        ]);
        prevDelivered = pDel;
        prevRto = pRto;
      }
    } else {
      // No date filter (All Data): compare today vs yesterday, show today's counts in cards
      tagSuffix = "(Daily)";
      const [cDel, cRto, cTransit, pDel, pRto] = await Promise.all([
        Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^delivered$/i } }),
        Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^rto$/i } }),
        Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^(in transit|dispatched|processing|converted)$/i } }),
        Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^delivered$/i } }),
        Delivery.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^rto$/i } })
      ]);
      currentDelivered = cDel;
      currentRto = cRto;
      prevDelivered = pDel;
      prevRto = pRto;
      // Override stat card totals with today-only counts for consistency
      deliveredCount = cDel;
      rtoCount = cRto;
      inTransitCount = cTransit;
    }

    const calcGrowth = (curr, prev, tag) => {
      let pct = 0;
      if (curr === 0) {
        pct = 0;
      } else if (prev > 0) {
        pct = Math.round(((curr - prev) / prev) * 100);
      } else if (curr > 0) {
        pct = 100;
      }
      const sign = pct > 0 ? '+' : '';
      return `${sign}${pct}% ${tag}`;
    };

    const deliveredGrowth = calcGrowth(currentDelivered, prevDelivered, tagSuffix);
    const rtoGrowth = calcGrowth(currentRto, prevRto, tagSuffix);

    res.status(200).json({
      data: deliveries,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / parseInt(limit)),
      stats: {
        delivered: deliveredCount,
        rto: rtoCount,
        inTransit: inTransitCount,
        deliveredGrowth,
        rtoGrowth
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single delivery order
// @route   GET /api/deliveries/:id
// @access  Public
const getDeliveryById = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id)
      .populate('assginTo', 'name email')
      .populate('leadId')
      .populate('products.productId');
    if (!delivery) return res.status(404).json({ message: 'Delivery order not found' });
    res.status(200).json(delivery);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a delivery order
// @route   POST /api/deliveries
// @access  Public
const createDelivery = async (req, res) => {
  try {
    const delivery = await Delivery.create(req.body);

    if (req.user) {
      await ActivityLog.create({
        user: req.user._id,
        lead: delivery.leadId || null,
        action: 'Create Delivery Order',
        message: 'Delivery Order created successfully'
      });
    }

    res.status(201).json(delivery);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a delivery order
// @route   PUT /api/deliveries/:id
// @access  Public
const updateDelivery = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) return res.status(404).json({ message: 'Delivery order not found' });

    const oldStatusVal = delivery.status || 'IN TRANSIT';
    const statusChanged = req.body.status && req.body.status.toString() !== oldStatusVal.toString();
    const statusDateVal = req.body.statusDate ? new Date(req.body.statusDate) : new Date();

    // Always persist statusDate when status changes
    if (statusChanged) {
      req.body.statusDate = statusDateVal;
    }

    if (req.body.statusReason) {
      const historyList = Array.isArray(delivery.statusHistory) ? delivery.statusHistory : [];
      historyList.push({
        oldStatus: oldStatusVal,
        newStatus: req.body.status || oldStatusVal,
        reason: req.body.statusReason,
        updatedBy: req.user ? (req.user.name || req.user.email) : 'User',
        updatedById: req.user ? req.user._id : null,
        createdAt: statusDateVal
      });
      req.body.statusHistory = historyList;
    }

    const updated = await Delivery.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    // Also sync status back to Order if orderId is referenced
    if (updated.orderId) {
      await Order.findByIdAndUpdate(updated.orderId, {
        status: updated.status,
        statusReason: updated.statusReason,
        statusHistory: updated.statusHistory
      });
    }

    // Auto-create/sync or remove Return Order based on status
    if (req.body.status && req.body.status.toUpperCase() === 'RTO') {
      try {
        const existingReturn = await ReturnOrder.findOne({
          $or: [
            { orderId: updated.orderId || updated._id },
            { phone_number: updated.phone_number }
          ]
        });

        if (!existingReturn) {
          // Create new Return Order entry
          await ReturnOrder.create({
            orderId: updated.orderId || updated._id,
            customerName: updated.name,
            phone_number: updated.phone_number,
            assginTo: updated.assginTo,
            products: updated.products || [],
            amount: updated.grandTotal || 0,
            type: req.body.returnType || 'RTO',
            remark: req.body.statusReason || 'Status changed to RTO',
            isDeleted: false,
            createdAt: statusDateVal
          });
        } else {
          // Restore if soft-deleted, and update fields
          existingReturn.isDeleted = false;
          existingReturn.deleteDate = undefined;
          existingReturn.type = req.body.returnType || existingReturn.type || 'RTO';
          existingReturn.remark = req.body.statusReason || existingReturn.remark;
          existingReturn.customerName = updated.name || existingReturn.customerName;
          existingReturn.products = updated.products && updated.products.length > 0 ? updated.products : existingReturn.products;
          existingReturn.amount = updated.grandTotal || existingReturn.amount;
          if (req.body.statusDate) existingReturn.createdAt = statusDateVal;
          await existingReturn.save();
        }
      } catch (rErr) {
        console.error('Error auto-creating return order on delivery update:', rErr);
      }
    } else if (req.body.status && req.body.status.toUpperCase() !== 'RTO') {
      // Any non-RTO status: soft-delete matching Return Orders so they disappear from Return Orders list
      try {
        const queryOr = [];
        if (delivery.orderId) queryOr.push({ orderId: delivery.orderId });
        queryOr.push({ orderId: delivery._id });
        if (delivery.phone_number) queryOr.push({ phone_number: delivery.phone_number });

        await ReturnOrder.updateMany(
          { $or: queryOr, isDeleted: { $ne: true } },
          { $set: { isDeleted: true, deleteDate: new Date() } }
        );
      } catch (rErr) {
        console.error('Error soft-deleting return order on delivery status change from RTO:', rErr);
      }
    }

    if (updated.leadId && req.body.statusReason) {
      await Lead.findByIdAndUpdate(updated.leadId, {
        remark: req.body.statusReason,
        note: req.body.statusReason
      });
    }

    if (req.user) {
      const logMessage = statusChanged
        ? (req.body.statusReason ? `Delivery Status changed to ${req.body.status}. Reason: ${req.body.statusReason}` : `Delivery status updated to ${req.body.status}`)
        : 'Delivery Order updated successfully';

      await ActivityLog.create({
        user: req.user._id,
        lead: updated.leadId || null,
        action: statusChanged ? 'Delivery Status Change' : 'Update',
        message: logMessage
      });
    }

    res.status(200).json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a delivery order (soft delete)
// @route   DELETE /api/deliveries/:id
// @access  Public
const deleteDelivery = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) return res.status(404).json({ message: 'Delivery order not found' });

    delivery.isDeleted = true;
    delivery.deleteDate = new Date();
    await delivery.save();

    if (req.user) {
      await ActivityLog.create({
        user: req.user._id,
        lead: delivery.leadId || null,
        action: 'Delete Delivery Order',
        message: `Delivery Order #${delivery._id} deleted`
      });
    }

    res.status(200).json({ message: 'Delivery order deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Export deliveries to CSV
// @route   GET /api/deliveries/export
// @access  Public
const exportDeliveries = async (req, res) => {
  try {
    await syncFromOrders();
    const { search = '', assginTo, status, courier, product, startDate, endDate } = req.query;
    const query = { isDeleted: { $ne: true } };

    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { phone_number: { $regex: escapedSearch, $options: 'i' } },
        { transactionId: { $regex: escapedSearch, $options: 'i' } },
        { courier: { $regex: escapedSearch, $options: 'i' } },
        { status: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (status && status !== 'all' && status !== '') {
      query.status = { $in: status.split(',').map(s => s.trim()) };
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const eod = new Date(endDate);
        eod.setHours(23, 59, 59, 999);
        query.createdAt.$lte = eod;
      }
    }

    const deliveries = await Delivery.find(query)
      .sort({ createdAt: -1 })
      .populate('assginTo', 'name')
      .populate('products.productId', 'name');

    const csvRows = deliveries.map((d, index) => ({
      "No": index + 1,
      "Customer Name": d.name || '-',
      "Phone Number": d.phone_number || '-',
      "Products": d.products ? d.products.map(p => p.name).join(', ') : '-',
      "Amount": d.grandTotal || 0,
      "Courier": d.courier || '-',
      "Payment Type": d.paymentType || 'COD',
      "Status": d.status || 'IN TRANSIT',
      "Assigned To": d.assginTo ? d.assginTo.name : '-',
      "Date": d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-GB') : '-'
    }));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="deliveries_export.csv"');

    if (csvRows.length === 0) {
      return res.send("No records found");
    }

    const headers = Object.keys(csvRows[0]).join(',');
    const body = csvRows.map(row => Object.values(row).map(val => `"${val}"`).join(',')).join('\n');
    res.send(`${headers}\n${body}`);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getDeliveries,
  getDeliveryById,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  exportDeliveries
};
