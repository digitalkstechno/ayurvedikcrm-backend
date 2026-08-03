const mongoose = require('mongoose');
const ReturnOrder = require('../models/returnOrderModel');
const Order = require('../models/orderModel');
const User = require('../models/userModel');

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
    if (product && product !== 'all' && product !== '') {
      query['products.productId'] = { $in: product.split(',') };
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
    const { startDate, endDate, search = '' } = req.query;
    const User = require('../models/userModel');
    const users = await User.find({ isDeleted: { $ne: true } }).select('_id name');
    
    const matchStage = { isDeleted: { $ne: true } };
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = end;
      }
    }
    
    const returnOrders = await ReturnOrder.aggregate([
      { $match: matchStage },
      { 
        $group: { 
          _id: { 
            assginTo: "$assginTo", 
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
          }, 
          returns: { $sum: 1 } 
        } 
      },
      { $sort: { "_id.date": -1 } }
    ]);

    const stats = [];
    returnOrders.forEach(ro => {
      const uId = ro._id.assginTo ? ro._id.assginTo.toString() : null;
      const user = users.find(u => u._id.toString() === uId);
      if (user) {
        stats.push({
          id: `${user._id}_${ro._id.date}`,
          name: user.name,
          date: ro._id.date,
          returns: ro.returns
        });
      }
    });

    const filteredStats = search
      ? stats.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
      : stats;

    res.status(200).json(filteredStats);
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
    if (product && product !== 'all' && product !== '') {
      query['products.productId'] = { $in: product.split(',') };
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

module.exports = { getReturnOrders, getReturnOrderById, createReturnOrder, updateReturnOrder, deleteReturnOrder, getStaffReturnStats, exportReturnOrders };
