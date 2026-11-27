const ReturnOrderType = require('../models/returnOrderTypeModel');
const { createNotification, getActorFromRequest } = require('../utils/notificationHelper');

// @desc    Get all return order types (with pagination & search)
// @route   GET /api/return-order-types?page=1&limit=10&search=name
const getReturnOrderTypes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const filter = search
      ? { name: { $regex: search, $options: 'i' } }
      : {};

    const [types, total] = await Promise.all([
      ReturnOrderType.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      ReturnOrderType.countDocuments(filter)
    ]);

    res.status(200).json({
      data: types,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single return order type
// @route   GET /api/return-order-types/:id
const getReturnOrderType = async (req, res) => {
  try {
    const type = await ReturnOrderType.findById(req.params.id);
    if (!type) return res.status(404).json({ message: 'Return order type not found' });
    res.status(200).json(type);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create return order type
// @route   POST /api/return-order-types
const createReturnOrderType = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Return order type name is required' });
    }
    const type = await ReturnOrderType.create({ name });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Return Order Type Created',
      message: `Return Order Type "${type.name}" was created by ${actor?.name || 'Staff'}`,
      category: 'MASTER'
    });
    res.status(201).json(type);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update return order type
// @route   PUT /api/return-order-types/:id
const updateReturnOrderType = async (req, res) => {
  try {
    const type = await ReturnOrderType.findById(req.params.id);
    if (!type) return res.status(404).json({ message: 'Return order type not found' });
    const updated = await ReturnOrderType.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Return Order Type Updated',
      message: `Return Order Type "${updated.name}" was updated by ${actor?.name || 'Staff'}`,
      category: 'MASTER'
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

// @desc    Delete return order type
// @route   DELETE /api/return-order-types/:id
const deleteReturnOrderType = async (req, res) => {
  try {
    const type = await ReturnOrderType.findById(req.params.id);
    if (!type) return res.status(404).json({ message: 'Return order type not found' });
    await ReturnOrderType.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Return order type deleted successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Export all return order types (with optional search, no pagination)
// @route   GET /api/return-order-types/export?search=name
const exportReturnOrderTypes = async (req, res) => {
  try {
    const search = req.query.search || '';
    const filter = search ? { name: { $regex: search, $options: 'i' } } : {};
    const types = await ReturnOrderType.find(filter).sort({ createdAt: -1 });
    res.status(200).json(types);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getReturnOrderTypes, getReturnOrderType, createReturnOrderType, updateReturnOrderType, deleteReturnOrderType, exportReturnOrderTypes };
