const mongoose = require('mongoose');
const Order = require('../models/orderModel');
const Lead = require('../models/leadModel');
const ActivityLog = require('../models/activityLogModel');
const User = require('../models/userModel');

// @desc    Get all orders
// @route   GET /api/orders
// @access  Public
const getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 100, search = '', assginTo, status, courier, product, startDate, endDate } = req.query;
    const query = {
      isDeleted: { $ne: true }
    };

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
    if (product && product !== 'all' && product !== '') {
      query['products.name'] = { $regex: product.split(',').map(p => p.trim()).join('|'), $options: 'i' };
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

    const count = await Order.countDocuments(query);

    res.status(200).json({
      data: orders,
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

    const statusChanged = req.body.status && req.body.status.toString() !== (order.status ? order.status.toString() : '');

    const updated = await Order.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (req.user) {
      await ActivityLog.create({
        user: req.user._id,
        lead: updated.leadId || null,
        action: statusChanged ? 'Status Change' : 'Update',
        message: statusChanged ? 'Lead Status Two Change successfully' : 'Order updated successfully'
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
            $elemMatch: { name: { $regex: term, $options: 'i' } }
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
    if (product && product !== 'all' && product !== '') {
      query['products.name'] = { $regex: product.split(',').map(p => p.trim()).join('|'), $options: 'i' };
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
