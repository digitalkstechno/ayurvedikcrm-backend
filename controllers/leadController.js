const Lead = require('../models/leadModel');
const Customer = require('../models/customerModel');
const ActivityLog = require('../models/activityLogModel');
const { sendLeadEventToFacebook } = require('../services/facebookCapi');
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Status = require('../models/statusModel');
const ReasonToCall = require('../models/reasonToCallModel');

// @desc    Get all leads
// @route   GET /api/leads
// @access  Public
const getLeads = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', assgin, status, reason_call, product, startDate, endDate, reminderStartDate, reminderEndDate, isRepeat, isDeleted, age } = req.query;
    const query = {};
    
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
      const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const flexibleSearchPattern = escapedSearch.trim().replace(/\s+/g, '[\\s,]*');

      const [matchedCustomers, matchedUsers, matchedStatuses, matchedReasons] = await Promise.all([
        Customer.find({
          $or: [
            { name: { $regex: flexibleSearchPattern, $options: 'i' } },
            { phone_number: { $regex: flexibleSearchPattern, $options: 'i' } }
          ]
        }),
        User.find({
          name: { $regex: flexibleSearchPattern, $options: 'i' }
        }),
        Status.find({
          name: { $regex: flexibleSearchPattern, $options: 'i' }
        }),
        ReasonToCall.find({
          name: { $regex: flexibleSearchPattern, $options: 'i' }
        })
      ]);

      const customerIds = matchedCustomers.map(c => c._id);
      const userIds = matchedUsers.map(u => u._id);
      const statusIds = matchedStatuses.map(s => s._id);
      const reasonIds = matchedReasons.map(r => r._id);

      const terms = search.trim().split(/\s+/).filter(t => t.length > 0);
      const productAllQuery = terms.length > 0 ? {
        products: {
          $all: terms.map(term => ({
            $elemMatch: { name: { $regex: term, $options: 'i' } }
          }))
        }
      } : null;

      query.$or = [
        { customer: { $in: customerIds } },
        { assgin: { $in: userIds } },
        { status: { $in: statusIds } },
        { reason_call: { $in: reasonIds } },
        { remark: { $regex: flexibleSearchPattern, $options: 'i' } },
        { note: { $regex: flexibleSearchPattern, $options: 'i' } },
        { address: { $regex: flexibleSearchPattern, $options: 'i' } },
        { gender: { $regex: flexibleSearchPattern, $options: 'i' } },
        { paymentType: { $regex: flexibleSearchPattern, $options: 'i' } },
        { courier: { $regex: flexibleSearchPattern, $options: 'i' } },
        { transactionId: { $regex: flexibleSearchPattern, $options: 'i' } }
      ];

      if (productAllQuery) {
        query.$or.push(productAllQuery);
      }

      if (!isNaN(search) && search.trim() !== '') {
        const num = Number(search);
        query.$or.push({ age: num });
        query.$or.push({ 'products.amount': num });
        query.$or.push({ 'products.subtotal': num });
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

    const statusFilter = parseObjectIdFilter(status);
    if (statusFilter) query.status = statusFilter;

    const reasonFilter = parseObjectIdFilter(reason_call);
    if (reasonFilter) query.reason_call = reasonFilter;

    const productFilter = parseObjectIdFilter(product);
    if (productFilter) query['products.productId'] = productFilter;

    if (isAdmin) {
      const assignFilter = parseObjectIdFilter(assgin);
      if (assignFilter) query.assgin = assignFilter;
    } else {
      query.assgin = req.user ? req.user._id : null;
    }

    if (age && age !== 'all' && age !== '') {
      if (age.includes('-')) {
        const [min, max] = age.split('-').map(Number);
        query.age = { $gte: min, $lte: max };
      } else if (age.endsWith('+')) {
        const min = Number(age.replace('+', ''));
        query.age = { $gte: min };
      } else {
        const numAge = Number(age);
        if (!isNaN(numAge)) {
          query.age = numAge;
        }
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
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
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
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
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
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
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
        existingCustomer = await Customer.create({ name: name || 'Unknown', phone_number });
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
      payload.assgin = req.user ? req.user._id : undefined;
    }

    const lead = await Lead.create(payload);

    // Send event to Facebook Conversions API
    if (phone_number) {
      sendLeadEventToFacebook({
        email: req.body.email,
        phone: phone_number
      });
    }

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
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
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
        existingCustomer = await Customer.create({ name: name || 'Unknown', phone_number });
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
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
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
    await Lead.findByIdAndUpdate(req.params.id, { isDeleted: true, deleteDate: new Date() }, { new: true });

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
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

const exportLeads = async (req, res) => {
  try {
    const { search = '', assgin, status, reason_call, product, startDate, endDate, age } = req.query;
    const query = { isDeleted: { $ne: true } };
    
    if (search) {
      const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const flexibleSearchPattern = escapedSearch.trim().replace(/\s+/g, '[\\s,]*');

      const [matchedCustomers, matchedUsers, matchedStatuses, matchedReasons] = await Promise.all([
        Customer.find({
          $or: [
            { name: { $regex: flexibleSearchPattern, $options: 'i' } },
            { phone_number: { $regex: flexibleSearchPattern, $options: 'i' } }
          ]
        }),
        User.find({
          name: { $regex: flexibleSearchPattern, $options: 'i' }
        }),
        Status.find({
          name: { $regex: flexibleSearchPattern, $options: 'i' }
        }),
        ReasonToCall.find({
          name: { $regex: flexibleSearchPattern, $options: 'i' }
        })
      ]);

      const customerIds = matchedCustomers.map(c => c._id);
      const userIds = matchedUsers.map(u => u._id);
      const statusIds = matchedStatuses.map(s => s._id);
      const reasonIds = matchedReasons.map(r => r._id);

      const terms = search.trim().split(/\s+/).filter(t => t.length > 0);
      const productAllQuery = terms.length > 0 ? {
        products: {
          $all: terms.map(term => ({
            $elemMatch: { name: { $regex: term, $options: 'i' } }
          }))
        }
      } : null;

      query.$or = [
        { customer: { $in: customerIds } },
        { assgin: { $in: userIds } },
        { status: { $in: statusIds } },
        { reason_call: { $in: reasonIds } },
        { remark: { $regex: flexibleSearchPattern, $options: 'i' } },
        { note: { $regex: flexibleSearchPattern, $options: 'i' } },
        { address: { $regex: flexibleSearchPattern, $options: 'i' } },
        { gender: { $regex: flexibleSearchPattern, $options: 'i' } },
        { paymentType: { $regex: flexibleSearchPattern, $options: 'i' } },
        { courier: { $regex: flexibleSearchPattern, $options: 'i' } },
        { transactionId: { $regex: flexibleSearchPattern, $options: 'i' } }
      ];

      if (productAllQuery) {
        query.$or.push(productAllQuery);
      }

      if (!isNaN(search) && search.trim() !== '') {
        const num = Number(search);
        query.$or.push({ age: num });
        query.$or.push({ 'products.amount': num });
        query.$or.push({ 'products.subtotal': num });
      }
    }

    const parseObjectIdFilter = (val) => {
      if (!val || val === 'all' || val === '') return undefined;
      const ids = val.split(',')
        .map(id => id.trim())
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));
      return ids.length > 0 ? { $in: ids } : undefined;
    };

    const statusFilter = parseObjectIdFilter(status);
    if (statusFilter) query.status = statusFilter;

    const reasonFilter = parseObjectIdFilter(reason_call);
    if (reasonFilter) query.reason_call = reasonFilter;

    const productFilter = parseObjectIdFilter(product);
    if (productFilter) query['products.productId'] = productFilter;

    const assignFilter = parseObjectIdFilter(assgin);
    if (assignFilter) query.assgin = assignFilter;

    if (age && age !== 'all' && age !== '') {
      if (age.includes('-')) {
        const [min, max] = age.split('-').map(Number);
        query.age = { $gte: min, $lte: max };
      } else if (age.endsWith('+')) {
        const min = Number(age.replace('+', ''));
        query.age = { $gte: min };
      } else {
        const numAge = Number(age);
        if (!isNaN(numAge)) {
          query.age = numAge;
        }
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
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getLeads,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  exportLeads,
  getLatestLeadByPhone
};
