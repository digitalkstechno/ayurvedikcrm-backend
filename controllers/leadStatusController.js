const LeadStatus = require('../models/leadStatusModel');

// @desc    Get all lead statuses (with pagination & search)
// @route   GET /api/lead-statuses?page=1&limit=10&search=name
const getLeadStatuses = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const filter = search
      ? { name: { $regex: search, $options: 'i' } }
      : {};

    const [leadStatuses, total] = await Promise.all([
      LeadStatus.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      LeadStatus.countDocuments(filter)
    ]);

    res.status(200).json({
      data: leadStatuses,
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

// @desc    Get single lead status
// @route   GET /api/lead-statuses/:id
const getLeadStatus = async (req, res) => {
  try {
    const leadStatus = await LeadStatus.findById(req.params.id);
    if (!leadStatus) return res.status(404).json({ message: 'Lead status not found' });
    res.status(200).json(leadStatus);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create new lead status
// @route   POST /api/lead-statuses
const createLeadStatus = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Lead status name is required' });
    }
    const leadStatus = await LeadStatus.create({ name: name.trim() });
    res.status(201).json(leadStatus);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update lead status
// @route   PUT /api/lead-statuses/:id
const updateLeadStatus = async (req, res) => {
  try {
    const leadStatus = await LeadStatus.findById(req.params.id);
    if (!leadStatus) return res.status(404).json({ message: 'Lead status not found' });

    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Lead status name is required' });
    }

    const updated = await LeadStatus.findByIdAndUpdate(
      req.params.id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );
    res.status(200).json(updated);
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete lead status
// @route   DELETE /api/lead-statuses/:id
const deleteLeadStatus = async (req, res) => {
  try {
    const leadStatus = await LeadStatus.findById(req.params.id);
    if (!leadStatus) return res.status(404).json({ message: 'Lead status not found' });
    await LeadStatus.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Lead status deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Export all lead statuses (with optional search, no pagination)
// @route   GET /api/lead-statuses/export?search=name
const exportLeadStatuses = async (req, res) => {
  try {
    const search = req.query.search || '';
    const filter = search ? { name: { $regex: search, $options: 'i' } } : {};
    const leadStatuses = await LeadStatus.find(filter).sort({ createdAt: -1 });
    res.status(200).json(leadStatuses);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getLeadStatuses,
  getLeadStatus,
  createLeadStatus,
  updateLeadStatus,
  deleteLeadStatus,
  exportLeadStatuses
};
