const Status = require('../models/statusModel');
const { createNotification, getActorFromRequest } = require('../utils/notificationHelper');

// @desc    Get all statuses (with pagination & search)
// @route   GET /api/statuses?page=1&limit=10&search=name
const getStatuses = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const filter = search
      ? { name: { $regex: search, $options: 'i' } }
      : {};

    const [statuses, total] = await Promise.all([
      Status.find(filter).skip(skip).limit(limit).sort({ order: 1, createdAt: -1 }),
      Status.countDocuments(filter)
    ]);

    res.status(200).json({
      data: statuses,
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

// @desc    Get single status
// @route   GET /api/statuses/:id
const getStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found' });
    res.status(200).json(status);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create new status
// @route   POST /api/statuses
const createStatus = async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Status name is required' });
    }
    const status = await Status.create({ name, color: color || '#3b82f6' });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Status Created',
      message: `Status "${status.name}" was created by ${actor?.name || 'Staff'}`,
      category: 'MASTER'
    });
    res.status(201).json(status);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update status
// @route   PUT /api/statuses/:id
const updateStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found' });
    const updated = await Status.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Status Updated',
      message: `Status "${updated.name}" was updated by ${actor?.name || 'Staff'}`,
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

// @desc    Delete status
// @route   DELETE /api/statuses/:id
const deleteStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found' });
    await Status.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Status deleted successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Reorder statuses
// @route   PUT /api/statuses/reorder
const reorderStatuses = async (req, res) => {
  try {
    const { statuses } = req.body; // Array of { id, order }
    if (!statuses || !Array.isArray(statuses)) {
      return res.status(400).json({ message: 'Invalid payload for reordering' });
    }
    
    // Update all statuses with their new order
    const updatePromises = statuses.map(s => 
      Status.findByIdAndUpdate(s.id, { order: s.order })
    );
    
    await Promise.all(updatePromises);
    res.status(200).json({ message: 'Statuses reordered successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Export all statuses (with optional search, no pagination)
// @route   GET /api/statuses/export?search=name
const exportStatuses = async (req, res) => {
  try {
    const search = req.query.search || '';
    const filter = search ? { name: { $regex: search, $options: 'i' } } : {};
    const statuses = await Status.find(filter).sort({ createdAt: -1 });
    res.status(200).json(statuses);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getStatuses, getStatus, createStatus, updateStatus, deleteStatus, exportStatuses, reorderStatuses };
