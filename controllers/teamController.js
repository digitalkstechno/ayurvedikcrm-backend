const Team = require('../models/teamModel');
const { createNotification, getActorFromRequest } = require('../utils/notificationHelper');

// @desc    Get all teams (with pagination & search)
// @route   GET /api/teams
const getTeams = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const filter = search
      ? { name: { $regex: search, $options: 'i' } }
      : {};

    const [teams, total] = await Promise.all([
      Team.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Team.countDocuments(filter)
    ]);

    res.status(200).json({
      data: teams,
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

// @desc    Get single team
// @route   GET /api/teams/:id
const getTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ message: 'Team not found' });
    res.status(200).json(team);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create new team
// @route   POST /api/teams
const createTeam = async (req, res) => {
  try {
    const { name, head, member } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Team name is required' });
    }
    if (!head) {
      return res.status(400).json({ message: 'Team head is required' });
    }

    const team = await Team.create({
      name,
      head,
      member: member || []
    });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Team Created',
      message: `Team "${team.name}" was created by ${actor?.name || 'Staff'}`,
      category: 'TEAM'
    });
    res.status(201).json(team);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update team details
// @route   PUT /api/teams/:id
const updateTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ message: 'Team not found' });

    const updated = await Team.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Team Updated',
      message: `Team "${updated.name}" was updated by ${actor?.name || 'Staff'}`,
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

// @desc    Delete team
// @route   DELETE /api/teams/:id
const deleteTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ message: 'Team not found' });
    await Team.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Team deleted successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Export all teams
// @route   GET /api/teams/export
const exportTeams = async (req, res) => {
  try {
    const search = req.query.search || '';
    const filter = search ? { name: { $regex: search, $options: 'i' } } : {};
    const teams = await Team.find(filter).sort({ createdAt: -1 });
    res.status(200).json(teams);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  exportTeams
};
