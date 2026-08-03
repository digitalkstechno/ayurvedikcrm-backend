const mongoose = require('mongoose');
const ActivityLog = require('../models/activityLogModel');
const User = require('../models/userModel');
const Customer = require('../models/customerModel');
const Lead = require('../models/leadModel');

// @desc    Get all activity logs
// @route   GET /api/activity-logs
// @access  Private
const getActivityLogs = async (req, res) => {
  try {
    const { page = 1, limit = 100, userId, startDate, endDate, search = '' } = req.query;
    const query = {};

    if (search) {
      const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const flexibleSearchPattern = escapedSearch.trim().replace(/\s+/g, '[\\s,]*');

      // Find users matching search
      const matchedUsers = await User.find({ name: { $regex: flexibleSearchPattern, $options: 'i' } });
      const userIds = matchedUsers.map(u => u._id);

      // Find customers matching search
      const matchedCustomers = await Customer.find({
        $or: [
          { name: { $regex: flexibleSearchPattern, $options: 'i' } },
          { phone_number: { $regex: flexibleSearchPattern, $options: 'i' } }
        ]
      });
      const customerIds = matchedCustomers.map(c => c._id);
      
      // Find leads for these customers
      const matchedLeads = await Lead.find({ customer: { $in: customerIds } });
      const leadIds = matchedLeads.map(l => l._id);

      query.$or = [
        { message: { $regex: flexibleSearchPattern, $options: 'i' } },
        { user: { $in: userIds } },
        { lead: { $in: leadIds } }
      ];
    }

    // Check if current user is admin/superadmin
    const isAdmin = req.user && (
      req.user.roles.includes('admin') || 
      req.user.roles.includes('superadmin') || 
      req.user.email === 'superadmin@gmail.com'
    );

    if (isAdmin) {
      // Admin can view all logs, optionally filtered by a specific user
      if (userId && userId !== 'all') {
        if (mongoose.Types.ObjectId.isValid(userId)) {
          query.user = new mongoose.Types.ObjectId(userId);
        }
      }
    } else {
      // Non-admin can ONLY view their own logs
      query.user = req.user._id;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const logs = await ActivityLog.find(query)
      .populate('user', 'name email')
      .populate({
        path: 'lead',
        populate: {
          path: 'customer',
          select: 'name phone_number'
        }
      })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const count = await ActivityLog.countDocuments(query);

    res.status(200).json({
      data: logs,
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

module.exports = {
  getActivityLogs
};
