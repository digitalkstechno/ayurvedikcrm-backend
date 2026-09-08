const mongoose = require('mongoose');
const ReturnOrder = require('../models/returnOrderModel');
const Order = require('../models/orderModel');
const User = require('../models/userModel');

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

// @desc    Get all return orders
// @route   GET /api/return-orders
// @access  Public
const getReturnOrders = async (req, res) => {
  try {
    const { page = 1, limit = 100, search = '', assginTo, product, type, startDate, endDate, orderStartDate, orderEndDate } = req.query;
    const query = { isDeleted: { $ne: true } };

    if (orderStartDate || orderEndDate) {
      const orderQuery = { isDeleted: { $ne: true } };
      orderQuery.createdAt = {};
      if (orderStartDate) orderQuery.createdAt.$gte = new Date(orderStartDate);
      if (orderEndDate) {
        const end = new Date(orderEndDate);
        end.setUTCHours(23, 59, 59, 999);
        orderQuery.createdAt.$lte = end;
      }

      const matchedOrders = await Order.find(orderQuery).select('_id phone_number');
      const matchedIds = matchedOrders.map(o => o._id);
      const matchedPhones = matchedOrders.map(o => o.phone_number).filter(Boolean);

      query.$or = query.$or || [];
      query.$or.push({ orderId: { $in: matchedIds } });
      if (matchedPhones.length > 0) {
        query.$or.push({ phone_number: { $in: matchedPhones } });
      }
    }

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

      const searchOr = [
        { customerName: { $regex: flexibleSearchPattern, $options: 'i' } },
        { phone_number: { $regex: flexibleSearchPattern, $options: 'i' } },
        { type: { $regex: flexibleSearchPattern, $options: 'i' } }
      ];

      if (userIds.length > 0) {
        searchOr.push({ assginTo: { $in: userIds } });
      }

      if (productAllQuery) {
        searchOr.push(productAllQuery);
      }

      if (!isNaN(search) && search.trim() !== '') {
        const num = Number(search);
        searchOr.push({ amount: num });
        searchOr.push({ 'products.amount': num });
        searchOr.push({ 'products.subtotal': num });
      }

      if (!query.$and) query.$and = [];
      query.$and.push({ $or: searchOr });
    }
    // Check if current user is admin/superadmin
    const isAdmin = req.user && (
      req.user.roles.includes('admin') || 
      req.user.roles.includes('superadmin') || 
      req.user.email === 'superadmin@gmail.com'
    );

    if (isAdmin) {
      if (assginTo && assginTo !== 'all' && assginTo !== '') query.assginTo = { $in: assginTo.split(',') };
    } else {
      query.assginTo = req.user ? req.user._id : null;
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
    if (type && type !== 'all' && type !== '') {
      query.type = { $in: type.split(',') };
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

    const returnOrders = await ReturnOrder.find(query)
      .populate('assginTo', 'name')
      .populate('orderId')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 })
      .lean();


    for (let i = 0; i < returnOrders.length; i++) {
      if (!returnOrders[i].orderId) {
        const matchedOrder = await Order.findOne({ phone_number: returnOrders[i].phone_number }).sort({ createdAt: -1 }).select('createdAt');
        if (matchedOrder) {
          returnOrders[i].orderId = { createdAt: matchedOrder.createdAt };
        }
      }
    }

    const count = await ReturnOrder.countDocuments(query);

    res.status(200).json({
      data: returnOrders,
      total: count,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create a return order
// @route   POST /api/return-orders
// @access  Public
const createReturnOrder = async (req, res) => {
  try {
    const returnOrder = await ReturnOrder.create(req.body);
    res.status(201).json(returnOrder);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a return order
// @route   PUT /api/return-orders/:id
// @access  Public
const updateReturnOrder = async (req, res) => {
  try {
    const returnOrder = await ReturnOrder.findById(req.params.id);
    if (!returnOrder) return res.status(404).json({ message: 'Return order not found' });

    const updated = await ReturnOrder.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });
    res.status(200).json(updated);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a return order
// @route   DELETE /api/return-orders/:id
// @access  Public
const deleteReturnOrder = async (req, res) => {
  try {
    const returnOrder = await ReturnOrder.findById(req.params.id);
    if (!returnOrder) return res.status(404).json({ message: 'Return order not found' });

    await ReturnOrder.findByIdAndUpdate(req.params.id, { isDeleted: true, deleteDate: new Date() });
    res.status(200).json({ message: 'Return order deleted successfully' });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get return order by ID
// @route   GET /api/return-orders/:id
// @access  Public
const getReturnOrderById = async (req, res) => {
  try {
    const returnOrder = await ReturnOrder.findById(req.params.id)
      .populate('assginTo', 'name')
      .populate('orderId');

    if (!returnOrder) return res.status(404).json({ message: 'Return order not found' });

    res.status(200).json(returnOrder);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get staff return order stats
// @route   GET /api/return-orders/stats/staff
// @access  Public
const getStaffReturnStats = async (req, res) => {
  try {
    const { startDate, endDate, search = '', assginTo, product, page = 1, limit = 10 } = req.query;
    const User = require('../models/userModel');
    const Order = require('../models/orderModel');

    const dateMatch = { isDeleted: { $ne: true } };
    if (startDate || endDate) {
      dateMatch.createdAt = {};
      if (startDate) dateMatch.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateMatch.createdAt.$lte = end;
      }
    }

    let userQuery = { isDeleted: { $ne: true } };
    if (assginTo && assginTo !== 'all') {
      const ids = assginTo.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      userQuery._id = { $in: objectIds };
    }

    const users = await User.find(userQuery).select('_id name');

    // Aggregate Orders grouped by assginTo
    const orderStats = await Order.aggregate([
      { $match: dateMatch },
      {
        $group: {
          _id: "$assginTo",
          booked: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [
                { $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /delivered/i } },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    // Aggregate Return Orders grouped by assginTo and product keywords
    const returnOrderMatch = { ...dateMatch };
    if (product && product !== 'all') {
      const ids = product.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      returnOrderMatch['products.productId'] = { $in: objectIds };
    }

    const returnStats = await ReturnOrder.aggregate([
      { $match: returnOrderMatch },
      {
        $group: {
          _id: "$assginTo",
          returns: { $sum: 1 },
          latestDate: { $max: "$createdAt" },
          serumReturns: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: { $ifNull: ["$products", []] },
                          as: "p",
                          cond: { $regexMatch: { input: { $ifNull: ["$$p.name", ""] }, regex: /serum/i } }
                        }
                      }
                    },
                    0
                  ]
                },
                1,
                0
              ]
            }
          },
          oilReturns: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: { $ifNull: ["$products", []] },
                          as: "p",
                          cond: { $regexMatch: { input: { $ifNull: ["$$p.name", ""] }, regex: /oil/i } }
                        }
                      }
                    },
                    0
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const orderMap = {};
    orderStats.forEach(o => {
      if (o._id) orderMap[o._id.toString()] = o;
    });

    const returnMap = {};
    returnStats.forEach(r => {
      if (r._id) returnMap[r._id.toString()] = r;
    });

    let rawStats = [];

    // Map each staff member with data
    users.forEach((user) => {
      const uId = user._id.toString();
      const oData = orderMap[uId] || { booked: 0, delivered: 0 };
      const rData = returnMap[uId] || { returns: 0, serumReturns: 0, oilReturns: 0, latestDate: null };

      if (oData.booked > 0 || rData.returns > 0) {
        const booked = oData.booked || (rData.returns > 0 ? rData.returns : 0);
        const delivered = oData.delivered > 0 ? oData.delivered : Math.max(booked - rData.returns, 0);
        const returns = rData.returns || 0;
        const deliveryRateNum = booked > 0 ? Math.round((delivered / booked) * 100 * 100) / 100 : 0;
        const serumReturnsCount = rData.serumReturns || 0;
        const oilReturnsCount = rData.oilReturns || 0;
        const serumRate = booked > 0 ? Math.round((serumReturnsCount / booked) * 100) : (serumReturnsCount > 0 ? 100 : 0);
        const oilRate = booked > 0 ? Math.round((oilReturnsCount / booked) * 100) : (oilReturnsCount > 0 ? 100 : 0);

        rawStats.push({
          id: user._id,
          name: user.name,
          date: rData.latestDate ? new Date(rData.latestDate).toISOString().split('T')[0] : null,
          booked: booked,
          delivered: delivered,
          returns: returns,
          deliveryRate: deliveryRateNum,
          deliveryPercentage: `${deliveryRateNum}%`,
          deliveryTrend: deliveryRateNum >= 75 ? 'Progress' : 'Downfall',
          serumReturnsCount: serumReturnsCount,
          serumRate: serumRate,
          serumStatus: serumRate >= 15 ? 'high' : 'low',
          oilReturnsCount: oilReturnsCount,
          oilRate: oilRate,
          oilStatus: oilRate >= 15 ? 'high' : 'low'
        });
      }
    });

    // Also include unassigned returns if any
    const unassigned = returnMap['null'] || returnMap['undefined'];
    if (unassigned) {
      const uSerum = unassigned.serumReturns || 0;
      const uOil = unassigned.oilReturns || 0;
      rawStats.push({
        id: 'unassigned',
        name: 'Unknown',
        date: unassigned.latestDate ? new Date(unassigned.latestDate).toISOString().split('T')[0] : null,
        booked: unassigned.returns,
        delivered: 0,
        returns: unassigned.returns,
        deliveryRate: 0,
        deliveryPercentage: '0%',
        deliveryTrend: 'Downfall',
        serumReturnsCount: uSerum,
        serumRate: uSerum > 0 ? 100 : 0,
        serumStatus: uSerum > 0 ? 'high' : 'low',
        oilReturnsCount: uOil,
        oilRate: uOil > 0 ? 100 : 0,
        oilStatus: uOil > 0 ? 'high' : 'low'
      });
    }

    // Sort stats descending by returns / booked
    rawStats.sort((a, b) => b.returns - a.returns || b.booked - a.booked);

    // Assign Rank (1, 2, 3...)
    const statsWithRank = rawStats.map((item, index) => ({
      rank: index + 1,
      ...item
    }));

    const filteredStats = search
      ? statsWithRank.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
      : statsWithRank;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = pageNum * limitNum;
    const paginatedStats = filteredStats.slice(startIndex, endIndex);

    res.status(200).json({
      data: paginatedStats,
      total: filteredStats.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(filteredStats.length / limitNum)
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

const exportReturnOrders = async (req, res) => {
  try {
    const { search = '', assginTo, product, type, startDate, endDate, orderStartDate, orderEndDate } = req.query;
    const query = { isDeleted: { $ne: true } };

    if (orderStartDate || orderEndDate) {
      const orderQuery = { isDeleted: { $ne: true } };
      orderQuery.createdAt = {};
      if (orderStartDate) orderQuery.createdAt.$gte = new Date(orderStartDate);
      if (orderEndDate) {
        const end = new Date(orderEndDate);
        end.setUTCHours(23, 59, 59, 999);
        orderQuery.createdAt.$lte = end;
      }
      const Order = require('../models/orderModel');
      const matchedOrders = await Order.find(orderQuery).select('_id phone_number');
      const matchedIds = matchedOrders.map(o => o._id);
      const matchedPhones = matchedOrders.map(o => o.phone_number).filter(Boolean);

      query.$or = query.$or || [];
      query.$or.push({ orderId: { $in: matchedIds } });
      if (matchedPhones.length > 0) {
        query.$or.push({ phone_number: { $in: matchedPhones } });
      }
    }

    if (search) {
      const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const flexibleSearchPattern = escapedSearch.trim().replace(/\s+/g, '[\\s,]*');

      const matchedUsers = await User.find({ name: { $regex: flexibleSearchPattern, $options: 'i' } }).select('_id');
      const userIds = matchedUsers.map(u => u._id);

      const terms = search.trim().split(/\s+/).filter(t => t.length > 0);
      const productAllQuery = terms.length > 0 ? {
        products: {
          $all: terms.map(term => ({
            $elemMatch: { name: { $regex: term, $options: 'i' } }
          }))
        }
      } : null;

      const searchOr = [
        { customerName: { $regex: flexibleSearchPattern, $options: 'i' } },
        { phone_number: { $regex: flexibleSearchPattern, $options: 'i' } },
        { type: { $regex: flexibleSearchPattern, $options: 'i' } }
      ];

      if (userIds.length > 0) {
        searchOr.push({ assginTo: { $in: userIds } });
      }

      if (productAllQuery) {
        searchOr.push(productAllQuery);
      }

      if (!isNaN(search) && search.trim() !== '') {
        const num = Number(search);
        searchOr.push({ amount: num });
        searchOr.push({ 'products.amount': num });
        searchOr.push({ 'products.subtotal': num });
      }

      if (!query.$and) query.$and = [];
      query.$and.push({ $or: searchOr });
    }

    if (assginTo && assginTo !== 'all' && assginTo !== '') {
      query.assginTo = { $in: assginTo.split(',') };
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
    if (type && type !== 'all' && type !== '') {
      query.type = { $in: type.split(',') };
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

    const returnOrders = await ReturnOrder.find(query)
      .populate('assginTo', 'name')
      .populate('orderId')
      .sort({ createdAt: -1 })
      .lean();

    const Order = require('../models/orderModel');
    for (let i = 0; i < returnOrders.length; i++) {
      if (!returnOrders[i].orderId) {
        const matchedOrder = await Order.findOne({ phone_number: returnOrders[i].phone_number }).sort({ createdAt: -1 }).select('createdAt');
        if (matchedOrder) {
          returnOrders[i].orderId = { createdAt: matchedOrder.createdAt };
        }
      }
    }

    res.status(200).json(returnOrders);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get return order summary stats (Today's Returns, Weekly Progress, Product Return Rates)
// @route   GET /api/return-orders/stats/summary
// @access  Public
const getReturnOrderSummaryStats = async (req, res) => {
  try {
    const { startDate, endDate, assginTo, product } = req.query;

    const baseQuery = { isDeleted: { $ne: true } };
    if (assginTo && assginTo !== 'all') {
      const ids = assginTo.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      baseQuery.assginTo = { $in: objectIds };
    }
    if (product && product !== 'all') {
      const ids = product.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      baseQuery['products.productId'] = { $in: objectIds };
    }

    let dateFilter = null;
    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);

    const todayCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    });

    const yesterdayCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfYesterday, $lte: endOfYesterday }
    });

    let todayPercentage = 0;
    if (yesterdayCount > 0) {
      todayPercentage = Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100);
    } else if (todayCount > 0) {
      todayPercentage = 100;
    }

    // Weekly Returns Range (Last 7 days vs previous 7 days)
    const startOfThisWeek = new Date(now);
    startOfThisWeek.setDate(now.getDate() - 7);
    startOfThisWeek.setHours(0, 0, 0, 0);

    const startOfPrevWeek = new Date(now);
    startOfPrevWeek.setDate(now.getDate() - 14);
    startOfPrevWeek.setHours(0, 0, 0, 0);

    const thisWeekCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfThisWeek }
    });

    const prevWeekCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfPrevWeek, $lt: startOfThisWeek }
    });

    let weeklyPercentage = 0;
    if (prevWeekCount > 0) {
      weeklyPercentage = Math.round(((thisWeekCount - prevWeekCount) / prevWeekCount) * 100);
    } else if (thisWeekCount > 0) {
      weeklyPercentage = 100;
    }

    // Product Return Rates calculation
    const returnProductMatch = { ...baseQuery };
    const orderProductMatch = { isDeleted: { $ne: true } };

    if (dateFilter) {
      returnProductMatch.createdAt = dateFilter;
      orderProductMatch.createdAt = dateFilter;
    }

    const orderProductStats = await Order.aggregate([
      { $match: orderProductMatch },
      { $unwind: "$products" },
      {
        $group: {
          _id: { $toLower: "$products.name" },
          rawName: { $first: "$products.name" },
          totalOrders: { $sum: 1 }
        }
      }
    ]);

    const returnProductStats = await ReturnOrder.aggregate([
      { $match: returnProductMatch },
      { $unwind: "$products" },
      {
        $group: {
          _id: { $toLower: "$products.name" },
          rawName: { $first: "$products.name" },
          totalReturns: { $sum: 1 }
        }
      }
    ]);

    const orderMap = {};
    orderProductStats.forEach(item => {
      if (item._id) orderMap[item._id.trim()] = { totalOrders: item.totalOrders, rawName: item.rawName };
    });

    let serumReturns = 0, serumOrders = 0;
    let oilReturns = 0, oilOrders = 0;

    const productReturnRates = returnProductStats
      .filter(item => item._id)
      .map(item => {
        const key = item._id.trim();
        const rawName = item.rawName || key;
        const returned = item.totalReturns;
        const total = orderMap[key] ? orderMap[key].totalOrders : returned;
        const rate = total > 0 ? Math.round((returned / total) * 100) : 0;

        if (key.includes('serum')) {
          serumReturns += returned;
          serumOrders += total;
        }
        if (key.includes('oil')) {
          oilReturns += returned;
          oilOrders += total;
        }

        return {
          productName: rawName.toLowerCase().endsWith('return rate') ? rawName : `${rawName} Return Rate`,
          rawProductName: rawName,
          returnsCount: returned,
          totalOrdersCount: total,
          rate: rate,
          formattedRate: `${rate}%`,
          status: rate >= 15 ? 'high' : 'low'
        };
      })
      .sort((a, b) => b.rate - a.rate);

    const serumRateVal = serumOrders > 0 ? Math.round((serumReturns / serumOrders) * 100) : (serumReturns > 0 ? 100 : 0);
    const oilRateVal = oilOrders > 0 ? Math.round((oilReturns / oilOrders) * 100) : (oilReturns > 0 ? 100 : 0);

    const serumCategoryCard = {
      productName: "Serum Return Rate",
      rawProductName: "Serum",
      rate: serumRateVal,
      formattedRate: `${serumRateVal}%`,
      status: serumRateVal >= 15 ? "high" : "low"
    };

    const oilCategoryCard = {
      productName: "Oil Return Rate",
      rawProductName: "Oil",
      rate: oilRateVal,
      formattedRate: `${oilRateVal}%`,
      status: oilRateVal >= 15 ? "high" : "low"
    };

    const serumCardFound = productReturnRates.find(p => p.rawProductName.toLowerCase().includes('serum'));
    const serumCard = {
      ...(serumCardFound || serumCategoryCard),
      productName: "Serum Return Rate"
    };

    const oilCardFound = productReturnRates.find(p => p.rawProductName.toLowerCase().includes('oil'));
    const oilCard = {
      ...(oilCardFound || oilCategoryCard),
      productName: "Oil Return Rate"
    };

    // 4. Performance Trend (Last 6 Weeks calculation)
    const orderBaseMatch = { isDeleted: { $ne: true } };
    if (assginTo && assginTo !== 'all') {
      const ids = assginTo.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      orderBaseMatch.assginTo = { $in: objectIds };
    }
    if (product && product !== 'all') {
      const ids = product.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      orderBaseMatch['products.productId'] = { $in: objectIds };
    }

    const weeksTrend = [];
    for (let i = 5; i >= 0; i--) {
      const wStart = new Date(now);
      wStart.setDate(now.getDate() - (i + 1) * 7);
      wStart.setHours(0, 0, 0, 0);

      const wEnd = new Date(now);
      wEnd.setDate(now.getDate() - i * 7);
      wEnd.setHours(23, 59, 59, 999);

      const wTotalOrders = await Order.countDocuments({
        ...orderBaseMatch,
        createdAt: { $gte: wStart, $lte: wEnd }
      });

      const wDeliveredOrders = await Order.countDocuments({
        ...orderBaseMatch,
        status: { $regex: /delivered/i },
        createdAt: { $gte: wStart, $lte: wEnd }
      });

      const wReturnOrders = await ReturnOrder.countDocuments({
        ...baseQuery,
        createdAt: { $gte: wStart, $lte: wEnd }
      });

      let delRate = 0;
      let retRate = 0;
      if (wTotalOrders > 0) {
        delRate = Math.round((wDeliveredOrders / wTotalOrders) * 100);
        retRate = Math.round((wReturnOrders / wTotalOrders) * 100);
      } else if (wReturnOrders > 0) {
        retRate = 100;
        delRate = 0;
      } else {
        delRate = 0;
        retRate = 0;
      }

      let labelName = "";
      if (i === 5) labelName = "5 Wks Ago";
      else if (i === 4) labelName = "4 Wks Ago";
      else if (i === 3) labelName = "3 Wks Ago";
      else if (i === 2) labelName = "2 Wks Ago";
      else if (i === 1) labelName = "Last week";
      else if (i === 0) labelName = "This week";

      weeksTrend.push({
        period: labelName,
        deliveredRate: delRate,
        returnRate: retRate
      });
    }

    // 5. Product Distribution (Serum vs Oil)
    const serumTotalCount = serumReturns;
    const oilTotalCount = oilReturns;
    const distTotal = serumTotalCount + oilTotalCount;
    let serumDistPct = distTotal > 0 ? Math.round((serumTotalCount / distTotal) * 100) : 0;
    let oilDistPct = distTotal > 0 ? 100 - serumDistPct : 0;

    res.status(200).json({
      todaysReturns: {
        title: "Today's Returns",
        count: todayCount,
        percentage: todayPercentage,
        formattedPercentage: `${todayPercentage >= 0 ? '+' : ''}${todayPercentage}%`,
        trend: todayPercentage >= 0 ? "Progress" : "Downfall",
        direction: todayPercentage >= 0 ? "up" : "down"
      },
      weeklyProgress: {
        title: "Weekly Progress",
        count: thisWeekCount,
        percentage: weeklyPercentage,
        formattedPercentage: `${weeklyPercentage >= 0 ? '+' : ''}${weeklyPercentage}%`,
        trend: weeklyPercentage >= 0 ? "Progress" : "Downfall",
        direction: weeklyPercentage >= 0 ? "up" : "down"
      },
      productReturnRates: [
        serumCard,
        oilCard,
        ...productReturnRates.filter(p => p !== serumCard && p !== oilCard)
      ],
      performanceTrend: weeksTrend,
      productDistribution: {
        serumCount: serumTotalCount,
        serumPercentage: serumDistPct,
        oilCount: oilTotalCount,
        oilPercentage: oilDistPct
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Export staff return order stats to Excel
// @route   GET /api/return-orders/stats/staff/export
// @access  Protect
const exportStaffReturnStats = async (req, res) => {
  try {
    const { startDate, endDate, search = '', assginTo, product } = req.query;
    const User = require('../models/userModel');
    const Order = require('../models/orderModel');

    const baseQuery = { isDeleted: { $ne: true } };
    if (assginTo && assginTo !== 'all') {
      const ids = assginTo.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      baseQuery.assginTo = { $in: objectIds };
    }
    if (product && product !== 'all') {
      const ids = product.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      baseQuery['products.productId'] = { $in: objectIds };
    }

    let dateFilter = null;
    if (startDate || endDate) {
      dateFilter = {};
      if (startDate) dateFilter.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
    }

    // 1. Calculate Summary Cards Data
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);

    const todayCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    });

    const yesterdayCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfYesterday, $lte: endOfYesterday }
    });

    let todayPercentage = 0;
    if (yesterdayCount > 0) {
      todayPercentage = Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100);
    } else if (todayCount > 0) {
      todayPercentage = 100;
    }

    const startOfThisWeek = new Date(now);
    startOfThisWeek.setDate(now.getDate() - 7);
    startOfThisWeek.setHours(0, 0, 0, 0);

    const startOfPrevWeek = new Date(now);
    startOfPrevWeek.setDate(now.getDate() - 14);
    startOfPrevWeek.setHours(0, 0, 0, 0);

    const thisWeekCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfThisWeek }
    });

    const prevWeekCount = await ReturnOrder.countDocuments({
      ...baseQuery,
      createdAt: { $gte: startOfPrevWeek, $lt: startOfThisWeek }
    });

    let weeklyPercentage = 0;
    if (prevWeekCount > 0) {
      weeklyPercentage = Math.round(((thisWeekCount - prevWeekCount) / prevWeekCount) * 100);
    } else if (thisWeekCount > 0) {
      weeklyPercentage = 100;
    }

    // Product Return Rates calculation
    const returnProductMatch = { ...baseQuery };
    const orderProductMatch = { isDeleted: { $ne: true } };

    if (dateFilter) {
      returnProductMatch.createdAt = dateFilter;
      orderProductMatch.createdAt = dateFilter;
    }

    const orderProductStats = await Order.aggregate([
      { $match: orderProductMatch },
      { $unwind: "$products" },
      {
        $group: {
          _id: { $toLower: "$products.name" },
          rawName: { $first: "$products.name" },
          totalOrders: { $sum: 1 }
        }
      }
    ]);

    const returnProductStats = await ReturnOrder.aggregate([
      { $match: returnProductMatch },
      { $unwind: "$products" },
      {
        $group: {
          _id: { $toLower: "$products.name" },
          rawName: { $first: "$products.name" },
          totalReturns: { $sum: 1 }
        }
      }
    ]);

    const orderProdMap = {};
    orderProductStats.forEach(item => {
      if (item._id) orderProdMap[item._id.trim()] = { totalOrders: item.totalOrders, rawName: item.rawName };
    });

    let serumReturns = 0, serumOrders = 0;
    let oilReturns = 0, oilOrders = 0;

    const productReturnRates = returnProductStats
      .filter(item => item._id)
      .map(item => {
        const key = item._id.trim();
        const rawName = item.rawName || key;
        const returned = item.totalReturns;
        const total = orderProdMap[key] ? orderProdMap[key].totalOrders : returned;
        const rate = total > 0 ? Math.round((returned / total) * 100) : 0;

        if (key.includes('serum')) {
          serumReturns += returned;
          serumOrders += total;
        }
        if (key.includes('oil')) {
          oilReturns += returned;
          oilOrders += total;
        }

        return {
          productName: rawName.toLowerCase().endsWith('return rate') ? rawName : `${rawName} Return Rate`,
          rawProductName: rawName,
          rate: rate,
          formattedRate: `${rate}%`,
          status: rate >= 15 ? 'high' : 'low'
        };
      })
      .sort((a, b) => b.rate - a.rate);

    const serumRateVal = serumOrders > 0 ? Math.round((serumReturns / serumOrders) * 100) : (serumReturns > 0 ? 100 : 0);
    const oilRateVal = oilOrders > 0 ? Math.round((oilReturns / oilOrders) * 100) : (oilReturns > 0 ? 100 : 0);

    const prod1Card = { productName: "Serum Return Rate", formattedRate: `${serumRateVal}%`, status: serumRateVal >= 15 ? 'high' : 'low' };
    const prod2Card = { productName: "Oil Return Rate", formattedRate: `${oilRateVal}%`, status: oilRateVal >= 15 ? 'high' : 'low' };

    // 2. Fetch Staff Return Stats Table Data
    const dateMatch = { isDeleted: { $ne: true } };
    if (startDate || endDate) {
      dateMatch.createdAt = dateFilter;
    }

    let userQuery = { isDeleted: { $ne: true } };
    if (assginTo && assginTo !== 'all') {
      const ids = assginTo.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      userQuery._id = { $in: objectIds };
    }

    const users = await User.find(userQuery).select('_id name');

    const orderStats = await Order.aggregate([
      { $match: dateMatch },
      {
        $group: {
          _id: "$assginTo",
          booked: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [
                { $regexMatch: { input: { $ifNull: ["$status", ""] }, regex: /delivered/i } },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const returnOrderMatch = { ...dateMatch };
    if (product && product !== 'all') {
      const ids = product.split(',').map(id => id.trim()).filter(Boolean);
      const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
      returnOrderMatch['products.productId'] = { $in: objectIds };
    }

    const returnStats = await ReturnOrder.aggregate([
      { $match: returnOrderMatch },
      {
        $group: {
          _id: "$assginTo",
          returns: { $sum: 1 },
          latestDate: { $max: "$createdAt" },
          serumReturns: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: { $ifNull: ["$products", []] },
                          as: "p",
                          cond: { $regexMatch: { input: { $ifNull: ["$$p.name", ""] }, regex: /serum/i } }
                        }
                      }
                    },
                    0
                  ]
                },
                1,
                0
              ]
            }
          },
          oilReturns: {
            $sum: {
              $cond: [
                {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: { $ifNull: ["$products", []] },
                          as: "p",
                          cond: { $regexMatch: { input: { $ifNull: ["$$p.name", ""] }, regex: /oil/i } }
                        }
                      }
                    },
                    0
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const orderMap = {};
    orderStats.forEach(o => {
      if (o._id) orderMap[o._id.toString()] = o;
    });

    const returnMap = {};
    returnStats.forEach(r => {
      if (r._id) returnMap[r._id.toString()] = r;
    });

    let rawStats = [];

    users.forEach((user) => {
      const uId = user._id.toString();
      const oData = orderMap[uId] || { booked: 0, delivered: 0 };
      const rData = returnMap[uId] || { returns: 0, serumReturns: 0, oilReturns: 0, latestDate: null };

      if (oData.booked > 0 || rData.returns > 0) {
        const booked = oData.booked || (rData.returns > 0 ? rData.returns : 0);
        const delivered = oData.delivered > 0 ? oData.delivered : Math.max(booked - rData.returns, 0);
        const returns = rData.returns || 0;
        const deliveryRateNum = booked > 0 ? Math.round((delivered / booked) * 100 * 100) / 100 : 0;
        const serumReturnsCount = rData.serumReturns || 0;
        const oilReturnsCount = rData.oilReturns || 0;
        const serumRate = booked > 0 ? Math.round((serumReturnsCount / booked) * 100) : (serumReturnsCount > 0 ? 100 : 0);
        const oilRate = booked > 0 ? Math.round((oilReturnsCount / booked) * 100) : (oilReturnsCount > 0 ? 100 : 0);

        rawStats.push({
          id: user._id,
          name: user.name,
          date: rData.latestDate ? new Date(rData.latestDate).toISOString().split('T')[0] : null,
          booked: booked,
          delivered: delivered,
          returns: returns,
          deliveryRate: deliveryRateNum,
          deliveryPercentage: `${deliveryRateNum}%`,
          deliveryTrend: deliveryRateNum >= 75 ? 'Progress' : 'Downfall',
          serumReturnsCount: serumReturnsCount,
          serumRate: serumRate,
          serumStatus: serumRate >= 15 ? 'high' : 'low',
          oilReturnsCount: oilReturnsCount,
          oilRate: oilRate,
          oilStatus: oilRate >= 15 ? 'high' : 'low'
        });
      }
    });

    const unassigned = returnMap['null'] || returnMap['undefined'];
    if (unassigned) {
      const uSerum = unassigned.serumReturns || 0;
      const uOil = unassigned.oilReturns || 0;
      rawStats.push({
        id: 'unassigned',
        name: 'Unknown',
        date: unassigned.latestDate ? new Date(unassigned.latestDate).toISOString().split('T')[0] : null,
        booked: unassigned.returns,
        delivered: 0,
        returns: unassigned.returns,
        deliveryRate: 0,
        deliveryPercentage: '0%',
        deliveryTrend: 'Downfall',
        serumReturnsCount: uSerum,
        serumRate: uSerum > 0 ? 100 : 0,
        serumStatus: uSerum > 0 ? 'high' : 'low',
        oilReturnsCount: uOil,
        oilRate: uOil > 0 ? 100 : 0,
        oilStatus: uOil > 0 ? 'high' : 'low'
      });
    }

    rawStats.sort((a, b) => b.returns - a.returns || b.booked - a.booked);

    const statsWithRank = rawStats.map((item, index) => ({
      rank: index + 1,
      ...item
    }));

    const filteredStats = search
      ? statsWithRank.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
      : statsWithRank;

    // 3. Build Excel Workbook
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Staff Return Report');

    // Title Row
    worksheet.mergeCells('A1:K1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'RETURN ORDER REPORT SUMMARY';
    titleCell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 12 };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F5257' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 28;

    // Summary Stat Cards (Rows 3 & 4)
    worksheet.getCell('A3').value = "Today's Returns";
    worksheet.getCell('A4').value = `${todayCount} orders`;

    worksheet.getCell('D3').value = "Weekly Progress";
    worksheet.getCell('D4').value = `${thisWeekCount} orders`;

    worksheet.getCell('G3').value = prod1Card.productName;
    worksheet.getCell('G4').value = prod1Card.formattedRate;

    worksheet.getCell('J3').value = prod2Card.productName;
    worksheet.getCell('J4').value = prod2Card.formattedRate;

    worksheet.mergeCells('A3:C3');
    worksheet.mergeCells('A4:C4');
    worksheet.mergeCells('D3:F3');
    worksheet.mergeCells('D4:F4');
    worksheet.mergeCells('G3:I3');
    worksheet.mergeCells('G4:I4');
    worksheet.mergeCells('J3:K3');
    worksheet.mergeCells('J4:K4');

    const cardStyles = [
      { top: 'A3', bottom: 'A4', bg: 'E6F4EA', fg: '137333' },
      { top: 'D3', bottom: 'D4', bg: 'E8F0FE', fg: '1A73E8' },
      { top: 'G3', bottom: 'G4', bg: 'FCE8E6', fg: 'C5221F' },
      { top: 'J3', bottom: 'J4', bg: 'FEF7E0', fg: 'B06000' }
    ];

    cardStyles.forEach(card => {
      const topCell = worksheet.getCell(card.top);
      topCell.font = { bold: true, size: 9, color: { argb: '5F6368' } };
      topCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.bg } };
      topCell.alignment = { vertical: 'middle', horizontal: 'center' };

      const bottomCell = worksheet.getCell(card.bottom);
      bottomCell.font = { bold: true, size: 10, color: { argb: card.fg } };
      bottomCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.bg } };
      bottomCell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    worksheet.getRow(3).height = 18;
    worksheet.getRow(4).height = 22;

    // Table Headers (Row 6)
    const tableHeaderRow = worksheet.getRow(6);
    tableHeaderRow.values = [
      'Rank', 'Staff Name', 'Booked', 'Delivered', 'Returns', 'Delivery %', 'Delivery Trend', 'Serum Returns', 'Serum Status', 'Oil Returns', 'Oil Status'
    ];
    tableHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    tableHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F5257' } };
    tableHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
    tableHeaderRow.height = 26;

    worksheet.getColumn(1).width = 8;
    worksheet.getColumn(2).width = 25;
    worksheet.getColumn(3).width = 12;
    worksheet.getColumn(4).width = 12;
    worksheet.getColumn(5).width = 12;
    worksheet.getColumn(6).width = 16;
    worksheet.getColumn(7).width = 16;
    worksheet.getColumn(8).width = 16;
    worksheet.getColumn(9).width = 14;
    worksheet.getColumn(10).width = 16;
    worksheet.getColumn(11).width = 14;

    filteredStats.forEach((r) => {
      const row = worksheet.addRow([
        r.rank,
        r.name,
        r.booked,
        r.delivered,
        r.returns,
        r.deliveryPercentage,
        r.deliveryTrend,
        r.serumReturnsCount,
        r.serumStatus === 'high' ? 'High' : 'Low',
        r.oilReturnsCount,
        r.oilStatus === 'high' ? 'High' : 'Low'
      ]);

      row.height = 22;
      row.alignment = { vertical: 'middle' };

      for (let c = 1; c <= 11; c++) {
        const cell = row.getCell(c);
        if (c !== 2) cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'E5E7EB' } },
          left: { style: 'thin', color: { argb: 'E5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
          right: { style: 'thin', color: { argb: 'E5E7EB' } }
        };
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=staff_return_report_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export Staff Return Stats Error:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getReturnOrders, getReturnOrderById, createReturnOrder, updateReturnOrder, deleteReturnOrder, getStaffReturnStats, getReturnOrderSummaryStats, exportReturnOrders, exportStaffReturnStats };
