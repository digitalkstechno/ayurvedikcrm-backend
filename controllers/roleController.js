const Role = require('../models/roleModel');
const { createNotification, getActorFromRequest } = require('../utils/notificationHelper');

// @desc    Get all roles (with pagination & search)
// @route   GET /api/roles?page=1&limit=10&search=name
const getRoles = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const filter = search
      ? { name: { $regex: search, $options: 'i' } }
      : {};

    const [roles, total] = await Promise.all([
      Role.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Role.countDocuments(filter)
    ]);

    res.status(200).json({
      data: roles,
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

// @desc    Get single role
// @route   GET /api/roles/:id
const getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });
    res.status(200).json(role);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create role
// @route   POST /api/roles
const createRole = async (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Role name is required' });
    }
    const role = await Role.create({ name, permissions: permissions || {} });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Role Created',
      message: `Role "${role.name}" was created by ${actor?.name || 'Staff'}`,
      category: 'TEAM'
    });
    res.status(201).json(role);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update role
// @route   PUT /api/roles/:id
const updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });
    const updated = await Role.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Role Updated',
      message: `Role "${updated.name}" was updated by ${actor?.name || 'Staff'}`,
      category: 'TEAM'
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

// @desc    Delete role
// @route   DELETE /api/roles/:id
const deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });
    await Role.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Role deleted successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Export all roles (with optional search, no pagination)
// @route   GET /api/roles/export?search=name
const exportRoles = async (req, res) => {
  try {
    const search = req.query.search || '';
    const filter = search ? { name: { $regex: search, $options: 'i' } } : {};
    const roles = await Role.find(filter).sort({ createdAt: -1 });
    res.status(200).json(roles);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = { getRoles, getRole, createRole, updateRole, deleteRole, exportRoles };
