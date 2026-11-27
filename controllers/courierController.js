const Courier = require('../models/courierModel');
const { createNotification, getActorFromRequest } = require('../utils/notificationHelper');

// @desc    Get all couriers (with pagination & search)
// @route   GET /api/couriers
const getCouriers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const filter = search
      ? { name: { $regex: search, $options: 'i' } }
      : {};

    const [couriers, total] = await Promise.all([
      Courier.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Courier.countDocuments(filter)
    ]);

    res.status(200).json({
      data: couriers,
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

// @desc    Get single courier
// @route   GET /api/couriers/:id
const getCourier = async (req, res) => {
  try {
    const courier = await Courier.findById(req.params.id);
    if (!courier) return res.status(404).json({ message: 'Courier not found' });
    res.status(200).json(courier);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create a new courier
// @route   POST /api/couriers
const createCourier = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Courier name is required' });

    const exists = await Courier.findOne({ name });
    if (exists) return res.status(400).json({ message: 'Courier already exists' });

    const courier = await Courier.create({ name });
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Courier Created',
      message: `Courier "${courier.name}" was created by ${actor?.name || 'Staff'}`,
      category: 'COURIER'
    });
    res.status(201).json(courier);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update courier details
// @route   PUT /api/couriers/:id
const updateCourier = async (req, res) => {
  try {
    const courier = await Courier.findById(req.params.id);
    if (!courier) return res.status(404).json({ message: 'Courier not found' });

    const updated = await Courier.findByIdAndUpdate(
      req.params.id,
      { name: req.body.name },
      { new: true, runValidators: true }
    );
    const actor = await getActorFromRequest(req);
    await createNotification({
      req,
      actorUser: actor,
      title: 'Courier Updated',
      message: `Courier "${updated.name}" was updated by ${actor?.name || 'Staff'}`,
      category: 'COURIER'
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

// @desc    Delete courier
// @route   DELETE /api/couriers/:id
const deleteCourier = async (req, res) => {
  try {
    const courier = await Courier.findById(req.params.id);
    if (!courier) return res.status(404).json({ message: 'Courier not found' });

    await Courier.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Courier deleted successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getCouriers,
  getCourier,
  createCourier,
  updateCourier,
  deleteCourier
};
