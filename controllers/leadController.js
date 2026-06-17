const Lead = require('../models/leadModel');
const Customer = require('../models/customerModel');
const ActivityLog = require('../models/activityLogModel');


// @desc    Get all leads
// @route   GET /api/leads
// @access  Public
const getLeads = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', assgin, status, reason_call, product, startDate, endDate, reminderStartDate, reminderEndDate, isRepeat, isDeleted } = req.query;
    const query = { orderStatus: { $ne: true } };

    if (isDeleted === 'true') {
      query.isDeleted = true;
    } else {
      query.isDeleted = { $ne: true };
    }

    if (isRepeat === 'true') {
      query.isRepeat = true;
    } else {
      query.isRepeat = { $ne: true };
    }

    if (search) {
      const matchedCustomers = await Customer.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { phone_number: { $regex: search, $options: 'i' } }
        ]
      });
      const customerIds = matchedCustomers.map(c => c._id);
      query.customer = { $in: customerIds };
    }
    const isAdmin = req.user && (
      req.user.roles.includes('admin') ||
      req.user.roles.includes('superadmin') ||
      req.user.email === 'superadmin@gmail.com'
    );
    const isManager = req.user && req.user.roles.some(r => ['manager', 'main manager', 'maneger', 'main maneger'].includes(r.toLowerCase()));
    console.log("isManager", isManager);
    if (isAdmin) {
      if (assgin && assgin !== 'all' && assgin !== '') query.assgin = { $in: assgin.split(',') };
    } else if (isManager) {
      const Team = require('../models/teamModel');
      const teams = await Team.find({ head: req.user._id });
      let allowedUsers = [req.user._id.toString()];
      teams.forEach(team => {
        if (team.member) {
          team.member.forEach(m => {
            if (m) allowedUsers.push(m.toString());
          });
        }
      });
      // Ensure unique array
      allowedUsers = [...new Set(allowedUsers)];

      if (assgin && assgin !== 'all' && assgin !== '') {
        const requestedAssigns = assgin.split(',');
        const validAssigns = requestedAssigns.filter(a => allowedUsers.includes(a));
        query.assgin = { $in: validAssigns.length ? validAssigns : allowedUsers };
      } else {
        query.assgin = { $in: allowedUsers };
      }
    } else {
      query.assgin = req.user ? req.user._id : null;
    }
    if (status && status !== 'all' && status !== '') query.status = { $in: status.split(',') };
    if (reason_call && reason_call !== 'all' && reason_call !== '') query.reason_call = { $in: reason_call.split(',') };
    if (product && product !== 'all' && product !== '') query['products.productId'] = { $in: product.split(',') };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (reminderStartDate || reminderEndDate) {
      query.reminder = {};
      if (reminderStartDate) query.reminder.$gte = reminderStartDate;
      if (reminderEndDate) query.reminder.$lte = reminderEndDate;
    }

    const [leads, count] = await Promise.all([
      Lead.find(query)
        .populate('assgin', 'name')
        .populate('status', 'name color')
        .populate('reason_call', 'name')
        .populate('customer', 'name phone_number')
        .populate('deletedBy', 'name')
        .populate('addedBy', 'name')
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .sort({ createdAt: -1 })
        .lean(),
      Lead.countDocuments(query)
    ]);

    const mappedLeads = leads.map(lead => {
      if (lead.customer) {
        lead.name = lead.customer.name;
        lead.phone_number = lead.customer.phone_number;
      }
      if (lead.addedBy && lead.addedBy.name) {
        lead.addedByName = lead.addedBy.name;
      }
      return lead;
    });

    res.status(200).json({
      data: mappedLeads,
      total: count,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(count / limit)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single lead
// @route   GET /api/leads/:id
// @access  Public
const getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assgin', 'name')
      .populate('status', 'name color')
      .populate('reason_call', 'name')
      .populate('customer', 'name phone_number');
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    const obj = lead.toObject();
    if (obj.customer) {
      obj.name = obj.customer.name;
      obj.phone_number = obj.customer.phone_number;
    }
    res.status(200).json(obj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get latest lead by phone
// @route   GET /api/leads/latest/:phone
// @access  Public
const getLatestLeadByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const customer = await Customer.findOne({ phone_number: phone });
    if (!customer) {
      return res.status(404).json({ message: 'No customer found with this phone number' });
    }

    const latestLead = await Lead.findOne({ customer: customer._id })
      .populate('assgin', 'name')
      .populate('status', 'name color')
      .populate('reason_call', 'name')
      .populate('products.productId', 'name amount')
      .sort({ createdAt: -1 });

    if (!latestLead) {
      return res.status(404).json({ message: 'No leads found for this customer' });
    }

    const obj = latestLead.toObject();
    obj.name = customer.name;
    obj.phone_number = customer.phone_number;

    res.status(200).json(obj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a lead
// @route   POST /api/leads
// @access  Public
const createLead = async (req, res) => {
  try {
    const { name, phone_number, ...rest } = req.body;
    let customerId = null;

    if (phone_number) {
      let existingCustomer = await Customer.findOne({ phone_number });
      if (!existingCustomer) {
        existingCustomer = await Customer.create({ name: name || '', phone_number });
      } else if (name && existingCustomer.name !== name) {
        existingCustomer.name = name;
        await existingCustomer.save();
      }
      customerId = existingCustomer._id;
    }

    if (!customerId) {
      return res.status(400).json({ message: 'Valid phone number required to assign customer reference' });
    }

    // Check if current user is admin/superadmin
    const isAdmin = req.user && (
      req.user.roles.includes('admin') ||
      req.user.roles.includes('superadmin') ||
      req.user.email === 'superadmin@gmail.com'
    );

    const payload = { ...rest, customer: customerId, isRepeat: Boolean(req.body.isRepeat) };
    if (!isAdmin) {
      if (payload.isRepeat && req.body.assgin) {
        payload.assgin = req.body.assgin;
        payload.addedBy = req.user ? req.user._id : undefined;
      } else {
        payload.assgin = req.user ? req.user._id : undefined;
      }
    } else {
      if (payload.isRepeat) {
        payload.addedBy = req.user ? req.user._id : undefined;
      }
    }

    const lead = await Lead.create(payload);

    // Create activity log
    if (req.user) {
      await ActivityLog.create({
        user: req.user._id,
        lead: lead._id,
        action: 'Create',
        message: 'Lead Created successfully'
      });
    }

    res.status(201).json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a lead
// @route   PUT /api/leads/:id
// @access  Public
const updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const { name, phone_number, ...rest } = req.body;
    let payload = { ...rest };

    const statusChanged = req.body.status && req.body.status.toString() !== (lead.status ? lead.status.toString() : '');
    const orderStatusChanged = req.body.orderStatus !== undefined && req.body.orderStatus !== lead.orderStatus;

    if (phone_number) {
      let existingCustomer = await Customer.findOne({ phone_number });
      if (!existingCustomer) {
        existingCustomer = await Customer.create({ name: name || '', phone_number });
      } else if (name && existingCustomer.name !== name) {
        existingCustomer.name = name;
        await existingCustomer.save();
      }
      payload.customer = existingCustomer._id;
    }

    // Check if current user is admin/superadmin
    const isAdmin = req.user && (
      req.user.roles.includes('admin') ||
      req.user.roles.includes('superadmin') ||
      req.user.email === 'superadmin@gmail.com'
    );

    if (!isAdmin) {
      payload.assgin = req.user ? req.user._id : lead.assgin;
    }

    const updated = await Lead.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });

    if (req.user) {
      let action = 'Update';
      let logMsg = 'Lead Edited successfully';
      if (statusChanged) {
        action = 'Status Change';
        logMsg = 'Lead Status Change successfully';
      } else if (orderStatusChanged) {
        action = 'Convert To Order';
        logMsg = 'Lead Convert To Order successfully';
      }

      await ActivityLog.create({
        user: req.user._id,
        lead: updated._id,
        action,
        message: logMsg
      });
    }

    res.status(200).json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a lead (soft delete)
// @route   DELETE /api/leads/:id
// @access  Public
const deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    await Lead.findByIdAndUpdate(req.params.id, {
      isDeleted: true,
      deleteDate: new Date(),
      deletedBy: req.user ? req.user._id : undefined
    }, { new: true });

    if (req.user) {
      await ActivityLog.create({
        user: req.user._id,
        lead: lead._id,
        action: 'Delete',
        message: 'Lead Deleted successfully'
      });
    }

    res.status(200).json({ message: 'Lead deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const exportLeads = async (req, res) => {
  try {
    const { search = '', assgin, status, reason_call, product, startDate, endDate } = req.query;
    const query = { isDeleted: { $ne: true }, orderStatus: { $ne: true } };

    if (search) {
      const matchedCustomers = await Customer.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { phone_number: { $regex: search, $options: 'i' } }
        ]
      });
      const customerIds = matchedCustomers.map(c => c._id);
      query.customer = { $in: customerIds };
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

    const isAdmin = req.user && (
      req.user.roles.includes('admin') ||
      req.user.roles.includes('superadmin') ||
      req.user.email === 'superadmin@gmail.com'
    );
    const isManager = req.user && req.user.roles.some(r => ['manager', 'main manager', 'maneger', 'main maneger'].includes(r.toLowerCase()));

    if (isAdmin) {
      if (assgin && assgin !== 'all') query.assgin = assgin;
    } else if (isManager) {
      const Team = require('../models/teamModel');
      const teams = await Team.find({ head: req.user._id });
      let allowedUsers = [req.user._id.toString()];
      teams.forEach(team => {
        if (team.member) {
          team.member.forEach(m => {
            if (m) allowedUsers.push(m.toString());
          });
        }
      });
      allowedUsers = [...new Set(allowedUsers)];

      if (assgin && assgin !== 'all') {
        if (allowedUsers.includes(assgin)) {
          query.assgin = assgin;
        } else {
          query.assgin = { $in: allowedUsers };
        }
      } else {
        query.assgin = { $in: allowedUsers };
      }
    } else {
      query.assgin = req.user ? req.user._id : null;
    }

    const leads = await Lead.find(query)
      .populate('assgin', 'name')
      .populate('status', 'name')
      .populate('reason_call', 'name')
      .populate('customer', 'name phone_number')
      .sort({ createdAt: -1 });

    const mappedLeads = leads.map(lead => {
      const obj = lead.toObject();
      if (obj.customer) {
        obj.name = obj.customer.name;
        obj.phone_number = obj.customer.phone_number;
      }
      return obj;
    });

    res.status(200).json(mappedLeads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const bulkReassignLeads = async (req, res) => {
  try {
    const { fromUserId, toUserIds } = req.body;

    if (!fromUserId || !toUserIds || !Array.isArray(toUserIds) || toUserIds.length === 0) {
      return res.status(400).json({ message: 'Please provide fromUserId and an array of toUserIds' });
    }

    // Find all open leads assigned to fromUserId
    const leads = await Lead.find({ assgin: fromUserId, isDeleted: { $ne: true }, orderStatus: { $ne: true } });

    if (leads.length === 0) {
      return res.status(404).json({ message: 'No active leads found for the selected staff member' });
    }

    const numTargets = toUserIds.length;
    const bulkOps = [];
    const activityLogs = [];

    leads.forEach((lead, index) => {
      const targetUserId = toUserIds[index % numTargets];

      bulkOps.push({
        updateOne: {
          filter: { _id: lead._id },
          update: { assgin: targetUserId }
        }
      });

      if (req.user) {
        activityLogs.push({
          user: req.user._id,
          lead: lead._id,
          action: 'Reassign',
          message: 'Lead bulk reassigned to another staff'
        });
      }
    });

    await Lead.bulkWrite(bulkOps);
    if (activityLogs.length > 0) {
      await ActivityLog.insertMany(activityLogs);
    }

    res.status(200).json({ message: `Successfully reassigned ${leads.length} leads to ${numTargets} staff members` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  exportLeads,
  getLatestLeadByPhone,
  bulkReassignLeads
};
