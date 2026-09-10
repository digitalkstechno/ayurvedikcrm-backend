const mongoose = require('mongoose');
const Order = require('../models/orderModel');
const Delivery = require('../models/deliveryModel');
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

const syncReturnOrdersToOrders = async () => {
  try {
    const activeReturnOrders = await ReturnOrder.find({ isDeleted: { $ne: true } });
    for (const r of activeReturnOrders) {
      const rType = (r.type || 'RTO').toUpperCase();
      const statusToSync = (rType === 'DELIVERY' || rType === 'DELIVERED')
        ? 'DELIVERED'
        : ((rType === 'IN TRANSIT' || rType === 'INTRANSIT') ? 'IN TRANSIT' : 'RTO');

      const queryOr = [];
      if (r.orderId) {
        queryOr.push({ orderId: r.orderId });
        queryOr.push({ _id: r.orderId });
      }
      if (r.phone_number) queryOr.push({ phone_number: r.phone_number });

      if (queryOr.length > 0) {
        await Order.updateMany(
          { $or: queryOr, isDeleted: { $ne: true }, status: { $ne: statusToSync } },
          { $set: { status: statusToSync } }
        );
      }
    }
  } catch (err) {
    console.error('Error syncing return orders to orders:', err);
  }
};

// @desc    Get all orders
// @route   GET /api/orders
// @access  Public
const getOrders = async (req, res) => {
  try {
    await syncReturnOrdersToOrders();
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

    // Check if current user is admin/superadmin
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
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const orders = await Order.find(query)
      .populate('assginTo', 'name')
      .populate('leadId', 'name')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const statsQuery = { ...query };
    delete statsQuery.status;

    const [count, deliveredCount, rtoCount, inTransitCount] = await Promise.all([
      Order.countDocuments(query),
      Order.countDocuments({ ...statsQuery, status: { $regex: /^delivered$/i } }),
      Order.countDocuments({ ...statsQuery, status: { $regex: /^rto$/i } }),
      Order.countDocuments({ ...statsQuery, status: { $regex: /^(in transit|dispatched|processing|converted)$/i } })
    ]);

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
      const [sY, sM, sD] = startDate.split('-').map(Number);
      const [eY, eM, eD] = endDate.split('-').map(Number);

      const sDateObj = new Date(sY, sM - 1, sD, 0, 0, 0, 0);
      const eDateObj = new Date(eY, eM - 1, eD, 23, 59, 59, 999);

      const diffMs = Math.abs(eDateObj.getTime() - sDateObj.getTime());
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        // Single Day filter -> compare selected day vs day before it
        tagSuffix = "(Daily)";
        currentDelivered = deliveredCount;
        currentRto = rtoCount;

        const prevStart = new Date(sY, sM - 1, sD - 1, 0, 0, 0, 0);
        const prevEnd = new Date(sY, sM - 1, sD - 1, 23, 59, 59, 999);

        const [pDel, pRto] = await Promise.all([
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^delivered$/i } }),
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^rto$/i } })
        ]);
        prevDelivered = pDel;
        prevRto = pRto;
      } else if (diffDays >= 6 && diffDays <= 8) {
        // Weekly (7 days) filter -> compare selected week vs previous week
        tagSuffix = "(Weekly)";
        currentDelivered = deliveredCount;
        currentRto = rtoCount;

        const spanMs = (diffDays + 1) * 24 * 60 * 60 * 1000;
        const prevStart = new Date(sDateObj.getTime() - spanMs);
        const prevEnd = new Date(sDateObj.getTime() - 1);

        const [pDel, pRto] = await Promise.all([
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^delivered$/i } }),
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^rto$/i } })
        ]);
        prevDelivered = pDel;
        prevRto = pRto;
      } else if (diffDays >= 27 && diffDays <= 32) {
        // Monthly (~30 days) filter -> compare selected month vs previous month
        tagSuffix = "(Monthly)";
        currentDelivered = deliveredCount;
        currentRto = rtoCount;

        const spanMs = (diffDays + 1) * 24 * 60 * 60 * 1000;
        const prevStart = new Date(sDateObj.getTime() - spanMs);
        const prevEnd = new Date(sDateObj.getTime() - 1);

        const [pDel, pRto] = await Promise.all([
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^delivered$/i } }),
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: prevStart, $lte: prevEnd }, status: { $regex: /^rto$/i } })
        ]);
        prevDelivered = pDel;
        prevRto = pRto;
      } else {
        // Custom date range -> Card counts reflect custom range, BUT rate% compares Today vs Yesterday
        tagSuffix = "(Daily)";
        const [cDel, cRto, pDel, pRto] = await Promise.all([
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^delivered$/i } }),
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^rto$/i } }),
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^delivered$/i } }),
          Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^rto$/i } })
        ]);
        currentDelivered = cDel;
        currentRto = cRto;
        prevDelivered = pDel;
        prevRto = pRto;
      }
    } else {
      // All Data (No date filter) -> Card counts reflect All Data, BUT rate% compares Today vs Yesterday
      tagSuffix = "(Daily)";
      const [cDel, cRto, pDel, pRto] = await Promise.all([
        Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^delivered$/i } }),
        Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: todayStart, $lte: todayEnd }, status: { $regex: /^rto$/i } }),
        Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^delivered$/i } }),
        Order.countDocuments({ ...baseStatsQuery, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd }, status: { $regex: /^rto$/i } })
      ]);
      currentDelivered = cDel;
      currentRto = cRto;
      prevDelivered = pDel;
      prevRto = pRto;
    }

    const calcGrowth = (curr, prev, tag) => {
      let pct = 0;
      if (curr === 0 && prev === 0) {
        pct = 0;
      } else if (prev === 0) {
        pct = 100;
      } else {
        pct = Math.round(((curr - prev) / prev) * 100);
      }
      const sign = pct > 0 ? '+' : '';
      return `${sign}${pct}% ${tag}`;
    };

    const deliveredGrowth = calcGrowth(currentDelivered, prevDelivered, tagSuffix);
    const rtoGrowth = calcGrowth(currentRto, prevRto, tagSuffix);

    res.status(200).json({
      data: orders,
      total: count,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(count / limit),
      stats: {
        delivered: deliveredCount,
        rto: rtoCount,
        inTransit: inTransitCount,
        deliveredGrowth: deliveredGrowth,
        rtoGrowth: rtoGrowth
      }
    });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create an order
// @route   POST /api/orders
// @access  Public
const createOrder = async (req, res) => {
  try {
    const leadId = req.body.leadId;
    const newProducts = req.body.products || [];

    if (leadId && newProducts.length > 0) {
      // Find the most recent order for this lead
      const existingOrder = await Order.findOne({ leadId, isDeleted: { $ne: true } }).sort({ createdAt: -1 });

      if (existingOrder) {
        let updatedProducts = [...(existingOrder.products || [])];
        
        newProducts.forEach(newP => {
          const pIdStr = newP.productId ? newP.productId.toString() : null;
          let found = false;

          if (pIdStr) {
            const exIdx = updatedProducts.findIndex(ep => ep.productId && ep.productId.toString() === pIdStr);
            if (exIdx >= 0) {
              updatedProducts[exIdx].quantity = (updatedProducts[exIdx].quantity || 1) + (newP.quantity || 1);
              updatedProducts[exIdx].subtotal = updatedProducts[exIdx].amount * updatedProducts[exIdx].quantity;
              found = true;
            }
          } else {
             // Fallback to name matching
             const exIdx = updatedProducts.findIndex(ep => ep.name === newP.name);
             if (exIdx >= 0) {
                updatedProducts[exIdx].quantity = (updatedProducts[exIdx].quantity || 1) + (newP.quantity || 1);
                updatedProducts[exIdx].subtotal = updatedProducts[exIdx].amount * updatedProducts[exIdx].quantity;
                found = true;
             }
          }
          
          if (!found) {
             updatedProducts.push(newP);
          }
        });

        // Update the existing order with the merged products
        existingOrder.products = updatedProducts;
        
        let newGrandTotal = updatedProducts.reduce((sum, p) => sum + (p.subtotal || (p.amount * (p.quantity || 1)) || 0), 0);
        let newQuantityTotal = updatedProducts.reduce((sum, p) => sum + (p.quantity || 1), 0);
        
        existingOrder.grandTotal = newGrandTotal;
        existingOrder.quantity = newQuantityTotal; // in case we use quantity
        
        await existingOrder.save();

        if (req.user) {
          await ActivityLog.create({
            user: req.user._id,
            lead: existingOrder.leadId || null,
            action: 'Repeat Order',
            message: 'Repeat order quantities updated successfully'
          });
        }

        return res.status(200).json(existingOrder);
      }
    }

    const order = await Order.create(req.body);

    try {
      await Delivery.create({
        orderId: order._id,
        leadId: order.leadId,
        name: order.name,
        phone_number: order.phone_number,
        products: order.products || [],
        grandTotal: order.grandTotal,
        paymentType: order.paymentType || 'COD',
        courier: order.courier || '',
        assginTo: order.assginTo,
        transactionId: order.transactionId || '',
        delivery_no: order.delivery_no || '',
        status: order.status || 'IN TRANSIT',
        statusReason: order.statusReason || '',
        statusHistory: order.statusHistory || []
      });
    } catch (dErr) {
      console.error('Error auto-creating delivery from order:', dErr);
    }

    if (req.user) {
      await ActivityLog.create({
        user: req.user._id,
        lead: order.leadId || null,
        action: 'Convert To Order',
        message: 'Lead Convert To Order successfully'
      });
    }

    res.status(201).json(order);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update an order
// @route   PUT /api/orders/:id
// @access  Public
const updateOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const oldStatusVal = order.status || 'IN TRANSIT';
    const statusChanged = req.body.status && req.body.status.toString() !== oldStatusVal.toString();

    if (req.body.statusReason) {
      const historyList = Array.isArray(order.statusHistory) ? order.statusHistory : [];
      historyList.push({
        oldStatus: oldStatusVal,
        newStatus: req.body.status || oldStatusVal,
        reason: req.body.statusReason,
        updatedBy: req.user ? (req.user.name || req.user.email) : 'User',
        updatedById: req.user ? req.user._id : null,
        createdAt: new Date()
      });
      req.body.statusHistory = historyList;
    }

    const updated = await Order.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    // Auto-sync status and details to Delivery collection
    try {
      const deliveryOrConditions = [
        { orderId: updated._id }
      ];
      if (updated.phone_number) {
        deliveryOrConditions.push({ phone_number: updated.phone_number });
      }

      let existingDelivery = await Delivery.findOne({ $or: deliveryOrConditions, isDeleted: { $ne: true } });
      if (existingDelivery) {
        existingDelivery.status = updated.status || existingDelivery.status;
        existingDelivery.statusReason = updated.statusReason || existingDelivery.statusReason;
        existingDelivery.statusHistory = updated.statusHistory || existingDelivery.statusHistory;
        existingDelivery.products = updated.products || existingDelivery.products;
        existingDelivery.grandTotal = updated.grandTotal || existingDelivery.grandTotal;
        existingDelivery.statusDate = new Date();
        await existingDelivery.save();
      } else {
        await Delivery.create({
          orderId: updated._id,
          leadId: updated.leadId,
          name: updated.name,
          phone_number: updated.phone_number,
          products: updated.products || [],
          grandTotal: updated.grandTotal || 0,
          paymentType: updated.paymentType || 'COD',
          courier: updated.courier || '',
          assginTo: updated.assginTo,
          transactionId: updated.transactionId || '',
          delivery_no: updated.delivery_no || '',
          status: updated.status || 'IN TRANSIT',
          statusReason: updated.statusReason || '',
          statusHistory: updated.statusHistory || [],
          statusDate: new Date()
        });
      }
    } catch (dErr) {
      console.error('Error syncing order update to delivery:', dErr);
    }

    // Auto-sync ReturnOrder model based on status
    if (updated.status && updated.status.toUpperCase() === 'RTO') {
      try {
        const existingReturn = await ReturnOrder.findOne({
          $or: [
            { orderId: updated._id },
            { phone_number: updated.phone_number }
          ]
        });

        if (!existingReturn) {
          await ReturnOrder.create({
            orderId: updated._id,
            customerName: updated.name,
            phone_number: updated.phone_number,
            assginTo: updated.assginTo,
            products: updated.products || [],
            amount: updated.grandTotal || 0,
            type: 'RTO',
            remark: updated.statusReason || 'Status changed to RTO',
            isDeleted: false,
            createdAt: new Date()
          });
        } else {
          existingReturn.isDeleted = false;
          existingReturn.deleteDate = undefined;
          existingReturn.type = 'RTO';
          existingReturn.remark = updated.statusReason || existingReturn.remark;
          existingReturn.customerName = updated.name || existingReturn.customerName;
          existingReturn.products = updated.products && updated.products.length > 0 ? updated.products : existingReturn.products;
          existingReturn.amount = updated.grandTotal || existingReturn.amount;
          await existingReturn.save();
        }
      } catch (rErr) {
        console.error('Error auto-creating return order on order update:', rErr);
      }
    } else if (updated.status && updated.status.toUpperCase() !== 'RTO') {
      try {
        const queryOr = [
          { orderId: updated._id },
          { phone_number: updated.phone_number }
        ];
        await ReturnOrder.updateMany(
          { $or: queryOr, isDeleted: { $ne: true } },
          { $set: { isDeleted: true, deleteDate: new Date() } }
        );
      } catch (rErr) {
        console.error('Error soft-deleting return order on order update:', rErr);
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
        : 'Order updated successfully';

      await ActivityLog.create({
        user: req.user._id,
        lead: updated.leadId || null,
        action: statusChanged ? 'Status Change' : 'Update',
        message: logMessage
      });
    }

    res.status(200).json(updated);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete an order (soft delete)
// @route   DELETE /api/orders/:id
// @access  Public
const deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    await Order.findByIdAndUpdate(req.params.id, { isDeleted: true, deleteDate: new Date() });

    if (req.user) {
      await ActivityLog.create({
        user: req.user._id,
        lead: order.leadId || null,
        action: 'Delete',
        message: 'Order deleted successfully'
      });
    }

    res.status(200).json({ message: 'Order deleted successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

const exportOrders = async (req, res) => {
  try {
    const { search = '', assginTo, status, courier, product, startDate, endDate } = req.query;
    const query = { isDeleted: { $ne: true } };

    if (search) {
      const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
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

    // Check if current user is admin/superadmin
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
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const orders = await Order.find(query)
      .populate('assginTo', 'name')
      .populate('leadId', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getOrders, createOrder, updateOrder, deleteOrder, exportOrders };
